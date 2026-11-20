import re
import unicodedata

from django.db.models import F, Sum
from rest_framework.exceptions import APIException

from ..ai import DEFAULT_ASSESSMENT_SCALE
from ..ai_guard import ai_slot, run_with_deadline
from ..context_quality import context_notes_for

from .common import (
    AIUserRateThrottle,
    Coalesce,
    Count,
    IntegerField,
    OuterRef,
    Subject,
    SubjectSerializer,
    Subquery,
    Value,
    assessments_in_course,
    corrections_in_course,
    Assessment,
    AssessmentEditorSerializer,
    AssessmentListSerializer,
    AssessmentSerializer,
    Course,
    CourseNavigationSerializer,
    CourseOptionSerializer,
    CourseSerializer,
    Decimal,
    DjangoValidationError,
    InvalidOperation,
    Enrollment,
    EnrollmentSerializer,
    FormParser,
    MAX_ANSWER_CHARS,
    Max,
    MultiPartParser,
    OwnerViewSet,
    Question,
    QuestionSerializer,
    Response,
    Rubric,
    RubricCriterion,
    RubricCriterionSerializer,
    RubricLevel,
    RubricLevelSerializer,
    RubricSerializer,
    Student,
    StudentSerializer,
    Submission,
    SubmissionAnswer,
    ValidationError,
    _read_document,
    ai_error_code,
    ai_error_response,
    action,
    active_ai_provider_config,
    async_to_sync,
    courses_with_dashboard_counts,
    csv,
    fingerprint,
    generate_questions,
    has_fresh_processing_submission,
    lock_owner_profile,
    generate_rubric,
    io,
    logger,
    record_ai_generation,
    record_audit,
    status,
    time,
    transaction,
    validate_email,
)

def _positive_int_param(request, name, label):
    raw = request.query_params.get(name)
    if raw is None:
        return None
    try:
        value = int(raw)
        if value < 1:
            raise ValueError
    except (TypeError, ValueError):
        raise ValidationError({name: f"El filtro de {label} debe ser un identificador válido."})
    return value


def resolve_subject(owner_id, *, subject=None, subject_name="", level=""):
    """Materia elegida o, si sólo llega el nombre, la existente con ese nombre o una nueva.

    Permite crear una comisión escribiendo la materia sin un paso previo (y mantiene
    compatible a quien todavía envía `subject` como texto). Llamar con el perfil bloqueado.
    """
    if subject is not None:
        return subject
    name = " ".join(str(subject_name or "").split())[:160]
    if not name:
        return None
    existing = Subject.objects.filter(owner_id=owner_id, name__iexact=name).first()
    if existing:
        if not existing.active:
            existing.active = True
            existing.save(update_fields=["active", "updated_at"])
        return existing
    return Subject.objects.create(owner_id=owner_id, name=name, level=str(level or "")[:120])


class SubjectViewSet(OwnerViewSet):
    """Materias del docente. `?nav=1` las devuelve con sus comisiones para la navegación."""
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer

    def get_queryset(self):
        owner_id = self.request.user.id
        course_count = (
            Course.objects.filter(owner_id=owner_id, subject_ref_id=OuterRef("pk"), active=True)
            .order_by().values("subject_ref_id").annotate(total=Count("id")).values("total")[:1]
        )
        assessment_count = (
            Assessment.objects.filter(owner_id=owner_id, subject_ref_id=OuterRef("pk"))
            .exclude(status="archived").order_by().values("subject_ref_id").annotate(total=Count("id")).values("total")[:1]
        )
        return Subject.objects.filter(owner_id=owner_id).annotate(
            course_count=Coalesce(Subquery(course_count, output_field=IntegerField()), Value(0)),
            assessment_count=Coalesce(Subquery(assessment_count, output_field=IntegerField()), Value(0)),
        ).order_by("name", "id")

    def list(self, request, *args, **kwargs):
        if request.query_params.get("nav") != "1":
            return super().list(request, *args, **kwargs)
        subjects = list(self.get_queryset())
        courses = CourseNavigationSerializer(
            Course.objects.filter(owner_id=request.user.id).select_related("subject_ref").order_by("name", "id"), many=True,
        ).data
        by_subject = {}
        for course in courses:
            by_subject.setdefault(course["subject_id"], []).append(course)
        payload = [{**SubjectSerializer(item, context={"request": request}).data, "courses": by_subject.get(item.pk, [])} for item in subjects]
        # Comisiones creadas por la versión anterior sin materia: se muestran aparte.
        return Response({"results": payload, "unassigned_courses": by_subject.get(None, [])})

    def _save_subject(self, serializer, **kwargs):
        owner_id = self.request.user.id
        with transaction.atomic():
            lock_owner_profile(owner_id)
            name = serializer.validated_data.get("name", getattr(serializer.instance, "name", ""))
            duplicates = Subject.objects.filter(owner_id=owner_id, name__iexact=name)
            if serializer.instance:
                duplicates = duplicates.exclude(pk=serializer.instance.pk)
            if duplicates.exists():
                raise ValidationError({"name": "Ya tenés una materia con ese nombre."})
            subject = serializer.save(**kwargs)
            if serializer.instance and "name" in serializer.validated_data:
                # Texto heredado que todavía lee la versión anterior desplegada.
                Course.objects.filter(owner_id=owner_id, subject_ref=subject).update(subject=subject.name[:120])
                Assessment.objects.filter(owner_id=owner_id, subject_ref=subject).update(subject=subject.name[:120])

    def perform_create(self, serializer):
        self._save_subject(serializer, owner_id=self.request.user.id, active=True)

    def perform_update(self, serializer):
        self._save_subject(serializer)

    def perform_destroy(self, instance):
        # Archivar la materia archiva sus comisiones; el historial se conserva.
        with transaction.atomic():
            lock_owner_profile(self.request.user.id)
            Subject.objects.filter(pk=instance.pk, owner_id=self.request.user.id).update(active=False)
            Course.objects.filter(owner_id=self.request.user.id, subject_ref_id=instance.pk, active=True).update(active=False)
            record_audit(self.request.user.id, "subject.archived", "subject", instance.pk, {}, request=self.request)


