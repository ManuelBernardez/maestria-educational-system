"""MaestrIA domain models.

Identity is owned by Supabase Auth. The UUID in owner_id must always come from a
verified bearer token; the API never trusts owner_id supplied by a client.
"""
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower


class OwnedModel(models.Model):
    owner_id = models.UUIDField(db_index=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Course(OwnedModel):
    name = models.CharField(max_length=160)
    subject = models.CharField(max_length=120, blank=True)
    level = models.CharField(max_length=120, blank=True)
    academic_year = models.CharField(max_length=20, blank=True)
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-updated_at", "name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), "owner_id", name="uniq_course_owner_name_ci"),
            models.UniqueConstraint(fields=["id", "owner_id"], name="uniq_course_id_owner"),
        ]
        indexes = [models.Index(fields=["owner_id", "active"], name="course_owner_active_idx")]

    def __str__(self):
        return self.name


class Student(OwnedModel):
    name = models.CharField(max_length=180)
    # Email is optional by design: collect it only when there is a defined need.
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=32, blank=True)
    external_code = models.CharField(max_length=80, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner_id", "external_code"],
                condition=~Q(external_code=""),
                name="uniq_student_external_code_per_owner",
            ),
            models.UniqueConstraint(fields=["id", "owner_id"], name="uniq_student_id_owner"),
        ]
        ordering = ["name"]
        indexes = [models.Index(fields=["owner_id", "active"], name="student_owner_active_idx")]

    def __str__(self):
        return self.name


class Enrollment(OwnedModel):
    STATUS_CHOICES = [("active", "Activa"), ("inactive", "Inactiva")]
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="enrollments")
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="enrollments")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="active")
    enrolled_at = models.DateTimeField(auto_now_add=True)
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        ordering = ["student__name"]
        constraints = [
            models.UniqueConstraint(fields=["course", "student"], name="uniq_enrollment_course_student"),
            models.CheckConstraint(condition=Q(status__in=["active", "inactive"]), name="enrollment_status_valid"),
        ]
        indexes = [models.Index(fields=["owner_id", "course", "status"], name="enroll_owner_course_status_idx")]

    def __str__(self):
        return f"{self.student} — {self.course}"


class Rubric(OwnedModel):
    SCALE_CHOICES = [("numeric", "Numérica"), ("levels", "Niveles de desempeño"), ("both", "Ambas")]
    title = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    scale_type = models.CharField(max_length=16, choices=SCALE_CHOICES, default="both")

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(scale_type__in=["numeric", "levels", "both"]), name="rubric_scale_type_valid"),
            models.UniqueConstraint(fields=["id", "owner_id"], name="uniq_rubric_id_owner"),
        ]

    def __str__(self):
        return self.title


class RubricCriterion(OwnedModel):
    rubric = models.ForeignKey(Rubric, on_delete=models.CASCADE, related_name="criteria")
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    max_score = models.DecimalField(max_digits=7, decimal_places=2, default=10)
    weight = models.DecimalField(max_digits=6, decimal_places=3, default=1)
    position = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["rubric", "position"], name="uniq_criterion_position_per_rubric"),
            models.CheckConstraint(condition=Q(max_score__gt=0) & Q(max_score__lte=1000), name="criterion_score_range"),
            models.CheckConstraint(condition=Q(weight__gte=0) & Q(weight__lte=100), name="criterion_weight_range"),
            models.UniqueConstraint(fields=["id", "owner_id"], name="uniq_rubriccriterion_id_owner"),
        ]


class RubricLevel(OwnedModel):
    criterion = models.ForeignKey(RubricCriterion, on_delete=models.CASCADE, related_name="levels")
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True)
    score = models.DecimalField(max_digits=7, decimal_places=2)
    position = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["criterion", "position"], name="uniq_rubric_level_position"),
            models.CheckConstraint(condition=Q(score__gte=0), name="rubric_level_score_nonnegative"),
        ]


