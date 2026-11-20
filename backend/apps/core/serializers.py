from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers
from .models import (
    PROCESSING_LEASE_MINUTES, AIGeneration, Assessment, AssessmentCourse, ContactMessage, Correction, CorrectionCriterionResult,
    CorrectionRevision, Course, Enrollment, Question, Rubric, RubricCriterion,
    RubricLevel, Student, Subject, Submission, SubmissionAnswer,
)

OWNED_READ_ONLY = ("id", "owner_id", "created_at", "updated_at")


class OwnedSerializer(serializers.ModelSerializer):
    """Base de los recursos del docente.

    Cada serializer declara sus campos: con «__all__» cualquier columna agregada al
    esquema quedaba escribible por la API sin que nadie lo decidiera.
    """
    class Meta:
        read_only_fields = OWNED_READ_ONLY


def _owner_id(serializer):
    return str(getattr(getattr(serializer.context.get("request"), "user", None), "id", ""))


class SubjectRefField(serializers.PrimaryKeyRelatedField):
    """`subject_id` escribible, limitado a las materias del docente autenticado."""
    def get_queryset(self):
        request = self.context.get("request")
        return Subject.objects.filter(owner_id=getattr(getattr(request, "user", None), "id", None))


class SubjectSerializer(OwnedSerializer):
    course_count = serializers.IntegerField(read_only=True, default=0)
    assessment_count = serializers.IntegerField(read_only=True, default=0)

    class Meta(OwnedSerializer.Meta):
        model = Subject
        fields = ("id", "owner_id", "name", "level", "description", "active", "course_count", "assessment_count", "created_at", "updated_at")
        read_only_fields = (*OWNED_READ_ONLY, "course_count", "assessment_count")

    def validate_name(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("El nombre de la materia es obligatorio.")
        return value


SHIFT_LABELS = dict(Course.SHIFT_CHOICES)


class CourseSerializer(OwnedSerializer):
    """Curso o comisión. `subject_id` es la materia; `subject` es su nombre (sólo lectura)."""
    # These values are annotated by CourseViewSet to avoid one or two extra
    # database queries for every row in the course list.
    student_count = serializers.IntegerField(read_only=True, default=0)
    assessment_count = serializers.IntegerField(read_only=True, default=0)
    subject_id = SubjectRefField(source="subject_ref", allow_null=True, required=False)
    subject = serializers.CharField(source="subject_name", read_only=True)
    shift_label = serializers.SerializerMethodField()

    class Meta(OwnedSerializer.Meta):
        model = Course
        fields = (
            "id", "owner_id", "name", "subject_id", "subject", "shift", "shift_label", "level", "academic_year",
            "description", "active", "student_count", "assessment_count", "created_at", "updated_at",
        )
        read_only_fields = (*OWNED_READ_ONLY, "student_count", "assessment_count")

    def get_shift_label(self, obj):
        return SHIFT_LABELS.get(obj.shift, "") if obj.shift else ""

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El nombre del curso o comisión es obligatorio.")
        return value


class CourseOptionSerializer(serializers.ModelSerializer):
    """Minimal course representation for selectors in the correction workspace."""
    subject_id = serializers.IntegerField(source="subject_ref_id", read_only=True, allow_null=True)
    subject = serializers.CharField(source="subject_name", read_only=True)

    class Meta:
        model = Course
        fields = ("id", "name", "active", "subject_id", "subject")


class CourseNavigationSerializer(serializers.ModelSerializer):
    """Small navigation/selector payload that avoids count annotations and long descriptions."""
    subject_id = serializers.IntegerField(source="subject_ref_id", read_only=True, allow_null=True)
    subject = serializers.CharField(source="subject_name", read_only=True)

    class Meta:
        model = Course
        fields = ("id", "name", "subject_id", "subject", "shift", "level", "academic_year", "active")


class CourseDashboardSerializer(serializers.ModelSerializer):
    """Dashboard card payload; excludes owner metadata and the long description."""
    student_count = serializers.IntegerField(read_only=True, default=0)
    assessment_count = serializers.IntegerField(read_only=True, default=0)
    subject_id = serializers.IntegerField(source="subject_ref_id", read_only=True, allow_null=True)
    subject = serializers.CharField(source="subject_name", read_only=True)

    class Meta:
        model = Course
        fields = (
            "id", "name", "subject_id", "subject", "shift", "level", "academic_year", "active",
            "student_count", "assessment_count",
        )


class StudentOptionSerializer(serializers.ModelSerializer):
    """Minimal student fields for selection in the correction workspace."""
    class Meta:
        model = Student
        fields = ("id", "name", "email", "phone", "active")


class StudentEnrollmentSummarySerializer(serializers.ModelSerializer):
    course_id = serializers.IntegerField(source="course.id", read_only=True)
    course_name = serializers.CharField(source="course.name", read_only=True)

    class Meta:
        model = Enrollment
        fields = ("id", "course_id", "course_name", "status")


class StudentSerializer(OwnedSerializer):
    # A student can belong to more than one course, but the create flow requires
    # at least one active enrollment. Prefetching in the view avoids N+1 queries.
    enrollments = StudentEnrollmentSummarySerializer(many=True, read_only=True)

    class Meta(OwnedSerializer.Meta):
        model = Student
        fields = ("id", "owner_id", "name", "email", "phone", "external_code", "account_user_id", "active", "enrollments", "created_at", "updated_at")
        read_only_fields = (*OWNED_READ_ONLY, "enrollments", "account_user_id")

    def validate_email(self, value):
        return value.strip().lower()

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El nombre del estudiante es obligatorio.")
        return value

    def validate_external_code(self, value):
        code = value.strip()
        if not code:
            return ""
        request_user = getattr(self.context.get("request"), "user", None)
        owner_id = getattr(request_user, "id", None)
        if owner_id:
            queryset = Student.objects.filter(owner_id=owner_id, external_code=code)
            if self.instance:
                queryset = queryset.exclude(pk=self.instance.pk)
            if queryset.exists():
                raise serializers.ValidationError("Ya existe un estudiante con ese código externo.")
        return code


class EnrollmentSerializer(OwnedSerializer):
    student_name = serializers.CharField(source="student.name", read_only=True)
    student_email = serializers.EmailField(source="student.email", read_only=True)
    student_external_code = serializers.CharField(source="student.external_code", read_only=True, allow_blank=True)
    course_name = serializers.CharField(source="course.name", read_only=True)

    class Meta(OwnedSerializer.Meta):
        model = Enrollment
        fields = ("id", "owner_id", "course", "student", "status", "enrolled_at", "notes", "student_name", "student_email", "student_external_code", "course_name", "created_at", "updated_at")
        read_only_fields = (*OWNED_READ_ONLY, "enrolled_at", "student_name", "student_email", "student_external_code", "course_name")

    def validate(self, attrs):
        user_id = str(self.context["request"].user.id)
        course = attrs.get("course", getattr(self.instance, "course", None))
        student = attrs.get("student", getattr(self.instance, "student", None))
        if course and str(course.owner_id) != user_id:
            raise serializers.ValidationError({"course": "Curso no disponible."})
        if student and str(student.owner_id) != user_id:
            raise serializers.ValidationError({"student": "Estudiante no disponible."})
        if self.instance:
            if "course" in attrs and course.pk != self.instance.course_id:
                raise serializers.ValidationError({"course": "No se puede cambiar el curso de una matrícula existente."})
            if "student" in attrs and student.pk != self.instance.student_id:
                raise serializers.ValidationError({"student": "No se puede cambiar el estudiante de una matrícula existente."})
            activating = attrs.get("status") == "active"
        else:
            activating = attrs.get("status", "active") == "active"
        if activating and course and not course.active:
            raise serializers.ValidationError({"course": "No se puede activar una matrícula en un curso archivado."})
        if activating and student and not student.active:
            raise serializers.ValidationError({"student": "No se puede activar una matrícula para un estudiante inactivo."})
        if activating and course and student:
            duplicate = Enrollment.objects.filter(
                owner_id=user_id, course_id=course.pk, student_id=student.pk, status="active",
            )
            if self.instance:
                duplicate = duplicate.exclude(pk=self.instance.pk)
            if duplicate.exists():
                raise serializers.ValidationError({"student": "El estudiante ya tiene una matrícula activa en este curso."})
        return attrs


class RubricLevelSerializer(OwnedSerializer):
    class Meta(OwnedSerializer.Meta):
        model = RubricLevel
        fields = ("id", "owner_id", "criterion", "name", "description", "score", "position", "created_at", "updated_at")

    def validate(self, attrs):
        score = attrs.get("score", getattr(self.instance, "score", 0))
        criterion = attrs.get("criterion", getattr(self.instance, "criterion", None))
        if score < 0 or score > 1000:
            raise serializers.ValidationError({"score": "El puntaje debe estar entre 0 y 1000."})
        if criterion and str(criterion.owner_id) != str(self.context["request"].user.id):
            raise serializers.ValidationError({"criterion": "Criterio no disponible."})
        if criterion and score > criterion.max_score:
            raise serializers.ValidationError({"score": "El puntaje del nivel no puede superar el máximo del criterio."})
        return attrs


class RubricCriterionSerializer(OwnedSerializer):
    levels = RubricLevelSerializer(many=True, read_only=True)

    class Meta(OwnedSerializer.Meta):
        model = RubricCriterion
        fields = ("id", "owner_id", "rubric", "name", "description", "max_score", "weight", "position", "levels", "created_at", "updated_at")
        read_only_fields = (*OWNED_READ_ONLY, "levels")

    def validate(self, attrs):
        max_score = attrs.get("max_score", getattr(self.instance, "max_score", 10))
        weight = attrs.get("weight", getattr(self.instance, "weight", 1))
        rubric = attrs.get("rubric", getattr(self.instance, "rubric", None))
        if max_score <= 0 or max_score > 1000:
            raise serializers.ValidationError({"max_score": "El puntaje máximo debe ser mayor que 0 y no superar 1000."})
        if weight < 0 or weight > 100:
            raise serializers.ValidationError({"weight": "La ponderación debe estar entre 0 y 100."})
        if rubric and str(rubric.owner_id) != str(self.context["request"].user.id):
            raise serializers.ValidationError({"rubric": "Rúbrica no disponible."})
        return attrs


class RubricCriterionOptionSerializer(serializers.ModelSerializer):
    """Minimal criterion fields needed by the correction-workspace selector."""
    class Meta:
        model = RubricCriterion
        fields = ("id", "name", "max_score")


class RubricOptionSerializer(serializers.ModelSerializer):
    """Avoid returning level descriptions for every rubric before one is selected."""
    criteria = RubricCriterionOptionSerializer(many=True, read_only=True)

    class Meta:
        model = Rubric
        fields = ("id", "title", "scale_type", "criteria")


class RubricSerializer(OwnedSerializer):
    criteria = RubricCriterionSerializer(many=True, read_only=True)
    subject_id = SubjectRefField(source="subject_ref", allow_null=True, required=False)

    class Meta(OwnedSerializer.Meta):
        model = Rubric
        fields = ("id", "owner_id", "title", "description", "scale_type", "subject_id", "criteria", "created_at", "updated_at")
        read_only_fields = (*OWNED_READ_ONLY, "criteria")

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El título de la rúbrica es obligatorio.")
        return value


class QuestionSerializer(OwnedSerializer):
    class Meta(OwnedSerializer.Meta):
        model = Question
        fields = ("id", "owner_id", "assessment", "rubric", "prompt", "expected_answer", "question_type", "max_score", "position", "created_at", "updated_at")

    def validate(self, attrs):
        user_id = str(self.context["request"].user.id)
        max_score = attrs.get("max_score", getattr(self.instance, "max_score", 10))
        if max_score <= 0 or max_score > 1000:
            raise serializers.ValidationError({"max_score": "El puntaje máximo debe ser mayor que 0 y no superar 1000."})
        assessment = attrs.get("assessment", getattr(self.instance, "assessment", None))
        rubric = attrs.get("rubric", getattr(self.instance, "rubric", None))
        if assessment and str(assessment.owner_id) != user_id:
            raise serializers.ValidationError({"assessment": "Evaluación no disponible."})
        if rubric and str(rubric.owner_id) != user_id:
            raise serializers.ValidationError({"rubric": "Rúbrica no disponible."})
        if self.instance and "assessment" in attrs and assessment.pk != self.instance.assessment_id:
            # Moving a question would silently change the meaning of historical
            # answers/corrections linked to its original assessment.
            raise serializers.ValidationError({"assessment": "No se puede mover una consigna a otra evaluación después de crearla."})
        return attrs


def assessment_course_ids(assessment) -> list[int]:
    """Comisiones asignadas a una evaluación.

    Usa `course_links` precargado si está; si la evaluación es anterior a las
    asignaciones (o la creó la versión previa), cae en la comisión principal heredada.
    """
    cache = getattr(assessment, "_prefetched_objects_cache", {}) or {}
    links = cache["course_links"] if "course_links" in cache else assessment.course_links.all()
    ids = [link.course_id for link in links]
    if not ids and assessment.course_id:
        ids = [assessment.course_id]
    return ids


class AssessmentCoursesMixin(serializers.Serializer):
    """Materia y comisiones de una evaluación, para listas y detalle."""
    subject_id = serializers.IntegerField(source="subject_ref_id", read_only=True, allow_null=True)
    subject = serializers.CharField(source="subject_name", read_only=True)
    course_ids = serializers.SerializerMethodField()
    course_name = serializers.SerializerMethodField()

    def get_course_ids(self, obj):
        return assessment_course_ids(obj)

    def get_course_name(self, obj):
        # Nombre de la comisión principal (heredado); la interfaz muestra todas por ID.
        return obj.course.name if obj.course_id and obj.course else None


class AssessmentEditorSerializer(AssessmentCoursesMixin, serializers.ModelSerializer):
    """Assessment fields used by the editor, including imported reference material."""
    class Meta:
        model = Assessment
        fields = ("id", "title", "subject_id", "subject", "level", "objectives", "instructions", "reference_material", "status", "course", "course_ids", "course_name", "updated_at")


class AssessmentListSerializer(AssessmentCoursesMixin, serializers.ModelSerializer):
    """Small payload for lists; full reference material is fetched only for one assessment."""
    class Meta:
        model = Assessment
        fields = ("id", "title", "subject_id", "subject", "level", "status", "course", "course_ids", "course_name", "updated_at")


class AssessmentWorkspaceSerializer(AssessmentCoursesMixin, serializers.ModelSerializer):
    """Selected assessment data without serializing its questions twice."""
    class Meta:
        model = Assessment
        fields = (
            "id", "title", "subject_id", "subject", "level", "objectives", "instructions",
            "reference_material", "status", "course", "course_ids", "course_name", "updated_at",
        )


class AssessmentSerializer(AssessmentCoursesMixin, OwnedSerializer):
    """Evaluación de una materia, asignada a una o más de sus comisiones.

    Escritura: `subject_id` y `course_ids`. Por compatibilidad se acepta `course` (una
    sola comisión): la materia se toma de esa comisión.
    """
    questions = QuestionSerializer(many=True, read_only=True)
    subject_id = SubjectRefField(source="subject_ref", allow_null=True, required=False)
    course_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, max_length=50, write_only=True)

    class Meta(OwnedSerializer.Meta):
        model = Assessment
        fields = (
            "id", "owner_id", "title", "subject_id", "subject", "level", "objectives", "instructions",
            "reference_material", "status", "course", "course_ids", "course_name", "questions",
            "created_at", "updated_at",
        )
        read_only_fields = (*OWNED_READ_ONLY, "questions", "course_name")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["course_ids"] = assessment_course_ids(instance)
        return data

    def validate(self, attrs):
        owner_id = _owner_id(self)
        course = attrs.get("course", getattr(self.instance, "course", None))
        if course and str(course.owner_id) != owner_id:
            raise serializers.ValidationError({"course": "Curso no disponible."})
        material = attrs.get("reference_material", getattr(self.instance, "reference_material", ""))
        if len(material or "") > 50000:
            raise serializers.ValidationError({"reference_material": "El material de referencia supera el límite de 50.000 caracteres extraídos."})

        subject = attrs.get("subject_ref", getattr(self.instance, "subject_ref", None))
        if "course_ids" in attrs:
            requested = list(dict.fromkeys(attrs["course_ids"]))
            courses = list(Course.objects.filter(owner_id=owner_id, pk__in=requested).select_related("subject_ref"))
            if len(courses) != len(requested):
                raise serializers.ValidationError({"course_ids": "Alguna comisión no está disponible."})
            by_id = {item.pk: item for item in courses}
            courses = [by_id[pk] for pk in requested]
        elif "course" in attrs:
            courses = [course] if course else []
        else:
            courses = None  # sin cambios en las asignaciones
            if self.instance is not None and "subject_ref" in attrs and subject is not None:
                current = Course.objects.filter(owner_id=owner_id, pk__in=assessment_course_ids(self.instance))
                if current.exclude(subject_ref_id=subject.pk).exists():
                    raise serializers.ValidationError({"subject_id": "La evaluación tiene comisiones de otra materia: elegí también las comisiones de la nueva materia."})
        if courses:
            if subject is None and "subject_ref" not in attrs:
                subject = courses[0].subject_ref
                attrs["subject_ref"] = subject
            foreign = [item.name for item in courses if subject is not None and item.subject_ref_id != subject.pk]
            if foreign:
                raise serializers.ValidationError({"course_ids": "Las comisiones deben pertenecer a la materia de la evaluación: " + ", ".join(foreign[:3]) + "."})
        if courses is not None:
            attrs["_courses"] = courses
            # Comisión principal heredada: la primera asignada (la versión anterior la usa).
            attrs["course"] = courses[0] if courses else None
        attrs.pop("course_ids", None)
        if attrs.get("subject_ref") is not None:
            attrs["subject"] = attrs["subject_ref"].name[:120]
            if not attrs.get("level") and not getattr(self.instance, "level", ""):
                attrs["level"] = attrs["subject_ref"].level
        return attrs

    def _sync_courses(self, assessment, courses):
        if courses is None:
            return
        wanted = {item.pk for item in courses}
        AssessmentCourse.objects.filter(assessment=assessment).exclude(course_id__in=wanted).delete()
        existing = set(AssessmentCourse.objects.filter(assessment=assessment).values_list("course_id", flat=True))
        AssessmentCourse.objects.bulk_create([
            AssessmentCourse(owner_id=assessment.owner_id, assessment=assessment, course=item)
            for item in courses if item.pk not in existing
        ])
        if hasattr(assessment, "_prefetched_objects_cache"):
            assessment._prefetched_objects_cache.pop("course_links", None)

    def create(self, validated_data):
        courses = validated_data.pop("_courses", None)
        assessment = super().create(validated_data)
        self._sync_courses(assessment, courses)
        return assessment

    def update(self, instance, validated_data):
        courses = validated_data.pop("_courses", None)
        assessment = super().update(instance, validated_data)
        self._sync_courses(assessment, courses)
        return assessment