class CourseViewSet(OwnerViewSet):
    # Keep a model-bound queryset for router basename discovery. The full list
    # uses correlated subqueries to avoid enrollment × assessment row fan-out.
    queryset = Course.objects.all()
    serializer_class = CourseSerializer

    def get_queryset(self):
        # Navigation and selector calls do not need expensive aggregate counts or
        # long descriptions. Keep the rich annotated queryset for the course page.
        if self.action == "list" and self.request.query_params.get("nav") == "1":
            queryset = Course.objects.filter(owner_id=self.request.user.id).select_related("subject_ref").only(
                "id", "name", "subject", "subject_ref", "shift", "level", "academic_year", "active",
                "subject_ref__id", "subject_ref__name",
            ).order_by("name", "id")
        else:
            queryset = courses_with_dashboard_counts(self.request.user.id)
        subject_id = _positive_int_param(self.request, "subject", "materia")
        return queryset.filter(subject_ref_id=subject_id) if subject_id else queryset

    def get_serializer_class(self):
        if self.action == "list" and self.request.query_params.get("nav") == "1":
            return CourseNavigationSerializer
        return super().get_serializer_class()

    @action(detail=True, methods=["get"], url_path="grades-export")
    def grades_export(self, request, pk=None):
        """Planilla de notas del curso (CSV para Excel en español).

        Una fila por estudiante con matrícula activa y una columna por evaluación con la
        nota de la corrección APROBADA (las propuestas sin aprobar no son calificaciones).
        Separador «;», coma decimal y BOM UTF-8 para que Excel la abra con tildes.
        """
        from django.http import HttpResponse
        from ..models import Correction

        owner_id = request.user.id
        course = Course.objects.filter(pk=pk, owner_id=owner_id).first()
        if course is None:
            from rest_framework.exceptions import NotFound
            raise NotFound("Curso no disponible.")
        # Evaluaciones de la materia asignadas a esta comisión. Los puntos se suman en una
        # subconsulta: sumar sobre el JOIN con las asignaciones duplicaría consignas.
        points = (
            Question.objects.filter(assessment_id=OuterRef("pk")).order_by()
            .values("assessment_id").annotate(total=Sum("max_score")).values("total")[:1]
        )
        assessments = list(
            assessments_in_course(Assessment.objects.filter(owner_id=owner_id), course.pk).order_by("created_at", "id")
            .annotate(points=Subquery(points)).values("id", "title", "points")
        )
        # Máximo de cada evaluación (suma de sus consignas; 10 si no tiene), para
        # correcciones cuyo resultado no detalla los máximos por criterio.
        assessment_max = {item["id"]: float(item["points"] or DEFAULT_ASSESSMENT_SCALE) for item in assessments}
        enrollments = list(
            Enrollment.objects.filter(
                owner_id=owner_id, course=course, status="active",
                student__owner_id=owner_id, student__active=True,
            )
            .select_related("student").order_by("student__name", "student_id")
        )
        # La aprobación más reciente por estudiante y evaluación (una entrega puede tener historial).
        # Se guarda también el máximo de esa corrección para promediar en una escala común.
        grades = {}
        approved = (
            corrections_in_course(Correction.objects.filter(
                owner_id=owner_id, status="approved", submission__owner_id=owner_id,
                submission__student__isnull=False,
            ), course.pk)
            .order_by("approved_at", "id")
            .values_list("submission__student_id", "submission__assessment_id", "total_score", "final_result")
        )
        for student_id, assessment_id, total, final_result in approved:
            criteria = (final_result or {}).get("criteria") if isinstance(final_result, dict) else None
            maximum = sum(float(item.get("max_score") or 0) for item in criteria if isinstance(item, dict)) if isinstance(criteria, list) else 0.0
            grades[(student_id, assessment_id)] = (total, maximum or assessment_max.get(assessment_id, DEFAULT_ASSESSMENT_SCALE))

        def cell(value):
            # Evita inyección de fórmulas al abrir el CSV en Excel/Sheets (=, +, -, @).
            text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
            return "'" + text if text[:1] in ("=", "+", "-", "@", "\t") else text

        def number(value):
            return f"{float(value):.2f}".rstrip("0").rstrip(".").replace(".", ",")

        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
        writer.writerow(["Estudiante", "Legajo", "Correo", *(cell(item["title"]) for item in assessments), "Promedio (sobre 10)"])
        for enrollment in enrollments:
            student = enrollment.student
            scores = [grades.get((student.pk, item["id"])) for item in assessments]
            # Cada evaluación puede tener otro puntaje máximo (10, 20, 100…): el promedio
            # normaliza cada nota a 10 en lugar de mezclar escalas.
            normalized = [float(total) / maximum * 10 for total, maximum in (s for s in scores if s is not None) if maximum > 0]
            average = number(sum(normalized) / len(normalized)) if normalized else ""
            writer.writerow([cell(student.name), cell(student.external_code), cell(student.email), *(number(score[0]) if score is not None else "" for score in scores), average])

        slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", course.name).encode("ascii", "ignore").decode().lower()).strip("-")[:60] or "curso"
        record_audit(owner_id, "course.grades_exported", "course", course.pk, {"students": len(enrollments), "assessments": len(assessments)}, request=request)
        response = HttpResponse("﻿" + buffer.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="notas-{slug}.csv"'
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def _save_course(self, serializer, **kwargs):
        owner_id = kwargs.get("owner_id") or self.request.user.id
        with transaction.atomic():
            # Serialize per-owner duplicate checks using the application-owned
            # profile row; never lock Supabase's internal auth.users table.
            lock_owner_profile(owner_id)
            if serializer.instance:
                serializer.instance = Course.objects.select_for_update().get(
                    pk=serializer.instance.pk, owner_id=owner_id,
                )
            data = serializer.validated_data
            subject = data.get("subject_ref", getattr(serializer.instance, "subject_ref", None))
            name = data.get("name", getattr(serializer.instance, "name", "")).strip()
            if subject is None and "subject_ref" not in data:
                # Sin materia elegida: el nombre escrito o, como en la migración, el del
                # propio curso (crea la materia si no existe). Mantiene compatible la API.
                subject = resolve_subject(owner_id, subject_name=self.request.data.get("subject", "") or name, level=data.get("level", ""))
            year = data.get("academic_year", getattr(serializer.instance, "academic_year", ""))
            # La misma comisión puede repetirse en otra materia o en otro ciclo lectivo.
            duplicates = Course.objects.filter(owner_id=owner_id, name__iexact=name, academic_year=year, subject_ref=subject)
            if serializer.instance:
                duplicates = duplicates.exclude(pk=serializer.instance.pk)
            if duplicates.exists():
                raise ValidationError({"name": "Esa materia ya tiene un curso o comisión con ese nombre en el mismo ciclo lectivo."})
            if subject is None and serializer.instance is None:
                raise ValidationError({"subject_id": "Elegí la materia o escribí su nombre para crear la comisión."})
            if subject is not None:
                kwargs["subject_ref"] = subject
                # Texto heredado que todavía lee la versión anterior desplegada.
                kwargs["subject"] = subject.name[:120]
            serializer.save(**kwargs)

    def perform_create(self, serializer):
        # New courses always start active; archiving is a post-creation action.
        self._save_course(serializer, owner_id=self.request.user.id, active=True)

    def perform_update(self, serializer):
        self._save_course(serializer)

    def perform_destroy(self, instance):
        # Serialize archival with enrollment writes and keep historical relations.
        with transaction.atomic():
            lock_owner_profile(self.request.user.id)
            course = Course.objects.select_for_update().get(
                pk=instance.pk, owner_id=self.request.user.id,
            )
            if course.active:
                course.active = False
                course.save(update_fields=["active", "updated_at"])

class EnrollmentViewSet(OwnerViewSet):
    queryset = Enrollment.objects.all().select_related("course", "student")
    serializer_class = EnrollmentSerializer

    def perform_create(self, serializer):
        with transaction.atomic():
            lock_owner_profile(self.request.user.id)
            course = serializer.validated_data["course"]
            student = serializer.validated_data["student"]
            course = Course.objects.select_for_update().get(pk=course.pk, owner_id=self.request.user.id)
            student = Student.objects.select_for_update().get(pk=student.pk, owner_id=self.request.user.id)
            next_status = serializer.validated_data.get("status", "active")
            if next_status == "active" and not course.active:
                raise ValidationError({"course": "No se puede activar una matrícula en un curso archivado."})
            if next_status == "active" and not student.active:
                raise ValidationError({"student": "No se puede activar una matrícula para un estudiante inactivo."})
            # uniq_enrollment_course_student no tiene predicado: hay a lo sumo una fila
            # por curso y estudiante. Rematricular reactiva la existente (AUD-003).
            existing = Enrollment.objects.select_for_update().filter(
                owner_id=self.request.user.id, course_id=course.pk, student_id=student.pk,
            ).first()
            if existing and existing.status == "active":
                raise ValidationError({"student": "El estudiante ya tiene una matrícula activa en este curso."})
            if existing:
                serializer.instance = existing
                serializer.save()
                return
            serializer.save(owner_id=self.request.user.id, course=course, student=student)

    def perform_update(self, serializer):
        with transaction.atomic():
            lock_owner_profile(self.request.user.id)
            course = serializer.validated_data.get("course", serializer.instance.course)
            student = serializer.validated_data.get("student", serializer.instance.student)
            course = Course.objects.select_for_update().get(pk=course.pk, owner_id=self.request.user.id)
            student = Student.objects.select_for_update().get(pk=student.pk, owner_id=self.request.user.id)
            next_status = serializer.validated_data.get("status", serializer.instance.status)
            if next_status == "active" and not course.active:
                raise ValidationError({"course": "No se puede activar una matrícula en un curso archivado."})
            if next_status == "active" and not student.active:
                raise ValidationError({"student": "No se puede activar una matrícula para un estudiante inactivo."})
            if next_status == "active":
                duplicate = Enrollment.objects.filter(owner_id=self.request.user.id, course_id=course.pk, student_id=student.pk, status="active").exclude(pk=serializer.instance.pk)
                if duplicate.exists():
                    raise ValidationError({"student": "El estudiante ya tiene una matrícula activa en este curso."})
            serializer.save()

    MAX_BULK_ENROLLMENTS = 500

    @action(detail=False, methods=["post"], url_path="bulk")
    def bulk(self, request):
        """Matricula de una vez varios estudiantes ya cargados en un curso.

        Todo o nada: si algún estudiante no es del docente o está inactivo, no se
        matricula ninguno. Los ya activos se informan como omitidos y las matrículas
        inactivas se reactivan (uniq_enrollment_course_student admite una fila por par).
        """
        raw_ids = request.data.get("students")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise ValidationError({"students": "Elegí al menos un estudiante."})
        if len(raw_ids) > self.MAX_BULK_ENROLLMENTS:
            raise ValidationError({"students": f"Podés matricular hasta {self.MAX_BULK_ENROLLMENTS} estudiantes por vez."})
        try:
            student_ids = list(dict.fromkeys(int(item) for item in raw_ids))
            course_id = int(request.data.get("course"))
        except (TypeError, ValueError):
            raise ValidationError({"students": "La selección contiene identificadores inválidos."})
        owner_id = request.user.id
        with transaction.atomic():
            lock_owner_profile(owner_id)
            course = Course.objects.select_for_update().filter(pk=course_id, owner_id=owner_id).first()
            if course is None:
                raise ValidationError({"course": "Curso no disponible."})
            if not course.active:
                raise ValidationError({"course": "No se puede matricular en un curso archivado."})
            students = Student.objects.select_for_update().filter(owner_id=owner_id, pk__in=student_ids)
            found = {student.pk: student for student in students}
            if len(found) != len(student_ids):
                raise ValidationError({"students": "Algún estudiante seleccionado no está disponible. Recargá la lista e intentá nuevamente."})
            inactive = [student.name for student in found.values() if not student.active]
            if inactive:
                raise ValidationError({"students": "No se puede matricular a estudiantes inactivos: " + ", ".join(sorted(inactive)[:5]) + "."})
            existing = {
                enrollment.student_id: enrollment
                for enrollment in Enrollment.objects.select_for_update().filter(owner_id=owner_id, course_id=course.pk, student_id__in=student_ids)
            }
            skipped = sum(1 for enrollment in existing.values() if enrollment.status == "active")
            to_reactivate = [enrollment.pk for enrollment in existing.values() if enrollment.status != "active"]
            if to_reactivate:
                Enrollment.objects.filter(pk__in=to_reactivate).update(status="active")
            Enrollment.objects.bulk_create([
                Enrollment(owner_id=owner_id, course=course, student=found[student_id], status="active")
                for student_id in student_ids if student_id not in existing
            ])
            created = len(student_ids) - len(existing)
            record_audit(owner_id, "enrollments.bulk_created", "course", course.pk, {"created": created, "reactivated": len(to_reactivate), "skipped": skipped}, request=request)
        return Response({"created": created, "reactivated": len(to_reactivate), "skipped": skipped}, status=status.HTTP_201_CREATED)

    def get_queryset(self):
        queryset = super().get_queryset().filter(course__owner_id=self.request.user.id, student__owner_id=self.request.user.id)
        course_id = self.request.query_params.get("course")
        if course_id:
            try:
                parsed_course_id = int(course_id)
                if parsed_course_id < 1:
                    raise ValueError
            except (TypeError, ValueError):
                raise ValidationError({"course": "El filtro de curso debe ser un identificador válido."})
            queryset = queryset.filter(course_id=parsed_course_id)
        return queryset

class AssessmentViewSet(OwnerViewSet):
    queryset = Assessment.objects.all().select_related("course", "subject_ref").prefetch_related("course_links").order_by("-updated_at")
    serializer_class = AssessmentSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        course_id = _positive_int_param(self.request, "course", "curso")
        if course_id is not None:
            queryset = assessments_in_course(queryset, course_id)
        subject_id = _positive_int_param(self.request, "subject", "materia")
        if subject_id is not None:
            queryset = queryset.filter(subject_ref_id=subject_id)
        if self.action == "retrieve":
            queryset = queryset.prefetch_related("questions")
        return queryset

    def perform_create(self, serializer):
        with transaction.atomic():
            serializer.save(owner_id=self.request.user.id)

    def get_serializer_class(self):
        if self.action == "list":
            return AssessmentListSerializer
        return super().get_serializer_class()

    def perform_update(self, serializer):
        # El docente puede editar el contexto aunque haya una corrección en
        # curso: el endpoint de corrección comparar updated_at al prepararse y
        # al confirmar, de modo que una edición concurrente solo hace fallar
        # esa corrida (con mensaje de recargar), nunca la corrompe.
        with transaction.atomic():
            assessment = Assessment.objects.select_for_update().get(
                pk=serializer.instance.pk, owner_id=self.request.user.id,
            )
            if has_fresh_processing_submission(assessment, self.request.user.id):
                raise ValidationError({"assessment": "No se puede editar la evaluación mientras se procesa una corrección."})
            serializer.instance = assessment
            serializer.save()

    @action(detail=True, methods=["get"], url_path="editor")
    def editor(self, request, pk=None):
        """Small payload for preparing an evaluation without loading submissions or rubrics."""
        assessment = self.get_object()
        owner_id = request.user.id
        questions = list(Question.objects.filter(owner_id=owner_id, assessment=assessment).order_by("position", "id"))
        courses = CourseOptionSerializer(Course.objects.filter(owner_id=owner_id, active=True).select_related("subject_ref").order_by("name"), many=True).data
        return Response({
            "assessment": AssessmentEditorSerializer(assessment, context={"request": request}).data,
            "questions": QuestionSerializer(questions, many=True, context={"request": request}).data,
            "courses": courses,
            "context_notes": context_notes_for(assessment, questions),
        })

    @action(detail=True, methods=["post"], url_path="reorder-questions")
    def reorder_questions(self, request, pk=None):
        """Reordena todas las consignas en una transacción (AUD-002).

        `uniq_question_position_per_assessment` no es diferible: actualizar las
        posiciones fila por fila (como hacía el cliente con un PATCH por consigna)
        choca con la posición que todavía ocupa la otra fila. Aquí se desplazan todas
        fuera de rango con un solo UPDATE y luego se asignan las definitivas.
        """
        assessment = self.get_object()
        raw_order = request.data.get("order")
        if not isinstance(raw_order, list) or not raw_order:
            raise ValidationError({"order": "Enviá la lista completa de consignas en el nuevo orden."})
        try:
            order = [int(item) for item in raw_order]
        except (TypeError, ValueError):
            raise ValidationError({"order": "La lista de consignas contiene identificadores inválidos."})
        if len(set(order)) != len(order):
            raise ValidationError({"order": "La lista de consignas tiene elementos repetidos."})
        with transaction.atomic():
            assessment = Assessment.objects.select_for_update().get(pk=assessment.pk, owner_id=request.user.id)
            if has_fresh_processing_submission(assessment, request.user.id):
                raise ValidationError({"order": "No se pueden reordenar las consignas mientras se procesa una corrección."})
            questions = {
                question.pk: question
                for question in Question.objects.select_for_update().filter(assessment=assessment, owner_id=request.user.id)
            }
            if set(questions) != set(order):
                raise ValidationError({"order": "La lista no coincide con las consignas actuales. Recargá la evaluación e intentá nuevamente."})
            offset = max(question.position for question in questions.values()) + len(order) + 1
            Question.objects.filter(pk__in=order).update(position=F("position") + offset)
            # Un solo UPDATE … CASE para las posiciones definitivas (antes, uno por consigna).
            for position, question_id in enumerate(order, start=1):
                questions[question_id].position = position
            Question.objects.bulk_update(list(questions.values()), ["position"])
            # Cambiar el orden altera el contexto de corrección: invalida snapshots en curso.
            assessment.save(update_fields=["updated_at"])
            record_audit(request.user.id, "questions.reordered", "assessment", assessment.id, {"count": len(order)}, request=request)
        ordered = Question.objects.filter(assessment=assessment, owner_id=request.user.id).order_by("position", "id")
        return Response({"questions": QuestionSerializer(ordered, many=True, context={"request": request}).data})

    @action(detail=True, methods=["post"], url_path="import-reference", parser_classes=[MultiPartParser, FormParser])
    def import_reference(self, request, pk=None):
        """Extract a teacher reference file in memory and save only its text."""
        assessment = self.get_object()
        uploaded = request.FILES.get("file")
        if not uploaded:
            raise ValidationError({"file": "Seleccioná un apunte o material de referencia."})
        mode = str(request.data.get("mode", "replace"))
        if mode not in {"replace", "append"}:
            raise ValidationError({"mode": "Usá replace o append."})
        # Parse the uploaded document before taking a database lock. For append,
        # merge against a freshly locked row so concurrent imports cannot overwrite
        # each other's changes with a stale in-memory Assessment instance.
        text, source_type = _read_document(uploaded)
        with transaction.atomic():
            assessment = Assessment.objects.select_for_update().get(
                pk=assessment.pk, owner_id=request.user.id,
            )
            if has_fresh_processing_submission(assessment, request.user.id):
                raise ValidationError({"assessment": "No se puede cambiar el material mientras se procesa una corrección."})
            combined = (
                text
                if mode == "replace" or not assessment.reference_material
                else assessment.reference_material.rstrip() + "\n\n" + text
            )
            if len(combined) > MAX_ANSWER_CHARS:
                raise ValidationError({"file": "El material combinado supera los 50.000 caracteres. Reemplazá el material existente o resumí los documentos."})
            assessment.reference_material = combined
            assessment.save(update_fields=["reference_material", "updated_at"])
            record_audit(request.user.id, "assessment.reference_imported", "assessment", assessment.id, {"source_type": source_type, "chars": len(text), "mode": mode}, request=request)
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
            # Lo que la IA no debe repetir: las consignas guardadas más las propuestas que
            # el docente ya vio en esta sesión (aceptadas o descartadas), enviadas en `avoid`.
            raw_avoid = request.data.get("avoid", [])
            if not isinstance(raw_avoid, list):
                raise ValidationError({"avoid": "Debe ser una lista de consignas."})
            saved = list(Question.objects.filter(owner_id=request.user.id, assessment=assessment).order_by("position", "id"))
            existing = [question.prompt for question in saved] + [str(item)[:300] for item in raw_avoid[:40] if str(item).strip()]
            provider_config = active_ai_provider_config()
            with ai_slot(request.user.id):
                result = run_with_deadline(
                    generate_questions,
                    title=assessment.title, subject=assessment.subject, level=assessment.level,
                    objectives=assessment.objectives, instructions=assessment.instructions,
                    reference_material=assessment.reference_material, count=count,
                    existing_questions=existing, provider_config=provider_config,
                )
            result["context_notes"] = context_notes_for(assessment, saved)
            record_ai_generation(request.user.id, "generate_questions", started, True, fingerprint(context), assessment=assessment, provider_config=provider_config)
            record_audit(request.user.id, "questions.proposed", "assessment", assessment.id, {"count": len(result.get("questions", [])), "demo": bool(result.get("demo"))}, request=request)
        except APIException:
            # Validación, cuota diaria o falta de cupo: no es una falla del proveedor.
            raise
        except Exception as exc:
            record_ai_generation(request.user.id, "generate_questions", started, False, fingerprint(context), ai_error_code(exc), assessment=assessment, provider_config=locals().get("provider_config"))
            logger.warning("AI questions generation failed (%s)", type(exc).__name__)
            return ai_error_response(exc, "No se pudieron generar preguntas. Revisá la configuración del proveedor de IA y volvé a intentar.")
        return Response(result, status=status.HTTP_200_OK)

class StudentViewSet(OwnerViewSet):
    queryset = Student.objects.all().prefetch_related("enrollments__course").order_by("name")
    serializer_class = StudentSerializer

    def perform_update(self, serializer):
        with transaction.atomic():
            lock_owner_profile(self.request.user.id)
            serializer.instance = Student.objects.select_for_update().get(
                pk=serializer.instance.pk, owner_id=self.request.user.id,
            )
            code = str(serializer.validated_data.get("external_code", getattr(serializer.instance, "external_code", ""))).strip()
            if code:
                duplicates = Student.objects.filter(owner_id=self.request.user.id, external_code=code).exclude(pk=serializer.instance.pk)
                if duplicates.exists():
                    raise ValidationError({"external_code": "Ya existe un estudiante con ese código externo."})
            serializer.save()

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        # A profile-row mutex serializes external_code checks across all student
        # writes for this owner without touching Supabase's internal Auth schema.
        lock_owner_profile(request.user.id)
        course_id = request.data.get("course")
        try:
            course = Course.objects.select_for_update().get(pk=course_id, owner_id=request.user.id, active=True)
        except (Course.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"course": ["Elegí una materia o curso activo antes de agregar al estudiante."]})
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
            raise ValidationError({"course": ["Elegí una materia o curso activo para asignar a los estudiantes importados."]})
        try:
            text = uploaded.read().decode("utf-8-sig")
            # Excel en español exporta con «;»: se detecta el separador de la primera línea.
            header_line = text.splitlines()[0] if text.strip() else ""
            delimiter = max(",;\t", key=header_line.count) if header_line.count(",") + header_line.count(";") + header_line.count("\t") else ","
            reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
            if reader.fieldnames:
                reader.fieldnames = [_student_csv_column(item) for item in reader.fieldnames]
            if not reader.fieldnames or "name" not in reader.fieldnames:
                raise ValidationError({"file": "El CSV debe incluir una columna name o nombre."})
            created, skipped, errors = 0, 0, []
            owner_id = request.user.id
            lock_owner_profile(owner_id)
            course = Course.objects.select_for_update().get(pk=course.pk, owner_id=owner_id, active=True)
            seen_codes = set(Student.objects.filter(owner_id=owner_id).exclude(external_code="").values_list("external_code", flat=True))
            # Se valida todo en memoria y se inserta en dos INSERT masivos (antes, dos
            # INSERT por fila: ~1000 viajes a la base para 500 estudiantes).
            new_students = []
            for row_number, row in enumerate(reader, start=2):
                if row_number > 501:
                    errors.append({"row": row_number, "reason": "Límite de 500 filas por importación."})
                    break
                name = (row.get("name") or "").strip()[:180]
                email = (row.get("email") or "").strip().lower()[:254]
                code = (row.get("external_code") or "").strip()[:80]
                if not name:
                    skipped += 1; errors.append({"row": row_number, "reason": "Falta el nombre."}); continue
                if email:
                    try: validate_email(email)
                    except DjangoValidationError:
                        skipped += 1; errors.append({"row": row_number, "reason": "Correo inválido."}); continue
                if code and code in seen_codes:
                    skipped += 1; errors.append({"row": row_number, "reason": "Legajo repetido."}); continue
                new_students.append(Student(owner_id=owner_id, name=name, email=email, phone=(row.get("phone") or "").strip()[:32], external_code=code))
                if code: seen_codes.add(code)
            if new_students:
                Student.objects.bulk_create(new_students)
                Enrollment.objects.bulk_create([
                    Enrollment(owner_id=owner_id, course=course, student=student, status="active")
                    for student in new_students
                ])
            created = len(new_students)
            record_audit(owner_id, "students.imported", "student_import", "csv", {"created": created, "skipped": skipped}, request=request)
            return Response({"created": created, "skipped": skipped, "errors": errors[:100]}, status=status.HTTP_200_OK)
        except UnicodeDecodeError as exc:
            raise ValidationError({"file": "El archivo debe estar codificado en UTF-8."}) from exc

