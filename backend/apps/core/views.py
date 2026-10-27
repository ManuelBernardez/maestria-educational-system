from decimal import Decimal, InvalidOperation
import asyncio
import csv
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import time
import zipfile

from asgiref.sync import async_to_sync
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Count, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.exceptions import MethodNotAllowed, NotFound, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .ai import default_rubric_for_question, generate_correction, generate_questions, generate_rubric
from .models import (
    AIGeneration, Assessment, AuditEvent, ContactMessage, Correction,
    CorrectionCriterionResult, CorrectionRevision, Course, Enrollment,
    Question, Rubric, RubricCriterion, RubricLevel, Student, Submission,
    SubmissionAnswer,
)
from .serializers import (
    AssessmentEditorSerializer, AssessmentListSerializer, AssessmentSerializer, AssessmentWorkspaceSerializer, ContactMessageSerializer, CorrectionSerializer,
    CourseOptionSerializer, CourseSerializer, EnrollmentSerializer, QuestionSerializer,
    RubricCriterionSerializer, RubricLevelSerializer, RubricSerializer,
    StudentSerializer, SubmissionAnswerSerializer, SubmissionSerializer,
)
from .throttles import AIUserRateThrottle, ContactRateThrottle

logger = logging.getLogger(__name__)
MAX_ANSWER_CHARS = 50_000
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
MAX_CORRECTION_ANSWERS = 10
MAX_CORRECTION_INPUT_CHARS = 100_000
MAX_DOCX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
MAX_DOCX_MEMBERS = 1_000


def record_audit(owner_id, event_type, object_type, object_id, detail=None):
    """Write minimal trace data; never pass response content, email or credentials."""
    AuditEvent.objects.create(
        owner_id=owner_id, event_type=event_type, object_type=object_type,
        object_id=str(object_id), detail=detail or {},
    )


def record_ai_generation(owner_id, task, started, ok, fingerprint="", error_code="", assessment=None, submission=None):
    provider = os.getenv("AI_PROVIDER", "mock")
    elapsed = min(max(int((time.monotonic() - started) * 1000), 0), 2_147_483_647)
    model_name = {
        "gemini": os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
        "openai": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "ollama": os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
    }.get(provider, "")
    AIGeneration.objects.create(
        owner_id=owner_id, task=task, provider=provider,
        model_name=model_name[:100],
        status="succeeded" if ok else "failed", duration_ms=elapsed,
        prompt_fingerprint=fingerprint[:64], error_code=error_code[:80],
        assessment=assessment, submission=submission,
    )


def fingerprint(value):
    """Fingerprint request context without storing the text sent to the model."""
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def clear_mock_practice_corrections(owner_id, assessment):
    """Remove legacy simulated results from the synthetic practice dataset only."""
    if not assessment or not assessment.title.startswith("Ejemplo MaestrIA ·"):
        return
    mock_corrections = Correction.objects.filter(
        owner_id=owner_id, submission__owner_id=owner_id,
        submission__assessment=assessment, provider="mock",
    )
    submission_ids = list(mock_corrections.values_list("submission_id", flat=True))
    if not submission_ids:
        return
    mock_corrections.delete()
    # Reopen only practice submissions that no longer have any correction record.
    Submission.objects.filter(owner_id=owner_id, pk__in=submission_ids).exclude(
        corrections__isnull=False,
    ).update(status="pending")


def _safe_ai_error_detail(exc, fallback):
    """Expose actionable local configuration errors, never raw provider responses."""
    message = str(exc).strip()
    safe_prefixes = (
        "El envío de contenido a un proveedor externo está desactivado.",
        "Falta GEMINI_API_KEY",
        "Falta OPENAI_API_KEY",
        "Para usar Gemini con contenido docente o estudiantil",
        "AI_PROVIDER debe ser",
        "GEMINI_MODEL no tiene un nombre válido.",
    )
    if len(message) <= 350 and message.startswith(safe_prefixes):
        return message
    return fallback


@api_view(["GET"])
def dashboard_summary(request):
    owner = request.user.id
    corrections = Correction.objects.filter(owner_id=owner)
    approved = corrections.filter(status="approved")
    pending = corrections.filter(status="pending_review")
    return Response({
        "courses": Course.objects.filter(owner_id=owner, active=True).count(),
        "assessments": Assessment.objects.filter(owner_id=owner).exclude(status="archived").count(),
        "students": Student.objects.filter(owner_id=owner, active=True).count(),
        "submissions": Submission.objects.filter(owner_id=owner).count(),
        "pending_corrections": pending.count(),
        "approved_corrections": approved.count(),
        "recent_activity": list(AuditEvent.objects.filter(owner_id=owner).values("id", "event_type", "object_type", "object_id", "detail", "created_at")[:8]),
    })


@api_view(["GET"])
def audit_events(request):
    events = AuditEvent.objects.filter(owner_id=request.user.id).values(
        "id", "event_type", "object_type", "object_id", "detail", "created_at"
    )[:100]
    return Response(list(events))