class SubmissionAnswerSerializer(OwnedSerializer):
    question_prompt = serializers.CharField(source="question.prompt", read_only=True)

    class Meta(OwnedSerializer.Meta):
        model = SubmissionAnswer
        fields = ("id", "owner_id", "submission", "question", "answer_text", "source_filename", "question_prompt", "created_at", "updated_at")
        read_only_fields = (*OWNED_READ_ONLY, "question_prompt")

    def validate(self, attrs):
        user_id = str(self.context["request"].user.id)
        submission = attrs.get("submission", getattr(self.instance, "submission", None))
        question = attrs.get("question", getattr(self.instance, "question", None))
        if self.instance:
            if "submission" in attrs and submission.pk != self.instance.submission_id:
                raise serializers.ValidationError({"submission": "No se puede mover una respuesta a otra entrega existente."})
            if "question" in attrs and (question.pk if question else None) != self.instance.question_id:
                raise serializers.ValidationError({"question": "No se puede cambiar la pregunta vinculada a una respuesta existente."})
        if submission and str(submission.owner_id) != user_id:
            raise serializers.ValidationError({"submission": "Entrega no disponible."})
        # Igual ventana de lease que el worker de corrección: un «processing»
        # vencido no bloquea la edición de respuestas (el guard de la vista lo reclama).
        if submission and submission.status == "processing" and submission.updated_at >= timezone.now() - timedelta(minutes=PROCESSING_LEASE_MINUTES):
            raise serializers.ValidationError({"submission": "No se pueden modificar respuestas mientras se procesa una corrección."})
        if question and str(question.owner_id) != user_id:
            raise serializers.ValidationError({"question": "Pregunta no disponible."})
        if submission and question and question.assessment_id != submission.assessment_id:
            raise serializers.ValidationError({"question": "La pregunta no pertenece a la evaluación de esta entrega."})
        text = attrs.get("answer_text", getattr(self.instance, "answer_text", ""))
        if not text.strip() or len(text) > 50000:
            raise serializers.ValidationError({"answer_text": "La respuesta debe contener entre 1 y 50.000 caracteres."})
        return attrs