_STUDENT_CSV_ALIASES = {
    "nombre": "name", "nombre_completo": "name", "nombre_y_apellido": "name",
    "apellido_y_nombre": "name", "estudiante": "name", "alumno": "name",
    "correo": "email", "correo_electronico": "email", "mail": "email", "e_mail": "email",
    "telefono": "phone", "celular": "phone",
    "codigo": "external_code", "codigo_externo": "external_code", "legajo": "external_code",
}


def _student_csv_column(header):
    """Encabezado del CSV → nombre interno (acepta la plantilla en inglés o en español)."""
    text = unicodedata.normalize("NFKD", str(header or "")).encode("ascii", "ignore").decode()
    key = re.sub(r"[\s\-]+", "_", text.strip().lower())
    return _STUDENT_CSV_ALIASES.get(key, key)


# Niveles de respaldo cuando ni el docente ni la IA proponen descriptores propios.
_DEFAULT_RUBRIC_LEVELS = (
    ("Inicial", "Requiere apoyo para demostrar el criterio.", 0),
    ("En desarrollo", "Demuestra parte de lo esperado.", 1 / 3),
    ("Logrado", "Cumple el criterio esperado.", 2 / 3),
    ("Destacado", "Demuestra el criterio con profundidad o transferencia.", 1),
)


