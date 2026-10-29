from rest_framework import serializers
from .models import (
    AIGeneration, Assessment, ContactMessage, Correction, CorrectionCriterionResult,
    CorrectionRevision, Course, Enrollment, Question, Rubric, RubricCriterion,
    RubricLevel, Student, Submission, SubmissionAnswer,
)


class OwnedSerializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
        read_only_fields = ("id", "owner_id", "created_at", "updated_at")


class CourseSerializer(OwnedSerializer):
    # These values are annotated by CourseViewSet to avoid one or two extra
    # database queries for every row in the course list.
    student_count = serializers.IntegerField(read_only=True, default=0)
    assessment_count = serializers.IntegerField(read_only=True, default=0)

    class Meta(OwnedSerializer.Meta):
        model = Course
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "student_count", "assessment_count")

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El nombre del curso es obligatorio.")
        owner_id = getattr(self.context.get("request"), "user", None)
        owner_id = getattr(owner_id, "id", None)
        qs = Course.objects.filter(owner_id=owner_id, name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if owner_id and qs.exists():
            raise serializers.ValidationError("Ya existe un curso con ese nombre.")
        return value


class CourseOptionSerializer(serializers.ModelSerializer):
    """Minimal course representation for selectors in the correction workspace."""
    class Meta:
        model = Course
        fields = ("id", "name", "active")


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
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "enrollments")

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
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "enrolled_at", "student_name", "student_email", "student_external_code", "course_name")

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
        return attrs


class RubricLevelSerializer(OwnedSerializer):
    class Meta(OwnedSerializer.Meta):
        model = RubricLevel

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
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "levels")

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


class RubricSerializer(OwnedSerializer):
    criteria = RubricCriterionSerializer(many=True, read_only=True)

    class Meta(OwnedSerializer.Meta):
        model = Rubric
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "criteria")

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El título de la rúbrica es obligatorio.")
        return value


class QuestionSerializer(OwnedSerializer):
    class Meta(OwnedSerializer.Meta):
        model = Question

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


class AssessmentEditorSerializer(serializers.ModelSerializer):
    """Assessment metadata for the editor; excludes large reference material and nested questions."""
    course_name = serializers.CharField(source="course.name", read_only=True, allow_null=True)

    class Meta:
        model = Assessment
        fields = ("id", "title", "subject", "level", "objectives", "instructions", "status", "course", "course_name", "updated_at")


class AssessmentListSerializer(serializers.ModelSerializer):
    """Small payload for lists; full reference material is fetched only for one assessment."""
    course_name = serializers.CharField(source="course.name", read_only=True, allow_null=True)

    class Meta:
        model = Assessment
        fields = ("id", "title", "subject", "level", "status", "course", "course_name", "updated_at")


class AssessmentWorkspaceSerializer(serializers.ModelSerializer):
    """Selected assessment data without serializing its questions twice."""
    course_name = serializers.CharField(source="course.name", read_only=True, allow_null=True)

    class Meta:
        model = Assessment
        fields = (
            "id", "title", "subject", "level", "objectives", "instructions",
            "reference_material", "status", "course", "course_name", "updated_at",
        )


class AssessmentSerializer(OwnedSerializer):
    questions = QuestionSerializer(many=True, read_only=True)
    course_name = serializers.CharField(source="course.name", read_only=True)

    class Meta(OwnedSerializer.Meta):
        model = Assessment
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "questions", "course_name")

    def validate(self, attrs):
        course = attrs.get("course", getattr(self.instance, "course", None))
        if course and str(course.owner_id) != str(self.context["request"].user.id):
            raise serializers.ValidationError({"course": "Curso no disponible."})
        material = attrs.get("reference_material", getattr(self.instance, "reference_material", ""))
        if len(material or "") > 50000:
            raise serializers.ValidationError({"reference_material": "El material de referencia supera el límite de 50.000 caracteres extraídos."})
        return attrs


class SubmissionAnswerSerializer(OwnedSerializer):
    question_prompt = serializers.CharField(source="question.prompt", read_only=True)

    class Meta(OwnedSerializer.Meta):
        model = SubmissionAnswer
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "question_prompt")

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
        if submission and submission.status == "processing":
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
            "id", "assessment", "question", "student", "student_name",
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
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "status", "answers", "student_display_name")

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
        if assessment and assessment.course_id and student and not Enrollment.objects.filter(owner_id=owner_id, course_id=assessment.course_id, student=student, status="active").exists():
            raise serializers.ValidationError({"student": "El estudiante no está matriculado en el curso de esta evaluación."})
        return attrs


class CorrectionCriterionResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = CorrectionCriterionResult
        fields = ("id", "question", "criterion_name", "score", "max_score", "evidence", "justification", "feedback", "position")


class CorrectionSummarySerializer(serializers.ModelSerializer):
    """Compact correction row for course dashboards and delivery filters."""
    submission_assessment_id = serializers.IntegerField(source="submission.assessment_id", read_only=True)
    submission_title = serializers.CharField(source="submission.assessment.title", read_only=True)
    course_id = serializers.IntegerField(source="submission.assessment.course_id", read_only=True, allow_null=True)
    course_name = serializers.CharField(source="submission.assessment.course.name", read_only=True, allow_null=True)
    subject = serializers.CharField(source="submission.assessment.subject", read_only=True)
    student_name = serializers.SerializerMethodField()

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
        read_only_fields = (*OwnedSerializer.Meta.read_only_fields, "provider", "proposal", "final_result", "teacher_feedback", "total_score", "status", "approved_at", "criterion_results")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        assessment = instance.submission.assessment
        course = assessment.course
        student = instance.submission.student
        data["submission_title"] = assessment.title
        data["submission_assessment_id"] = instance.submission.assessment_id
        data["student_id"] = instance.submission.student_id
        data["student_name"] = student.name if student else (instance.submission.student_name or "Estudiante sin identificar")
        data["student_email"] = student.email if student else ""
        data["course_id"] = assessment.course_id
        data["course_name"] = course.name if course else None
        data["subject"] = assessment.subject
        return data


class ContactMessageSerializer(serializers.ModelSerializer):
    website = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = ContactMessage
        fields = ("name", "email", "subject", "message", "website")

    def validate_website(self, value):
        if value.strip():
            raise serializers.ValidationError("Solicitud inválida.")
        return value

    def validate_name(self, value):
        value = value.strip()
        if not value or len(value) > 120:
            raise serializers.ValidationError("Indicá un nombre válido.")
        return value

    def validate_subject(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("El asunto es obligatorio.")
        return value

    def validate_message(self, value):
        value = value.strip()
        if len(value) < 10:
            raise serializers.ValidationError("El mensaje debe tener al menos 10 caracteres.")
        return value