class Assessment(OwnedModel):
    STATUS_CHOICES = [("draft", "Borrador"), ("ready", "Lista"), ("archived", "Archivada")]
    title = models.CharField(max_length=180)
    subject = models.CharField(max_length=120, blank=True)
    level = models.CharField(max_length=120, blank=True)
    objectives = models.TextField(blank=True)
    instructions = models.TextField(blank=True)
    # Text extracted from teacher-provided course material; binary files are not retained.
    reference_material = models.TextField(blank=True, default="")
    status = models.CharField(max_length=24, default="draft", choices=STATUS_CHOICES)
    # Nullable only to preserve existing evaluations during the migration; new UI asks for a course.
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, related_name="assessments", null=True, blank=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["owner_id", "status"], name="assessment_owner_status_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(status__in=["draft", "ready", "archived"]), name="assessment_status_valid"),
            models.UniqueConstraint(fields=["id", "owner_id"], name="uniq_assessment_id_owner"),
        ]

    def __str__(self):
        return self.title


class Question(OwnedModel):
    TYPE_CHOICES = [("open", "Respuesta abierta"), ("short", "Respuesta breve"), ("case", "Caso aplicado")]
    assessment = models.ForeignKey(Assessment, on_delete=models.CASCADE, related_name="questions")
    rubric = models.ForeignKey(Rubric, on_delete=models.SET_NULL, related_name="questions", null=True, blank=True)
    prompt = models.TextField()
    expected_answer = models.TextField(blank=True)
    question_type = models.CharField(max_length=16, choices=TYPE_CHOICES, default="open")
    max_score = models.DecimalField(max_digits=7, decimal_places=2, default=10)
    position = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["assessment", "position"], name="uniq_question_position_per_assessment"),
            models.CheckConstraint(condition=Q(max_score__gt=0) & Q(max_score__lte=1000), name="question_score_range"),
            models.CheckConstraint(condition=Q(question_type__in=["open", "short", "case"]), name="question_type_valid"),
            models.UniqueConstraint(fields=["id", "owner_id"], name="uniq_question_id_owner"),
        ]


class Submission(OwnedModel):
    STATUS_CHOICES = [("pending", "Pendiente"), ("processing", "Procesando"), ("review", "A revisar"), ("approved", "Aprobada")]
    SOURCE_CHOICES = [("text", "Texto"), ("txt", "TXT"), ("pdf", "PDF"), ("docx", "DOCX")]
    assessment = models.ForeignKey(Assessment, on_delete=models.PROTECT, related_name="submissions")
    # Backwards-compatible single-answer fields. Multi-question submissions use SubmissionAnswer.
    question = models.ForeignKey(Question, on_delete=models.PROTECT, related_name="submissions", null=True, blank=True)
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="submissions", null=True, blank=True)
    student_name = models.CharField(max_length=180, blank=True)
    answer_text = models.TextField(blank=True, default="")
    source_type = models.CharField(max_length=16, choices=SOURCE_CHOICES, default="text")
    source_filename = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=24, default="pending", choices=STATUS_CHOICES)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner_id", "status"], name="submission_owner_status_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(status__in=["pending", "processing", "review", "approved"]), name="submission_status_valid"),
            models.CheckConstraint(condition=Q(source_type__in=["text", "txt", "pdf", "docx"]), name="submission_source_type_valid"),
            models.UniqueConstraint(fields=["id", "owner_id"], name="uniq_submission_id_owner"),
        ]


class SubmissionAnswer(OwnedModel):
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(Question, on_delete=models.PROTECT, related_name="submitted_answers")
    answer_text = models.TextField()
    source_filename = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["question__position", "id"]
        constraints = [models.UniqueConstraint(fields=["submission", "question"], name="uniq_submission_question_answer")]