def _decimal_in_range(value, *, places, minimum, maximum, inclusive_min, error):
    try:
        number = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError, TypeError):
        raise ValidationError({"criteria": error})
    if not number.is_finite() or number > maximum or (number < minimum if inclusive_min else number <= minimum):
        raise ValidationError({"criteria": error})
    return number.quantize(Decimal(1).scaleb(-places))


def _validated_rubric_criteria(raw_criteria, scale_type):
    """Valida criterios y niveles de una rúbrica nueva sin tocar la base.

    Devuelve `[{"fields": {...}, "levels": [{...}]}]` listo para `bulk_create`. Usa
    los niveles propuestos (por el docente o la IA) y recurre a los genéricos sólo si faltan.
    """
    rows = []
    for index, raw in enumerate(raw_criteria, start=1):
        if not isinstance(raw, dict):
            raise ValidationError({"criteria": f"El criterio {index} no tiene un formato válido."})
        name = str(raw.get("name", "")).strip()[:160]
        if not name:
            raise ValidationError({"criteria": f"El criterio {index} necesita un nombre."})
        max_score = _decimal_in_range(raw.get("max_score", 10), places=2, minimum=Decimal(0), maximum=Decimal(1000), inclusive_min=False,
                                      error=f"El puntaje máximo del criterio {index} debe ser mayor que 0 y no superar 1000.")
        weight = _decimal_in_range(raw.get("weight", 1), places=3, minimum=Decimal(0), maximum=Decimal(100), inclusive_min=True,
                                   error=f"La ponderación del criterio {index} debe estar entre 0 y 100.")
        levels = []
        if scale_type in {"levels", "both"}:
            supplied = raw.get("levels")
            if not isinstance(supplied, list) or not supplied:
                supplied = [
                    {"name": level_name, "description": description, "score": float(max_score) * fraction}
                    for level_name, description, fraction in _DEFAULT_RUBRIC_LEVELS
                ]
            if len(supplied) > 8:
                raise ValidationError({"criteria": f"El criterio {index} no puede tener más de 8 niveles."})
            for raw_level in supplied:
                if not isinstance(raw_level, dict) or not str(raw_level.get("name", "")).strip():
                    raise ValidationError({"criteria": f"Un nivel del criterio {index} no tiene un formato válido."})
                score = _decimal_in_range(raw_level.get("score", 0), places=2, minimum=Decimal(0), maximum=max_score, inclusive_min=True,
                                          error=f"El puntaje de cada nivel del criterio {index} debe estar entre 0 y su máximo.")
                levels.append({"name": str(raw_level["name"]).strip()[:80], "description": str(raw_level.get("description", ""))[:2000], "score": score})
        rows.append({
            "fields": {"name": name, "description": str(raw.get("description", ""))[:4000], "max_score": max_score, "weight": weight},
            "levels": levels,
        })
    return rows


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
        owner_id = request.user.id
        criteria_rows = _validated_rubric_criteria(raw_criteria, rubric_serializer.validated_data.get("scale_type", "both"))
        rubric = rubric_serializer.save(owner_id=owner_id)
        # Validación completa en memoria y dos INSERT masivos (antes, una validación con
        # consulta y un INSERT por criterio y por nivel: hasta 180 viajes a la base).
        criteria = RubricCriterion.objects.bulk_create([
            RubricCriterion(owner_id=owner_id, rubric=rubric, position=index, **row["fields"])
            for index, row in enumerate(criteria_rows, start=1)
        ])
        RubricLevel.objects.bulk_create([
            RubricLevel(owner_id=owner_id, criterion=criterion, position=level_index, **level)
            for criterion, row in zip(criteria, criteria_rows)
            for level_index, level in enumerate(row["levels"], start=1)
        ])

        record_audit(request.user.id, "rubric.created", "rubric", rubric.id, {"criteria_count": len(raw_criteria), "scale_type": rubric.scale_type}, request=request)
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
        provider_config = active_ai_provider_config()
        try:
            reference_material = str(request.data.get("reference_material", ""))[:12000]
            with ai_slot(request.user.id):
                result = run_with_deadline(generate_rubric, title=title, subject=subject, level=level, objectives=objectives, instructions=instructions, question_prompts=question_prompts, reference_material=reference_material, count=count, provider_config=provider_config)
            record_ai_generation(request.user.id, "generate_rubric", started, True, fingerprint(context), provider_config=provider_config)
        except APIException:
            raise
        except Exception as exc:
            record_ai_generation(request.user.id, "generate_rubric", started, False, fingerprint(context), ai_error_code(exc), provider_config=provider_config)
            logger.warning("AI rubric generation failed (%s)", type(exc).__name__)
            return ai_error_response(exc, "No se pudo proponer la rúbrica. Revisá la configuración del proveedor de IA y volvé a intentar.")
        return Response(result)