class SubmissionListSerializer(serializers.ModelSerializer):
    """Bound list payloads; full answer bodies are fetched only in correction workspace/detail."""
    student_display_name = serializers.SerializerMethodField()
    answer_text = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = (
            "id", "assessment", "question", "student", "course", "student_name",
            "student_display_name", "answer_text", "source_type", "source_filename",
            "status", "created_at",
        )

    def get_student_display_name(self, obj):
        return obj.student.name if obj.student_id else (obj.student_name or "Estudiante sin identificar")

    def get_answer_text(self, obj):
        # ViewSet annotates only the first 301 characters from PostgreSQL and
        # defers the full answer_text field on the list action. Detailed views
        # intentionally continue to return complete answer content.
        value = (getattr(obj, "answer_preview", "") or "").strip()
        if not value:
            value = (getattr(obj, "first_answer_preview", "") or "").strip()
        return value[:300] + ("…" if len(value) > 300 else "")


class SubmissionSerializer(OwnedSerializer):
    answers = SubmissionAnswerSerializer(many=True, read_only=True)
    student_display_name = serializers.SerializerMethodField()

    class Meta(OwnedSerializer.Meta):
        model = Submission
        fields = (
            "id", "owner_id", "assessment", "question", "student", "course", "student_name", "answer_text",
            "source_type", "source_filename", "status", "answers", "student_display_name", "created_at", "updated_at",
        )
        read_only_fields = (*OWNED_READ_ONLY, "status", "answers", "student_display_name")

    def get_student_display_name(self, obj):
        return obj.student.name if obj.student_id else (obj.student_name or "Estudiante sin identificar")

    def validate(self, attrs):
        owner_id = str(self.context["request"].user.id)
        if self.instance and self.instance.status == "processing":
            raise serializers.ValidationError({"status": "No se puede modificar una entrega mientras se está procesando una corrección."})
        assessment = attrs.get("assessment", getattr(self.instance, "assessment", None))
        student = attrs.get("student", getattr(self.instance, "student", None))
        question = attrs.get("question", getattr(self.instance, "question", None))
        if self.instance:
            # Resource identity is immutable after ingestion. Reassignment could
            # make an existing correction refer to a different student/course.
            if "assessment" in attrs and assessment.pk != self.instance.assessment_id:
                raise serializers.ValidationError({"assessment": "No se puede mover una entrega a otra evaluación."})
            if "student" in attrs and (student.pk if student else None) != self.instance.student_id:
                raise serializers.ValidationError({"student": "No se puede reasignar una entrega a otro estudiante."})
            if "question" in attrs and (question.pk if question else None) != self.instance.question_id:
                raise serializers.ValidationError({"question": "No se puede cambiar la pregunta vinculada a una entrega existente."})
        answer_text = attrs.get("answer_text", getattr(self.instance, "answer_text", ""))
        if len(answer_text) > 50000:
            raise serializers.ValidationError({"answer_text": "La respuesta supera el límite de 50.000 caracteres."})
        if not answer_text.strip() and not (self.instance and self.instance.answers.exists()):
            raise serializers.ValidationError({"answer_text": "Ingresá una respuesta o usá la carga de archivo."})
        if assessment and str(assessment.owner_id) != owner_id:
            raise serializers.ValidationError({"assessment": "Evaluación no disponible."})
        if student and str(student.owner_id) != owner_id:
            raise serializers.ValidationError({"student": "Estudiante no disponible."})
        if question and (str(question.owner_id) != owner_id or (assessment and question.assessment_id != assessment.id)):
            raise serializers.ValidationError({"question": "La pregunta no pertenece a esta evaluación."})
        if self.instance:
            if "course" in attrs and (attrs["course"].pk if attrs["course"] else None) != self.instance.course_id:
                raise serializers.ValidationError({"course": "No se puede cambiar la comisión de una entrega existente."})
        elif assessment:
            attrs["course"] = resolve_submission_course(assessment, student, attrs.get("course"), owner_id)
        return attrs