class Correction(OwnedModel):
    STATUS_CHOICES = [("pending_review", "Pendiente de revisión"), ("approved", "Aprobada"), ("rejected", "Rechazada")]
    submission = models.ForeignKey(Submission, on_delete=models.CASCADE, related_name="corrections")
    rubric = models.ForeignKey(Rubric, on_delete=models.PROTECT, related_name="corrections", null=True, blank=True)
    provider = models.CharField(max_length=32, default="mock")
    proposal = models.JSONField(default=dict)
    final_result = models.JSONField(default=dict, blank=True)
    teacher_feedback = models.TextField(blank=True)
    total_score = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    status = models.CharField(max_length=24, default="pending_review", choices=STATUS_CHOICES)
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner_id", "status"], name="correction_owner_status_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(total_score__gte=0), name="correction_total_nonnegative"),
            models.CheckConstraint(condition=Q(status__in=["pending_review", "approved", "rejected"]), name="correction_status_valid"),
            models.UniqueConstraint(fields=["id", "owner_id"], name="uniq_correction_id_owner"),
        ]


class CorrectionCriterionResult(OwnedModel):
    correction = models.ForeignKey(
        Correction,
        on_delete=models.CASCADE,
        related_name="criterion_results",
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="criterion_results",
    )
    criterion_name = models.CharField(max_length=160)
    score = models.DecimalField(max_digits=7, decimal_places=2)
    max_score = models.DecimalField(max_digits=7, decimal_places=2)
    evidence = models.TextField(blank=True)
    justification = models.TextField(blank=True)
    feedback = models.TextField(blank=True)
    position = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["correction", "position"],
                name="uniq_criterion_result_position",
            ),
            models.CheckConstraint(
                condition=Q(score__gte=0)
                & Q(max_score__gte=0)
                & Q(score__lte=models.F("max_score")),
                name="criterion_result_score_range",
            ),
        ]
        indexes = [
            models.Index(
                fields=["owner_id", "criterion_name"],
                name="corr_crit_owner_name_idx",
            ),
        ]


class CorrectionRevision(models.Model):
    correction = models.ForeignKey(Correction, on_delete=models.CASCADE, related_name="revisions")
    owner_id = models.UUIDField(db_index=True, editable=False)
    revision_number = models.PositiveIntegerField()
    previous_result = models.JSONField(default=dict, blank=True)
    new_result = models.JSONField(default=dict)
    reason = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["revision_number"]
        constraints = [models.UniqueConstraint(fields=["correction", "revision_number"], name="uniq_correction_revision_number")]


class AIGeneration(models.Model):
    """Operational trace only. Never store the prompt, answer text, email, or access token."""
    STATUS_CHOICES = [("succeeded", "Exitosa"), ("failed", "Fallida")]
    owner_id = models.UUIDField(db_index=True, editable=False)
    assessment = models.ForeignKey(Assessment, on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_generations")
    submission = models.ForeignKey(Submission, on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_generations")
    task = models.CharField(max_length=40, db_index=True)
    provider = models.CharField(max_length=32)
    model_name = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES)
    duration_ms = models.PositiveIntegerField(default=0)
    prompt_fingerprint = models.CharField(max_length=64, blank=True)
    error_code = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner_id", "task", "created_at"], name="ai_generation_owner_task_idx")]
        constraints = [models.CheckConstraint(condition=Q(status__in=["succeeded", "failed"]), name="ai_generation_status_valid")]


class AuditEvent(models.Model):
    """Minimal traceability events. Do not store student answer text or secrets."""
    owner_id = models.UUIDField(db_index=True)
    event_type = models.CharField(max_length=80, db_index=True)
    object_type = models.CharField(max_length=80)
    object_id = models.CharField(max_length=80)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner_id", "-created_at"], name="audit_owner_created_idx")]


class ContactMessage(models.Model):
    STATUS_CHOICES = [("new", "Nuevo"), ("handled", "Atendido"), ("spam", "Spam")]
    name = models.CharField(max_length=120)
    email = models.EmailField()
    subject = models.CharField(max_length=160)
    message = models.TextField(max_length=4000)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="new")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    # Honeypot must remain empty; the API rejects submissions where it is filled.
    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(status__in=["new", "handled", "spam"]), name="contact_status_valid"),
            models.CheckConstraint(condition=Q(message__length__lte=4000), name="contact_message_max_length"),
        ]