@api_view(["POST"])
@transaction.atomic
def seed_demo_dataset(request):
    """Create a small, clearly synthetic dataset owned by the signed-in teacher.

    The endpoint is idempotent: repeated clicks open the same practice dataset
    instead of duplicating students, classes, rubrics, assessments or submissions.
    No real student personal data is included, and the endpoint never calls an AI.
    """
    owner_id = request.user.id
    marker = AuditEvent.objects.filter(
        owner_id=owner_id,
        event_type="demo.dataset_seeded",
        object_id="photosynthesis-v1",
    ).first()
    if marker:
        detail = marker.detail or {}
        assessment_id = detail.get("assessment_id")
        assessment = Assessment.objects.filter(owner_id=owner_id, pk=assessment_id).first()
        if assessment:
            clear_mock_practice_corrections(owner_id, assessment)
            # Older practice datasets may have carried a filename label despite never uploading a file.
            Submission.objects.filter(owner_id=owner_id, assessment=assessment).exclude(source_filename="").update(source_filename="")
            return Response({
                "created": False,
                "course_id": assessment.course_id,
                "assessment_id": assessment.id,
                "submission_count": Submission.objects.filter(owner_id=owner_id, assessment=assessment).count(),
                "message": "El ejemplo ya estaba cargado. Abrí la evaluación para continuar practicando.",
            })

    course, _ = Course.objects.get_or_create(
        owner_id=owner_id,
        name="Ejemplo MaestrIA · Ciencias Naturales",
        defaults={
            "subject": "Ciencias Naturales",
            "level": "Secundaria · 2.º año",
            "academic_year": "2026",
            "description": "Curso ficticio para practicar el flujo de evaluación y corrección. No representa estudiantes reales.",
            "active": True,
        },
    )
    if not course.active:
        course.active = True
        course.save(update_fields=["active", "updated_at"])

    sample_students = [
        ("Alma Torres · Ejemplo", "DEMO-FOTO-001"),
        ("Bruno Díaz · Ejemplo", "DEMO-FOTO-002"),
        ("Malena Ruiz · Ejemplo", "DEMO-FOTO-003"),
    ]
    students = []
    for display_name, external_code in sample_students:
        student, _ = Student.objects.get_or_create(
            owner_id=owner_id,
            external_code=external_code,
            defaults={"name": display_name, "email": "", "phone": "", "active": True},
        )
        if not student.active:
            student.active = True
            student.save(update_fields=["active", "updated_at"])
        Enrollment.objects.get_or_create(
            owner_id=owner_id, course=course, student=student,
            defaults={"status": "active"},
        )
        students.append(student)

    rubric, _ = Rubric.objects.get_or_create(
        owner_id=owner_id,
        title="Ejemplo MaestrIA · Rúbrica de fotosíntesis",
        defaults={
            "description": "Criterios ficticios para evaluar una explicación científica breve.",
            "scale_type": "both",
        },
    )
    criterion_specs = [
        ("Explica el proceso", "Relaciona luz, agua y dióxido de carbono con la producción de glucosa.", 4.0,
         [("Logrado", "Explica los elementos y su relación", 4.0), ("En desarrollo", "Menciona parte del proceso", 2.0), ("Inicial", "No explica el proceso o incluye errores centrales", 0.0)]),
        ("Comprende la transformación de energía y materia", "Distingue la energía de la luz y la materia usada para formar glucosa.", 3.0,
         [("Logrado", "Distingue energía y materia", 3.0), ("En desarrollo", "Reconoce solo una parte", 1.5), ("Inicial", "Confunde energía y materia", 0.0)]),
        ("Explica su importancia", "Relaciona la fotosíntesis con la vida de la planta y otros seres vivos.", 3.0,
         [("Logrado", "Explica la importancia para plantas y ecosistemas", 3.0), ("En desarrollo", "Explica una sola consecuencia", 1.5), ("Inicial", "No justifica su importancia", 0.0)]),
    ]
    criteria = []
    for position, (name, description, maximum, levels) in enumerate(criterion_specs, start=1):
        criterion, _ = RubricCriterion.objects.get_or_create(
            owner_id=owner_id, rubric=rubric, position=position,
            defaults={"name": name, "description": description, "max_score": Decimal(str(maximum)), "weight": Decimal("1.000")},
        )
        # Keep demo dataset repeatable; only create levels when the criterion has none.
        if not criterion.levels.exists():
            for level_position, (level_name, level_description, score) in enumerate(levels, start=1):
                RubricLevel.objects.create(
                    owner_id=owner_id, criterion=criterion, name=level_name,
                    description=level_description, score=Decimal(str(score)), position=level_position,
                )
        criteria.append(criterion)

    assessment, _ = Assessment.objects.get_or_create(
        owner_id=owner_id,
        title="Ejemplo MaestrIA · ¿Cómo funciona la fotosíntesis?",
        course=course,
        defaults={
            "subject": "Ciencias Naturales",
            "level": "Secundaria · 2.º año",
            "objectives": "Explicar la fotosíntesis e identificar la materia y la energía que intervienen.",
            "instructions": "Respondé con tus palabras. Explicá qué toma la planta del ambiente, qué produce y por qué el proceso es importante.",
            "reference_material": "Material ficticio de práctica: durante la fotosíntesis, las plantas usan energía de la luz para formar glucosa a partir de agua y dióxido de carbono. En el proceso se libera oxígeno. La glucosa almacena energía química y aporta materia para el crecimiento.",
            "status": "ready",
        },
    )
    question, _ = Question.objects.get_or_create(
        owner_id=owner_id, assessment=assessment, position=1,
        defaults={
            "prompt": "Explicá qué ocurre durante la fotosíntesis y por qué es importante para las plantas y otros seres vivos.",
            "expected_answer": "Una respuesta sólida explica el uso de luz, agua y dióxido de carbono para producir glucosa; reconoce que se libera oxígeno; y vincula la glucosa con el crecimiento y las cadenas alimentarias.",
            "question_type": "open",
            "max_score": Decimal("10.00"),
            "rubric": rubric,
        },
    )
    if question.rubric_id != rubric.id:
        question.rubric = rubric
        question.save(update_fields=["rubric", "updated_at"])

    sample_answers = [
        "La fotosíntesis permite que las plantas fabriquen glucosa usando energía de la luz, agua y dióxido de carbono. En el proceso liberan oxígeno. La glucosa les sirve para crecer y también sostiene las cadenas alimentarias, porque otros seres vivos se alimentan de plantas o de animales que las comen.",
        "Las plantas usan la luz del sol y el agua para crecer. La fotosíntesis les permite fabricar alimento, aunque no recuerdo qué papel tiene el dióxido de carbono. También puede ser importante porque libera oxígeno.",
        "Las plantas comen tierra por las raíces y la convierten en oxígeno. La luz solo les da calor; la fotosíntesis ocurre cuando las hojas toman minerales del suelo.",
    ]
    submissions = []
    for student, answer_text in zip(students, sample_answers):
        submission, _ = Submission.objects.get_or_create(
            owner_id=owner_id, assessment=assessment, student=student,
            defaults={
                "question": question,
                "student_name": student.name,
                "answer_text": answer_text,
                "source_type": "text",
                "status": "pending",
            },
        )
        submissions.append(submission)

    record_audit(owner_id, "demo.dataset_seeded", "demo_dataset", "photosynthesis-v1", {
        "course_id": course.id,
        "assessment_id": assessment.id,
        "submission_ids": [item.id for item in submissions],
    })
    return Response({
        "created": True,
        "course_id": course.id,
        "assessment_id": assessment.id,
        "submission_count": len(submissions),
        "message": "Ejemplo de práctica creado: un curso, tres estudiantes ficticios, una evaluación, una rúbrica y tres respuestas para revisar.",
    }, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def correction_workspace(request):
    """Return only the selected evaluation's operational data in one round trip."""
    owner_id = request.user.id
    assessment_qs = Assessment.objects.filter(owner_id=owner_id).select_related("course").order_by("-updated_at")
    requested_id = request.query_params.get("assessment")
    selected = None
    if requested_id:
        try:
            selected = assessment_qs.filter(pk=int(requested_id)).first()
        except (TypeError, ValueError):
            selected = None
        if selected is None:
            raise NotFound("Evaluación no disponible.")
    else:
        selected = assessment_qs.exclude(status="archived").first() or assessment_qs.first()

    if selected is not None:
        clear_mock_practice_corrections(owner_id, selected)

    assessments = AssessmentListSerializer(assessment_qs, many=True).data
    # Do not load teacher rosters or full rubric structures on the empty state.
    # When an assessment has a course, fetch only its active enrolled students.
    students = []
    courses = []
    rubrics = []
    selected_data = None
    questions = []
    submissions = []
    corrections = []
    enrollments = []
    if selected is not None:
        student_qs = Student.objects.filter(owner_id=owner_id, active=True)
        if selected.course_id:
            student_qs = student_qs.filter(
                enrollments__owner_id=owner_id,
                enrollments__course_id=selected.course_id,
                enrollments__course__owner_id=owner_id,
                enrollments__status="active",
            ).distinct()
        students = StudentSerializer(
            student_qs.order_by("name"), many=True, context={"request": request}
        ).data
        courses = CourseOptionSerializer(
            Course.objects.filter(owner_id=owner_id, active=True).order_by("name"), many=True
        ).data
        rubrics = RubricSerializer(
            Rubric.objects.filter(owner_id=owner_id).prefetch_related("criteria__levels").order_by("title"),
            many=True, context={"request": request},
        ).data
        selected_data = AssessmentWorkspaceSerializer(selected, context={"request": request}).data
        selected_questions = Question.objects.filter(owner_id=owner_id, assessment=selected).select_related("rubric").order_by("position", "id")
        questions = QuestionSerializer(selected_questions, many=True, context={"request": request}).data
        selected_submissions = Submission.objects.filter(owner_id=owner_id, assessment=selected).select_related(
            "assessment", "student", "question"
        ).prefetch_related("answers").order_by("-created_at")
        submissions = SubmissionSerializer(selected_submissions, many=True, context={"request": request}).data
        corrections_qs = Correction.objects.filter(owner_id=owner_id, submission__assessment=selected).select_related(
            "submission__assessment", "submission__student"
        ).prefetch_related("criterion_results").order_by("-updated_at")
        corrections = CorrectionSerializer(corrections_qs, many=True, context={"request": request}).data
        if selected.course_id:
            enrollments = EnrollmentSerializer(
                Enrollment.objects.filter(owner_id=owner_id, course_id=selected.course_id, status="active")
                .filter(course__owner_id=owner_id, student__owner_id=owner_id)
                .select_related("course", "student"), many=True, context={"request": request},
            ).data

    return Response({
        "assessments": assessments,
        "selected_assessment": selected_data,
        "students": students,
        "courses": courses,
        "rubrics": rubrics,
        "questions": questions,
        "submissions": submissions,
        "corrections": corrections,
        "enrollments": enrollments,
        "ai_provider": os.getenv("AI_PROVIDER", "mock").strip().lower(),
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "service": "maestria-api"})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ContactRateThrottle])
def contact(request):
    """Public contact form with validation and a honeypot field."""
    serializer = ContactMessageSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = {key: value for key, value in serializer.validated_data.items() if key != "website"}
    message = ContactMessage.objects.create(**payload)
    # Email notification is best-effort. Never expose SMTP errors to an anonymous caller.
    if os.getenv("CONTACT_NOTIFY_EMAIL") and os.getenv("DEFAULT_FROM_EMAIL"):
        try:
            send_mail(
                f"Contacto MaestrIA: {message.subject}",
                f"Nombre: {message.name}\nCorreo: {message.email}\n\n{message.message}",
                os.getenv("DEFAULT_FROM_EMAIL"), [os.getenv("CONTACT_NOTIFY_EMAIL")], fail_silently=True,
            )
        except Exception:
            logger.warning("Contact notification failed")
    return Response({"detail": "Mensaje recibido. Gracias por escribirnos."}, status=status.HTTP_201_CREATED)