class QuestionViewSet(OwnerViewSet):
    queryset = Question.objects.all().select_related("assessment", "rubric")
    serializer_class = QuestionSerializer

    def get_queryset(self):
        return super().get_queryset().filter(assessment__owner_id=self.request.user.id)

    @transaction.atomic
    def perform_create(self, serializer):
        # The AI reservation also locks Assessment before Submission. Sharing this
        # lock order prevents a new/reordered question racing with prompt creation.
        requested_assessment = serializer.validated_data["assessment"]
        try:
            assessment = Assessment.objects.select_for_update().get(
                pk=requested_assessment.pk, owner_id=self.request.user.id,
            )
        except Assessment.DoesNotExist as exc:
            raise ValidationError("Evaluación no disponible.") from exc
        if assessment.status == "archived":
            raise ValidationError({"assessment": "No se pueden agregar consignas a una evaluación archivada."})
        if has_fresh_processing_submission(assessment, self.request.user.id):
            raise ValidationError({"assessment": "No se pueden modificar las consignas mientras se procesa una corrección."})
        position = (Question.objects.filter(assessment=assessment).aggregate(max_position=Max("position"))["max_position"] or 0) + 1
        serializer.save(owner_id=self.request.user.id, assessment=assessment, position=position)
        # Treat a question-list change as an assessment-context update so in-flight
        # generation can detect a stale preflight snapshot.
        assessment.save(update_fields=["updated_at"])

    @transaction.atomic
    def perform_update(self, serializer):
        requested_question = serializer.instance
        assessment = Assessment.objects.select_for_update().get(
            pk=requested_question.assessment_id, owner_id=self.request.user.id,
        )
        if has_fresh_processing_submission(assessment, self.request.user.id):
            raise ValidationError({"question": "No se pueden modificar consignas mientras se procesa una corrección."})
        question = Question.objects.select_for_update().get(
            pk=requested_question.pk, assessment=assessment, owner_id=self.request.user.id,
        )
        serializer.instance = question
        serializer.save()
        assessment.save(update_fields=["updated_at"])

    def destroy(self, request, *args, **kwargs):
        question = self.get_object()
        with transaction.atomic():
            assessment = Assessment.objects.select_for_update().get(
                pk=question.assessment_id, owner_id=request.user.id,
            )
            if has_fresh_processing_submission(assessment, request.user.id):
                raise ValidationError({"question": "No se pueden modificar consignas mientras se procesa una corrección."})
            # select_for_update() no admite el LEFT JOIN de select_related('rubric'): se bloquea la fila sola.
            question = Question.objects.select_for_update().get(pk=question.pk, assessment=assessment, owner_id=request.user.id)
            if Submission.objects.filter(question=question).exists() or SubmissionAnswer.objects.filter(question=question).exists():
                return Response(
                    {"detail": "No se puede eliminar una pregunta con respuestas vinculadas. Podés editarla para nuevas evaluaciones o archivar la evaluación completa."},
                    status=status.HTTP_409_CONFLICT,
                )
            self.perform_destroy(question)
        return Response(status=status.HTTP_204_NO_CONTENT)

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