def resolve_submission_course(assessment, student, requested_course, owner_id):
    """Comisión de una entrega nueva, validada contra la evaluación y la matrícula.

    - Si se indica, tiene que estar asignada a la evaluación y, con estudiante, tenerlo
      matriculado.
    - Si no se indica y hay estudiante: la única comisión asignada donde está matriculado.
      Si está en más de una, hay que elegirla.
    - Una evaluación sin comisiones asignadas acepta entregas sin comisión.
    """
    assigned = assessment_course_ids(assessment)
    if requested_course is not None:
        if str(requested_course.owner_id) != str(owner_id) or requested_course.pk not in assigned:
            raise serializers.ValidationError({"course": "La comisión no está asignada a esta evaluación."})
        candidates = [requested_course.pk]
    else:
        candidates = assigned
    if not candidates:
        return None
    if student is None:
        if len(candidates) == 1:
            return Course.objects.filter(owner_id=owner_id, pk=candidates[0]).first()
        raise serializers.ValidationError({"course": "La evaluación está asignada a varias comisiones: elegí en cuál se entregó."})
    enrolled = list(Enrollment.objects.filter(
        owner_id=owner_id, course_id__in=candidates, student=student, status="active",
    ).values_list("course_id", flat=True))
    if not enrolled:
        raise serializers.ValidationError({"student": "El estudiante no está matriculado en " + ("esa comisión." if requested_course is not None else "ninguna comisión asignada a esta evaluación.")})
    if len(enrolled) > 1:
        raise serializers.ValidationError({"course": "El estudiante está en más de una comisión de esta evaluación: elegí en cuál entregó."})
    return Course.objects.filter(owner_id=owner_id, pk=enrolled[0]).first()


class CorrectionCriterionResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = CorrectionCriterionResult
        fields = ("id", "question", "criterion_name", "score", "max_score", "evidence", "justification", "feedback", "position")


class CorrectionSummarySerializer(serializers.ModelSerializer):
    """Compact correction row for course dashboards and delivery filters."""
    submission_assessment_id = serializers.IntegerField(source="submission.assessment_id", read_only=True)
    submission_title = serializers.CharField(source="submission.assessment.title", read_only=True)
    course_id = serializers.SerializerMethodField()
    course_name = serializers.SerializerMethodField()
    subject = serializers.CharField(source="submission.assessment.subject", read_only=True)
    student_name = serializers.SerializerMethodField()

    def get_course_id(self, obj):
        return submission_course(obj.submission)[0]

    def get_course_name(self, obj):
        return submission_course(obj.submission)[1]

    class Meta:
        model = Correction
        fields = (
            "id", "submission", "status", "provider", "total_score", "created_at",
            "submission_assessment_id", "submission_title", "course_id", "course_name",
            "subject", "student_name",
        )

    def get_student_name(self, obj):
        submission = obj.submission
        return submission.student.name if submission.student_id else (submission.student_name or "Estudiante sin identificar")


class CorrectionSerializer(OwnedSerializer):
    criterion_results = CorrectionCriterionResultSerializer(many=True, read_only=True)

    class Meta(OwnedSerializer.Meta):
        model = Correction
        fields = (
            "id", "owner_id", "submission", "rubric", "provider", "proposal", "final_result", "teacher_feedback",
            "total_score", "status", "approved_at", "criterion_results", "created_at", "updated_at",
        )
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        assessment = instance.submission.assessment
        student = instance.submission.student
        data["submission_title"] = assessment.title
        data["submission_assessment_id"] = instance.submission.assessment_id
        data["student_id"] = instance.submission.student_id
        data["student_name"] = student.name if student else (instance.submission.student_name or "Estudiante sin identificar")
        data["student_email"] = student.email if student else ""
        data["course_id"], data["course_name"] = submission_course(instance.submission)
        data["subject"] = assessment.subject
        return data


def submission_course(submission):
    """(id, nombre) de la comisión de una entrega; las anteriores usan la de la evaluación."""
    if submission.course_id:
        course = submission.course
        return submission.course_id, (course.name if course else None)
    assessment = submission.assessment
    if assessment.course_id:
        return assessment.course_id, (assessment.course.name if assessment.course else None)
    return None, None