class OwnerViewSet(viewsets.ModelViewSet):
    """Base class enforcing tenant filtering and server-assigned ownership."""
    def get_queryset(self):
        return self.queryset.filter(owner_id=self.request.user.id)

    def perform_create(self, serializer):
        serializer.save(owner_id=self.request.user.id)


class CourseViewSet(OwnerViewSet):
    queryset = Course.objects.all().annotate(
        student_count=Count(
            "enrollments",
            filter=Q(enrollments__status="active", enrollments__student__active=True),
            distinct=True,
        ),
        assessment_count=Count("assessments", distinct=True),
    )
    serializer_class = CourseSerializer

    def perform_destroy(self, instance):
        # Keep historical course/assessment relationships; deletion is logical.
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])


class EnrollmentViewSet(OwnerViewSet):
    queryset = Enrollment.objects.all().select_related("course", "student")
    serializer_class = EnrollmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset().filter(course__owner_id=self.request.user.id, student__owner_id=self.request.user.id)
        course_id = self.request.query_params.get("course")
        if course_id:
            queryset = queryset.filter(course_id=course_id)
        return queryset


class AssessmentViewSet(OwnerViewSet):
    queryset = Assessment.objects.all().select_related("course").order_by("-updated_at")
    serializer_class = AssessmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "retrieve":
            queryset = queryset.prefetch_related("questions")
        return queryset

    def get_serializer_class(self):
        if self.action == "list":
            return AssessmentListSerializer
        return super().get_serializer_class()

    @action(detail=True, methods=["get"], url_path="editor")
    def editor(self, request, pk=None):
        """Small payload for preparing an evaluation without loading submissions or rubrics."""
        assessment = self.get_object()
        owner_id = request.user.id
        questions = Question.objects.filter(owner_id=owner_id, assessment=assessment).order_by("position", "id")
        courses = CourseOptionSerializer(Course.objects.filter(owner_id=owner_id, active=True).order_by("name"), many=True).data
        return Response({
            "assessment": AssessmentEditorSerializer(assessment, context={"request": request}).data,
            "questions": QuestionSerializer(questions, many=True, context={"request": request}).data,
            "courses": courses,
        })

    @action(detail=True, methods=["post"], url_path="import-reference", parser_classes=[MultiPartParser, FormParser], throttle_classes=[AIUserRateThrottle])
    def import_reference(self, request, pk=None):
        """Extract a teacher reference file in memory and save only its text."""
        assessment = self.get_object()
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError({"file": "Seleccioná un apunte o material de referencia."})
        text, source_type = _read_document(uploaded)
        mode = str(request.data.get("mode", "replace"))
        if mode not in {"replace", "append"}:
            raise ValidationError({"mode": "Usá replace o append."})
        combined = text if mode == "replace" or not assessment.reference_material else assessment.reference_material.rstrip() + "\n\n" + text
        if len(combined) > MAX_ANSWER_CHARS:
            raise ValidationError({"file": "El material combinado supera los 50.000 caracteres. Reemplazá el material existente o resumí los documentos."})
        assessment.reference_material = combined
        assessment.save(update_fields=["reference_material", "updated_at"])
        record_audit(request.user.id, "assessment.reference_imported", "assessment", assessment.id, {"source_type": source_type, "chars": len(text), "mode": mode})
        return Response({"assessment_id": assessment.id, "source_type": source_type, "chars": len(text), "total_chars": len(combined), "reference_material": combined})

    @action(detail=True, methods=["post"], url_path="generate-questions", throttle_classes=[AIUserRateThrottle])
    def generate_questions_action(self, request, pk=None):
        assessment = self.get_object()
        started = time.monotonic()
        context = {"assessment": assessment.pk, "count": request.data.get("count", 3)}
        try:
            try:
                count = int(request.data.get("count", 3))
            except (ValueError, TypeError) as exc:
                raise ValidationError({"count": "La cantidad debe ser un número entero entre 1 y 5."}) from exc
            if not 1 <= count <= 5:
                raise ValidationError({"count": "Solicitá entre 1 y 5 preguntas por vez."})
            result = async_to_sync(generate_questions)(
                title=assessment.title, subject=assessment.subject, level=assessment.level,
                objectives=assessment.objectives, instructions=assessment.instructions,
                reference_material=assessment.reference_material, count=count,
            )
            record_ai_generation(request.user.id, "generate_questions", started, True, fingerprint(context), assessment=assessment)
            record_audit(request.user.id, "questions.proposed", "assessment", assessment.id, {"count": len(result.get("questions", [])), "demo": bool(result.get("demo"))})
        except ValidationError:
            raise
        except Exception as exc:
            record_ai_generation(request.user.id, "generate_questions", started, False, fingerprint(context), type(exc).__name__, assessment=assessment)
            logger.warning("AI questions generation failed (%s)", type(exc).__name__)
            return Response({"detail": _safe_ai_error_detail(exc, "No se pudieron generar preguntas. Revisá la configuración del proveedor de IA y volvé a intentar.")}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(result, status=status.HTTP_200_OK)


class StudentViewSet(OwnerViewSet):
    queryset = Student.objects.all().prefetch_related("enrollments__course").order_by("name")
    serializer_class = StudentSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        # Every newly created student must start in a course. The underlying
        # Enrollment model still allows a student to join additional courses later.
        course_id = request.data.get("course")
        try:
            course = Course.objects.get(pk=course_id, owner_id=request.user.id, active=True)
        except (Course.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"course": "Elegí una materia o curso activo antes de agregar al estudiante."})
        payload = request.data.copy()
        payload.pop("course", None)
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        student = serializer.save(owner_id=request.user.id)
        Enrollment.objects.create(owner_id=request.user.id, course=course, student=student, status="active")
        student = self.get_queryset().get(pk=student.pk)
        return Response(self.get_serializer(student).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="import-csv", parser_classes=[MultiPartParser, FormParser])
    @transaction.atomic
    def import_csv(self, request):
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError({"file": "Adjuntá un CSV con una columna obligatoria name y columnas opcionales email, phone, external_code."})
        if uploaded.size > 2 * 1024 * 1024:
            raise ValidationError({"file": "El archivo supera el límite de 2 MB."})
        try:
            course = Course.objects.get(pk=request.data.get("course"), owner_id=request.user.id, active=True)
        except (Course.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"course": "Elegí una materia o curso activo para asignar a los estudiantes importados."})
        try:
            text = uploaded.read().decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(text))
            if not reader.fieldnames or "name" not in reader.fieldnames:
                raise ValidationError({"file": "El CSV debe incluir una columna name."})
            created, skipped, errors = 0, 0, []
            owner_id = request.user.id
            seen_codes = set(Student.objects.filter(owner_id=owner_id).exclude(external_code="").values_list("external_code", flat=True))
            for row_number, row in enumerate(reader, start=2):
                if row_number > 501:
                    errors.append({"row": row_number, "reason": "Límite de 500 filas por importación."})
                    break
                name = (row.get("name") or "").strip()[:180]
                email = (row.get("email") or "").strip().lower()[:254]
                code = (row.get("external_code") or "").strip()[:80]
                if not name:
                    skipped += 1; errors.append({"row": row_number, "reason": "Falta name."}); continue
                if email:
                    try: validate_email(email)
                    except DjangoValidationError:
                        skipped += 1; errors.append({"row": row_number, "reason": "Correo inválido."}); continue
                if code and code in seen_codes:
                    skipped += 1; errors.append({"row": row_number, "reason": "external_code duplicado."}); continue
                student = Student.objects.create(owner_id=owner_id, name=name, email=email, phone=(row.get("phone") or "").strip()[:32], external_code=code)
                Enrollment.objects.create(owner_id=owner_id, course=course, student=student, status="active")
                if code: seen_codes.add(code)
                created += 1
            record_audit(owner_id, "students.imported", "student_import", "csv", {"created": created, "skipped": skipped})
            return Response({"created": created, "skipped": skipped, "errors": errors[:100]}, status=status.HTTP_200_OK)
        except UnicodeDecodeError as exc:
            raise ValidationError({"file": "El archivo debe estar codificado en UTF-8."}) from exc


class RubricViewSet(OwnerViewSet):
    queryset = Rubric.objects.all().prefetch_related("criteria__levels").order_by("-updated_at")
    serializer_class = RubricSerializer

    @action(detail=False, methods=["post"], url_path="create-with-criteria")
    @transaction.atomic
    def create_with_criteria(self, request):
        """Create a rubric, criteria and optional performance levels atomically."""
        raw_criteria = request.data.get("criteria")
        if not isinstance(raw_criteria, list) or not 2 <= len(raw_criteria) <= 20:
            raise ValidationError({"criteria": "Incluí entre 2 y 20 criterios."})
        rubric_serializer = RubricSerializer(data={
            "title": request.data.get("title", ""),
            "description": request.data.get("description", ""),
            "scale_type": request.data.get("scale_type", "both"),
        }, context={"request": request})
        rubric_serializer.is_valid(raise_exception=True)
        rubric = rubric_serializer.save(owner_id=request.user.id)

        for index, raw in enumerate(raw_criteria, start=1):
            if not isinstance(raw, dict):
                raise ValidationError({"criteria": f"El criterio {index} no tiene un formato válido."})
            criterion_serializer = RubricCriterionSerializer(data={
                "rubric": rubric.pk,
                "name": raw.get("name", ""),
                "description": raw.get("description", ""),
                "max_score": raw.get("max_score", 10),
                "weight": raw.get("weight", 1),
                "position": index,
            }, context={"request": request})
            criterion_serializer.is_valid(raise_exception=True)
            criterion = criterion_serializer.save(owner_id=request.user.id)
            if rubric.scale_type in {"levels", "both"}:
                default_levels = [
                    ("Inicial", "Requiere apoyo para demostrar el criterio.", 0),
                    ("En desarrollo", "Demuestra parte de lo esperado.", 1 / 3),
                    ("Logrado", "Cumple el criterio esperado.", 2 / 3),
                    ("Destacado", "Demuestra el criterio con profundidad o transferencia.", 1),
                ]
                supplied_levels = raw.get("levels")
                if not isinstance(supplied_levels, list) or len(supplied_levels) == 0:
                    supplied_levels = [
                        {"name": name, "description": desc, "score": round(float(criterion.max_score) * fraction, 2)}
                        for name, desc, fraction in default_levels
                    ]
                if len(supplied_levels) > 8:
                    raise ValidationError({"criteria": f"El criterio {index} no puede tener más de 8 niveles."})
                for level_index, raw_level in enumerate(supplied_levels, start=1):
                    if not isinstance(raw_level, dict):
                        raise ValidationError({"criteria": f"Un nivel del criterio {index} no tiene un formato válido."})
                    level_serializer = RubricLevelSerializer(data={
                        "criterion": criterion.pk,
                        "name": raw_level.get("name", ""),
                        "description": raw_level.get("description", ""),
                        "score": raw_level.get("score", 0),
                        "position": level_index,
                    }, context={"request": request})
                    level_serializer.is_valid(raise_exception=True)
                    level_serializer.save(owner_id=request.user.id)

        record_audit(request.user.id, "rubric.created", "rubric", rubric.id, {"criteria_count": len(raw_criteria), "scale_type": rubric.scale_type})
        rubric = Rubric.objects.prefetch_related("criteria__levels").get(pk=rubric.pk, owner_id=request.user.id)
        return Response(RubricSerializer(rubric, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="generate", throttle_classes=[AIUserRateThrottle])
    def generate_action(self, request):
        title = str(request.data.get("title", ""))[:180]
        subject = str(request.data.get("subject", ""))[:120]
        level = str(request.data.get("level", ""))[:120]
        objectives = str(request.data.get("objectives", ""))[:5000]
        instructions = str(request.data.get("instructions", ""))[:8000]
        raw_question_prompts = request.data.get("question_prompts", [])
        if not isinstance(raw_question_prompts, list):
            raw_question_prompts = []
        question_prompts = [str(item)[:2000] for item in raw_question_prompts[:10] if str(item).strip()]
        try:
            count = int(request.data.get("count", 4))
        except (ValueError, TypeError) as exc:
            raise ValidationError({"count": "La cantidad debe ser un número entero entre 2 y 6."}) from exc
        if not 2 <= count <= 6:
            raise ValidationError({"count": "Solicitá entre 2 y 6 criterios para la rúbrica sugerida."})
        started = time.monotonic()
        context = {"title": title, "subject": subject, "level": level, "count": count, "question_count": len(question_prompts)}
        try:
            reference_material = str(request.data.get("reference_material", ""))[:12000]
            result = async_to_sync(generate_rubric)(title=title, subject=subject, level=level, objectives=objectives, instructions=instructions, question_prompts=question_prompts, reference_material=reference_material, count=count)
            record_ai_generation(request.user.id, "generate_rubric", started, True, fingerprint(context))
        except Exception as exc:
            record_ai_generation(request.user.id, "generate_rubric", started, False, fingerprint(context), type(exc).__name__)
            logger.warning("AI rubric generation failed (%s)", type(exc).__name__)
            return Response({"detail": _safe_ai_error_detail(exc, "No se pudo proponer la rúbrica. Revisá la configuración del proveedor de IA y volvé a intentar.")}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(result)


class QuestionViewSet(OwnerViewSet):
    queryset = Question.objects.all().select_related("assessment", "rubric")
    serializer_class = QuestionSerializer

    def get_queryset(self):
        return super().get_queryset().filter(assessment__owner_id=self.request.user.id)

    def perform_create(self, serializer):
        assessment = serializer.validated_data["assessment"]
        if str(assessment.owner_id) != str(self.request.user.id):
            raise ValidationError("Evaluación no disponible.")
        serializer.save(owner_id=self.request.user.id)

    def destroy(self, request, *args, **kwargs):
        question = self.get_object()
        if Submission.objects.filter(question=question).exists() or SubmissionAnswer.objects.filter(question=question).exists():
            return Response(
                {"detail": "No se puede eliminar una pregunta con respuestas vinculadas. Podés editarla para nuevas evaluaciones o archivar la evaluación completa."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class RubricCriterionViewSet(OwnerViewSet):
    queryset = RubricCriterion.objects.all().select_related("rubric").prefetch_related("levels")
    serializer_class = RubricCriterionSerializer

    def get_queryset(self):
        return super().get_queryset().filter(rubric__owner_id=self.request.user.id)

    def perform_create(self, serializer):
        rubric = serializer.validated_data["rubric"]
        if str(rubric.owner_id) != str(self.request.user.id):
            raise ValidationError("Rúbrica no disponible.")
        serializer.save(owner_id=self.request.user.id)


class RubricLevelViewSet(OwnerViewSet):
    queryset = RubricLevel.objects.all().select_related("criterion__rubric")
    serializer_class = RubricLevelSerializer

    def get_queryset(self):
        return super().get_queryset().filter(criterion__rubric__owner_id=self.request.user.id)

    def perform_create(self, serializer):
        criterion = serializer.validated_data["criterion"]
        if str(criterion.owner_id) != str(self.request.user.id) or str(criterion.rubric.owner_id) != str(self.request.user.id):
            raise ValidationError("Criterio no disponible.")
        if serializer.validated_data["score"] > criterion.max_score:
            raise ValidationError({"score": "El puntaje del nivel no puede superar el máximo del criterio."})
        serializer.save(owner_id=self.request.user.id)


def _read_document(uploaded):
    """Extract text in memory; uploaded source files are not permanently stored."""
    if uploaded.size > MAX_DOCUMENT_BYTES:
        raise ValidationError({"file": "El archivo supera el límite de 5 MB."})
    extension = Path(uploaded.name).suffix.lower()
    try:
        if extension in {".txt", ".md"}:
            text = uploaded.read().decode("utf-8-sig")
            source_type = "txt"
        elif extension == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(uploaded)
            if len(reader.pages) > 50:
                raise ValidationError({"file": "El PDF supera el límite de 50 páginas."})
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
            source_type = "pdf"
        elif extension == ".docx":
            # DOCX is a ZIP container. Bound expanded size and member count before
            # asking python-docx/XML parsers to process it, reducing ZIP-bomb risk.
            uploaded.seek(0)
            with zipfile.ZipFile(uploaded) as archive:
                infos = archive.infolist()
                if len(infos) > MAX_DOCX_MEMBERS:
                    raise ValidationError({"file": "El documento contiene demasiados componentes internos."})
                expanded_size = sum(info.file_size for info in infos)
                if expanded_size > MAX_DOCX_UNCOMPRESSED_BYTES:
                    raise ValidationError({"file": "El documento comprimido excede el tamaño interno permitido de 20 MB."})
                if "word/document.xml" not in archive.namelist():
                    raise ValidationError({"file": "El archivo no parece ser un documento DOCX válido."})
            uploaded.seek(0)
            from docx import Document
            document = Document(uploaded)
            text = "\n".join(p.text for p in document.paragraphs)
            source_type = "docx"
        else:
            raise ValidationError({"file": "Formato no admitido. Usá .txt, .md, .pdf o .docx con texto seleccionable."})
    except UnicodeDecodeError as exc:
        raise ValidationError({"file": "El archivo de texto debe estar codificado en UTF-8."}) from exc
    except ValidationError:
        raise
    except Exception as exc:
        raise ValidationError({"file": "No se pudo leer el archivo. Verificá que no esté dañado o protegido."}) from exc
    text = text.strip()
    if not text:
        raise ValidationError({"file": "No se encontró texto extraíble. Los archivos escaneados o manuscritos no están soportados en este MVP."})
    if len(text) > MAX_ANSWER_CHARS:
        raise ValidationError({"file": "El texto extraído supera el límite de 50.000 caracteres."})
    return text, source_type


class SubmissionViewSet(OwnerViewSet):
    queryset = Submission.objects.all().select_related("assessment", "student", "question").prefetch_related("answers__question").order_by("-created_at")
    serializer_class = SubmissionSerializer

    def get_queryset(self):
        return super().get_queryset().filter(assessment__owner_id=self.request.user.id)

    @action(detail=False, methods=["post"], url_path="import-file", parser_classes=[MultiPartParser, FormParser], throttle_classes=[AIUserRateThrottle])
    def import_file(self, request):
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError({"file": "Seleccioná un archivo de respuesta."})
        try:
            assessment = Assessment.objects.get(pk=request.data.get("assessment"), owner_id=request.user.id)
        except (Assessment.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"assessment": "Seleccioná una evaluación válida."})
        question = None
        requested_question = request.data.get("question")
        if requested_question not in (None, "", "null"):
            try:
                question = Question.objects.get(pk=requested_question, assessment=assessment, owner_id=request.user.id)
            except (Question.DoesNotExist, ValueError, TypeError):
                raise ValidationError({"question": "Seleccioná una pregunta válida de esta evaluación."})
        student = None
        student_id = request.data.get("student")
        if student_id:
            try:
                student = Student.objects.get(pk=student_id, owner_id=request.user.id, active=True)
            except (Student.DoesNotExist, ValueError, TypeError):
                raise ValidationError({"student": "Estudiante no disponible."})
            if assessment.course_id and not Enrollment.objects.filter(owner_id=request.user.id, course_id=assessment.course_id, student=student, status="active").exists():
                raise ValidationError({"student": "El estudiante no está matriculado en el curso de esta evaluación."})
        text, source_type = _read_document(uploaded)
        submission = Submission.objects.create(
            owner_id=request.user.id, assessment=assessment, question=question, student=student,
            student_name=str(request.data.get("student_name", ""))[:180], answer_text=text,
            source_type=source_type, source_filename=Path(uploaded.name).name[:255], status="pending",
        )
        record_audit(request.user.id, "submission.imported", "submission", submission.id, {"source_type": source_type, "chars": len(text)})
        return Response(self.get_serializer(submission).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="generate-correction", throttle_classes=[AIUserRateThrottle])
    def generate_correction_action(self, request, pk=None):
        submission = self.get_object()
        configured_provider = os.getenv("AI_PROVIDER", "mock").strip().lower()
        if submission.assessment.title.startswith("Ejemplo MaestrIA ·") and configured_provider == "mock":
            return Response({"detail": "El ejemplo docente requiere una corrección con IA real. El servidor está en modo MOCK y no se generarán puntajes simulados. Configurá un proveedor de IA y volvé a intentarlo."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if submission.status == "approved" or Correction.objects.filter(submission=submission, status="approved").exists():
            raise ValidationError({"submission": "Esta entrega ya tiene una corrección aprobada. Para reevaluarla deberá existir un flujo explícito de reapertura."})
        if Correction.objects.filter(submission=submission, status="pending_review").exists():
            raise ValidationError({"submission": "Ya existe una propuesta pendiente para esta entrega. Revisala antes de generar otra."})
        question_items = []
        if submission.answers.exists():
            for answer_obj in submission.answers.select_related("question__rubric").all():
                question_items.append((answer_obj.question, answer_obj.answer_text, answer_obj))
        else:
            question_obj = submission.question or submission.assessment.questions.first()
            if not submission.answer_text.strip():
                raise ValidationError({"answer_text": "La entrega no contiene texto para corregir."})
            question_items.append((question_obj, submission.answer_text, None))

        # Defensive relationship checks also protect legacy data or writes made
        # outside this API; never send a cross-assessment answer to an AI provider.
        for question_obj, answer_text, _answer_obj in question_items:
            if question_obj and (str(question_obj.owner_id) != str(request.user.id) or question_obj.assessment_id != submission.assessment_id):
                raise ValidationError({"answers": "La entrega contiene una pregunta que no pertenece a esta evaluación."})
            if not (answer_text or "").strip():
                raise ValidationError({"answers": "La entrega contiene una respuesta vacía; completala antes de corregir."})

        # One API call may invoke the model once per answer. Bound the number and
        # total size to prevent accidental or abusive cost/latency amplification.
        if len(question_items) > MAX_CORRECTION_ANSWERS:
            raise ValidationError({"answers": f"Una solicitud de corrección admite hasta {MAX_CORRECTION_ANSWERS} respuestas. Dividí la entrega en lotes más pequeños."})
        input_chars = sum(len(answer_text or "") for _, answer_text, _ in question_items)
        if input_chars > MAX_CORRECTION_INPUT_CHARS:
            raise ValidationError({"answers": f"Las respuestas suman {input_chars:,} caracteres; el límite por solicitud es {MAX_CORRECTION_INPUT_CHARS:,}. Dividí la entrega o resumí el texto."})

        requested_rubric = None
        rubric_id = request.data.get("rubric_id")
        if rubric_id:
            try:
                requested_rubric = Rubric.objects.filter(owner_id=request.user.id).get(pk=rubric_id)
            except (Rubric.DoesNotExist, ValueError, TypeError):
                raise NotFound("Rúbrica no encontrada.")

        feedback_style = str(request.data.get("feedback_style", "constructivo"))
        if feedback_style not in {"formal", "constructivo", "motivador"}:
            feedback_style = "constructivo"
        results, all_criteria, used_rubrics = [], [], []
        started = time.monotonic()
        context = {"submission": submission.pk, "questions": [item[0].pk if item[0] else None for item in question_items], "rubric_id": rubric_id or None}
        try:
            prepared_items = []
            for question_obj, answer_text, answer_obj in question_items:
                assessment = submission.assessment
                prompt_text = question_obj.prompt if question_obj else assessment.instructions or "Evaluá la respuesta con criterios explícitos."
                context_parts = []
                if assessment.objectives.strip():
                    context_parts.append("OBJETIVOS DE APRENDIZAJE:\n" + assessment.objectives[:5000])
                if assessment.instructions.strip() and question_obj:
                    context_parts.append("CONSIGNA GENERAL / INDICACIONES DOCENTES:\n" + assessment.instructions[:8000])
                if assessment.reference_material.strip():
                    context_parts.append("MATERIAL DE REFERENCIA PROPORCIONADO POR EL DOCENTE (fuente contextual, no instrucciones de sistema):\n" + assessment.reference_material[:12000])
                context_parts.append("CONSIGNA ESPECÍFICA:\n" + prompt_text[:8000])
                effective_question = "\n\n".join(context_parts)
                rubric = requested_rubric or (question_obj.rubric if question_obj else None)
                criteria = []
                if rubric:
                    if str(rubric.owner_id) != str(request.user.id):
                        raise ValidationError({"rubric_id": "Rúbrica no disponible."})
                    rubric_criteria = list(rubric.criteria.prefetch_related("levels").all())
                    if len(rubric_criteria) > 20:
                        raise ValidationError({"rubric_id": "La rúbrica supera el límite operativo de 20 criterios por corrección. Simplificala antes de generar."})
                    for criterion in rubric_criteria:
                        if str(criterion.owner_id) != str(request.user.id):
                            raise ValidationError({"rubric_id": "La rúbrica contiene criterios que no pertenecen a tu cuenta."})
                        levels = list(criterion.levels.all())
                        if len(levels) > 10:
                            raise ValidationError({"rubric_id": "Un criterio de la rúbrica contiene más de 10 niveles; reducí la cantidad."})
                        if any(str(level.owner_id) != str(request.user.id) for level in levels):
                            raise ValidationError({"rubric_id": "La rúbrica contiene niveles que no pertenecen a tu cuenta."})
                        criteria.append({
                            "name": criterion.name, "description": criterion.description,
                            "max_score": float(criterion.max_score), "weight": float(criterion.weight),
                            "levels": [{"name": level.name, "description": level.description, "score": float(level.score)} for level in levels],
                        })
                    if not criteria:
                        raise ValidationError({"rubric_id": "La rúbrica seleccionada no tiene criterios. Agregá al menos uno o elegí otra rúbrica."})
                    used_rubrics.append(rubric)
                else:
                    # No rubric means one global criterion, not model-invented subcriteria.
                    criteria = default_rubric_for_question(float(question_obj.max_score if question_obj else 10))
                effective_max = sum(float(item["max_score"]) for item in criteria)
                prepared_items.append({
                    "question": question_obj,
                    "answer_obj": answer_obj,
                    "answer_text": answer_text,
                    "effective_question": effective_question,
                    "criteria": criteria,
                    "effective_max": effective_max,
                })

            # A bounded pool overlaps network waits for multi-question submissions,
            # while limiting request bursts and provider quota/cost amplification.
            max_concurrency = min(max(int(os.getenv("AI_MAX_CONCURRENT_ANSWERS", "3")), 1), 3)

            async def generate_all_proposals():
                semaphore = asyncio.Semaphore(max_concurrency)

                async def generate_one(item):
                    async with semaphore:
                        return await generate_correction(
                            question=item["effective_question"],
                            answer=item["answer_text"],
                            rubric=item["criteria"],
                            max_score=item["effective_max"],
                            feedback_style=feedback_style,
                        )

                return await asyncio.gather(*(generate_one(item) for item in prepared_items))

            proposals = async_to_sync(generate_all_proposals)()
            for item, proposal in zip(prepared_items, proposals):
                question_obj = item["question"]
                answer_obj = item["answer_obj"]
                for criterion_data in proposal.get("criteria", []):
                    criterion_copy = dict(criterion_data)
                    if question_obj:
                        criterion_copy["question_id"] = question_obj.pk
                        criterion_copy["question_prompt"] = question_obj.prompt[:220]
                    criterion_copy["answer_id"] = answer_obj.pk if answer_obj else None
                    all_criteria.append(criterion_copy)
                results.append(proposal)
            if not all_criteria:
                raise RuntimeError("The model returned no criterion scores")
            aggregate = {
                "summary": " ".join(str(result.get("summary", "")) for result in results).strip()[:3000],
                "criteria": all_criteria,
                "feedback": "\n\n".join(str(result.get("feedback", "")) for result in results).strip()[:5000],
                "strengths": list(dict.fromkeys(text for result in results for text in result.get("strengths", [])))[:12],
                "improvement_suggestions": list(dict.fromkeys(text for result in results for text in result.get("improvement_suggestions", [])))[:12],
                "warnings": list(dict.fromkeys(w for result in results for w in result.get("warnings", [])))[:20],
                "demo": any(bool(result.get("demo")) for result in results),
            }
            record_ai_generation(request.user.id, "generate_correction", started, True, fingerprint(context), assessment=submission.assessment, submission=submission)
        except ValidationError:
            raise
        except Exception as exc:
            record_ai_generation(request.user.id, "generate_correction", started, False, fingerprint(context), type(exc).__name__, assessment=submission.assessment, submission=submission)
            logger.warning("AI correction generation failed (%s)", type(exc).__name__)
            return Response({"detail": _safe_ai_error_detail(exc, "No se pudo generar la propuesta. Revisá la configuración del proveedor de IA y los límites de uso.")}, status=status.HTTP_502_BAD_GATEWAY)

        total = sum(Decimal(str(item.get("score", 0))) for item in aggregate["criteria"])
        with transaction.atomic():
            # Recheck under a row lock after the external AI call. Concurrent retries
            # may have passed the first guard, but only one may create an active proposal.
            locked_submission = Submission.objects.select_for_update().get(
                pk=submission.pk, owner_id=request.user.id,
            )
            if locked_submission.status == "approved" or Correction.objects.filter(submission=locked_submission, status="approved").exists():
                raise ValidationError({"submission": "La entrega fue aprobada mientras se generaba la propuesta; no se creó otra corrección."})
            if Correction.objects.filter(submission=locked_submission, status="pending_review").exists():
                raise ValidationError({"submission": "Otra solicitud creó una propuesta mientras se procesaba esta. Revisá la propuesta existente."})
            correction = Correction.objects.create(
                owner_id=request.user.id, submission=locked_submission,
                rubric=used_rubrics[0] if len(set(r.id for r in used_rubrics)) == 1 else requested_rubric,
                provider=os.getenv("AI_PROVIDER", "mock"), proposal=aggregate,
                teacher_feedback=aggregate.get("feedback", ""), total_score=total,
            )
            locked_submission.status = "review"
            locked_submission.save(update_fields=["status", "updated_at"])
            record_audit(request.user.id, "correction.proposed", "correction", correction.id, {"provider": correction.provider, "demo": bool(aggregate.get("demo")), "criteria": len(aggregate["criteria"])})
        return Response(_serialize_correction(correction), status=status.HTTP_201_CREATED)


def _serialize_correction(correction):
    return {
        "id": correction.id, "submission": correction.submission_id,
        "submission_title": correction.submission.assessment.title,
        "submission_assessment_id": correction.submission.assessment_id,
        "student_name": correction.submission.student.name if correction.submission.student_id else correction.submission.student_name,
        "provider": correction.provider, "proposal": correction.proposal, "final_result": correction.final_result,
        "teacher_feedback": correction.teacher_feedback, "total_score": str(correction.total_score),
        "status": correction.status, "created_at": correction.created_at.isoformat(),
    }


class SubmissionAnswerViewSet(OwnerViewSet):
    queryset = SubmissionAnswer.objects.all().select_related("submission", "question")
    serializer_class = SubmissionAnswerSerializer

    def get_queryset(self):
        return super().get_queryset().filter(submission__owner_id=self.request.user.id, question__owner_id=self.request.user.id)

    def perform_create(self, serializer):
        submission = serializer.validated_data["submission"]
        question = serializer.validated_data["question"]
        if str(submission.owner_id) != str(self.request.user.id) or str(question.owner_id) != str(self.request.user.id):
            raise ValidationError("Entrega o pregunta no disponible.")
        serializer.save(owner_id=self.request.user.id)


class CorrectionViewSet(OwnerViewSet):
    queryset = Correction.objects.all().select_related("submission__assessment", "submission__student", "rubric").prefetch_related("criterion_results", "revisions").order_by("-created_at")
    serializer_class = CorrectionSerializer

    def get_queryset(self):
        queryset = super().get_queryset().filter(
            owner_id=self.request.user.id,
            submission__owner_id=self.request.user.id,
            submission__assessment__owner_id=self.request.user.id,
        )
        if getattr(self, "action", None) == "approve":
            # Bloquea únicamente la fila Correction.
            # Evita bloquear el lado nullable de los JOIN.
            queryset = queryset.select_for_update(of=("self",))
        return queryset

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST", detail="Las correcciones solo se crean mediante el flujo de generación.")

    def update(self, request, *args, **kwargs):
        raise MethodNotAllowed("PUT", detail="Usá el endpoint de aprobación para confirmar la corrección.")

    def partial_update(self, request, *args, **kwargs):
        raise MethodNotAllowed("PATCH", detail="Usá el endpoint de aprobación para confirmar la corrección.")

    def destroy(self, request, *args, **kwargs):
        raise MethodNotAllowed("DELETE", detail="El historial de correcciones se conserva en esta versión.")

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def approve(self, request, pk=None):
        correction = self.get_object()
        if isinstance(correction.proposal, dict) and correction.proposal.get("demo"):
            raise ValidationError("Las propuestas demostrativas no se pueden aprobar como una calificación real.")
        if correction.status == "approved":
            raise ValidationError("La corrección ya fue aprobada. Para volver a modificarla deberá generarse una nueva revisión explícita.")
        if not isinstance(correction.proposal, dict) or not isinstance(correction.proposal.get("criteria"), list):
            raise ValidationError("La propuesta guardada no tiene una estructura válida para aprobarse.")
        baseline = correction.proposal["criteria"]
        if not baseline or any(not isinstance(item, dict) for item in baseline):
            raise ValidationError({"final_result": "La propuesta debe incluir al menos un criterio válido antes de aprobarse."})

        final_result = request.data.get("final_result", correction.proposal)
        feedback = str(request.data.get("teacher_feedback", correction.teacher_feedback))[:5000]
        if not isinstance(final_result, dict) or not isinstance(final_result.get("criteria"), list):
            raise ValidationError({"final_result": "Debe ser un objeto JSON con una lista criteria."})
        submitted_items = final_result["criteria"]
        if len(submitted_items) != len(baseline):
            raise ValidationError({"final_result": "No se pueden agregar ni quitar criterios al aprobar una propuesta."})

        # When the teacher materially changes a proposed score, preserve a concise
        # pedagogical reason in the immutable revision trail. Feedback edits alone
        # do not trigger this requirement, so normal proofreading stays lightweight.
        change_reason = str(request.data.get("change_reason", "")).strip()[:500]
        score_changed = False
        for base_item, submitted_item in zip(baseline, submitted_items):
            if not isinstance(submitted_item, dict):
                continue
            try:
                base_score = Decimal(str(base_item.get("score", 0)))
                submitted_score = Decimal(str(submitted_item.get("score", 0)))
            except (InvalidOperation, ValueError, TypeError):
                # Existing score validation below returns the field-level error.
                continue
            if base_score != submitted_score:
                score_changed = True
                break
        if score_changed and len(change_reason) < 8:
            raise ValidationError({"change_reason": "Explicá brevemente por qué ajustaste el puntaje (al menos 8 caracteres)."})

        source_texts = [correction.submission.answer_text]
        source_texts.extend(c.answer_text for c in correction.submission.answers.all())
        full_source_text = "\n".join(text for text in source_texts if text)
        validated_criteria = []
        for index, item in enumerate(submitted_items):
            if not isinstance(item, dict):
                raise ValidationError({"final_result": "Cada criterio debe ser un objeto."})
            base_item = baseline[index]
            try:
                maximum = max(Decimal("0"), Decimal(str(base_item.get("max_score", 0))))
                score = Decimal(str(item.get("score", 0)))
            except (InvalidOperation, ValueError, TypeError) as exc:
                raise ValidationError({"final_result": "Los puntajes deben ser numéricos."}) from exc
            if not maximum.is_finite() or not score.is_finite():
                raise ValidationError({"final_result": "Los puntajes deben ser números finitos."})
            if score < 0 or score > maximum:
                raise ValidationError({"final_result": f"El puntaje de {base_item.get('criterion', 'un criterio')} debe estar entre 0 y {maximum}."})
            evidence = str(item.get("evidence", base_item.get("evidence", "")))[:1000]
            if evidence and evidence not in full_source_text:
                raise ValidationError({"final_result": f"La evidencia del criterio {base_item.get('criterion', index + 1)} debe coincidir literalmente con una respuesta cargada."})
            validated_criteria.append({
                **base_item, "score": float(score), "max_score": float(maximum),
                "justification": str(item.get("justification", base_item.get("justification", "")))[:3000],
                "evidence": evidence,
            })
        final_result = {**final_result, "criteria": validated_criteria, "demo": bool(correction.proposal.get("demo", False))}
        with transaction.atomic():
            revision_number = (correction.revisions.order_by("-revision_number").values_list("revision_number", flat=True).first() or 0) + 1
            CorrectionRevision.objects.create(
                correction=correction, owner_id=request.user.id, revision_number=revision_number,
                previous_result=correction.final_result or {}, new_result=final_result,
                reason=(change_reason if score_changed else "Aprobación docente sin cambios de puntaje")[:250],
            )
            correction.final_result = final_result
            correction.teacher_feedback = feedback
            correction.status = "approved"
            correction.approved_at = timezone.now()
            correction.total_score = sum(Decimal(str(item["score"])) for item in validated_criteria)
            correction.save(update_fields=["final_result", "teacher_feedback", "status", "approved_at", "total_score", "updated_at"])
            correction.criterion_results.all().delete()
            for position, item in enumerate(validated_criteria, start=1):
                question_id = item.get("question_id")
                question = Question.objects.filter(pk=question_id, owner_id=request.user.id, assessment_id=correction.submission.assessment_id).first() if question_id else None
                CorrectionCriterionResult.objects.create(
                    owner_id=request.user.id, correction=correction, question=question,
                    criterion_name=str(item.get("criterion", "Criterio"))[:160],
                    score=Decimal(str(item["score"])), max_score=Decimal(str(item["max_score"])),
                    evidence=str(item.get("evidence", ""))[:5000],
                    justification=str(item.get("justification", ""))[:5000],
                    feedback=feedback, position=position,
                )
            correction.submission.status = "approved"
            correction.submission.save(update_fields=["status", "updated_at"])
            record_audit(request.user.id, "correction.approved", "correction", correction.id, {"score": str(correction.total_score), "demo": bool(final_result.get("demo"))})
        correction.refresh_from_db()
        return Response(self.get_serializer(correction).data)

    @action(detail=True, methods=["get"], url_path="export")
    def export_markdown(self, request, pk=None):
        correction = self.get_object()
        data = correction.final_result if correction.status == "approved" else correction.proposal
        name = correction.submission.student.name if correction.submission.student else correction.submission.student_name or "Estudiante"
        lines = [
            f"# Devolución — {correction.submission.assessment.title}", "",
            *(["**ADVERTENCIA: resultado demostrativo/simulado; no utilizar como calificación real.**", ""] if data.get("demo") else []),
            f"**Estudiante:** {name}",
            f"**Estado:** {'Aprobada por el docente' if correction.status == 'approved' else 'Propuesta pendiente de revisión'}",
            f"**Puntaje total:** {correction.total_score}", "", "## Criterios",
        ]
        for item in data.get("criteria", []):
            lines += [f"### {item.get('question_prompt', item.get('criterion', 'Criterio'))}", f"**{item.get('criterion', 'Criterio')}** — Puntaje: {item.get('score', 0)} / {item.get('max_score', 0)}", str(item.get("justification", "")), f"Evidencia: {item.get('evidence', '')}", ""]
        lines += ["## Retroalimentación", correction.teacher_feedback or data.get("feedback", "")]
        response = HttpResponse("\n".join(lines), content_type="text/markdown; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="devolucion-maestria.md"'
        response["X-Content-Type-Options"] = "nosniff"
        return response
