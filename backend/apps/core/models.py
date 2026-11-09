"""ORM mapping for Supabase's externally managed public schema.

Supabase SQL owns the physical schema. Every model is unmanaged and maps an
existing public table. ForeignKey fields provide ORM navigation only; PostgreSQL
keeps the composite (foreign_id, owner_id) constraints authoritative.
Supabase Auth UUIDs are never mapped to django.contrib.auth.User.
"""
from django.db import models

# Ventana de lease de corrección: un status="processing" cuya fila fue
# actualizada hace más tiempo que esta ventana es un lease expirado de un
# worker caído (p. ej. el servidor de desarrollo se recargó a mitad de la
# request), no una corrección en curso. Valida un máximo realista de duración
# de la generación (HTTP capped en 85 s por respuesta) con margen.
PROCESSING_LEASE_MINUTES = 5


class PublicTable(models.Model):
    class Meta:
        abstract = True
        managed = False


class OwnedTable(PublicTable):
    owner_id = models.UUIDField(editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        managed = False


class Course(OwnedTable):
    name = models.CharField(max_length=160)
    subject = models.CharField(max_length=120, blank=True, default="")
    level = models.CharField(max_length=120, blank=True, default="")
    academic_year = models.CharField(max_length=20, blank=True, default="")
    description = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "course"
        ordering = ["-updated_at", "name"]

    def __str__(self):
        return self.name


class Student(OwnedTable):
    name = models.CharField(max_length=180)
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=32, blank=True, default="")
    external_code = models.CharField(max_length=80, blank=True, default="")
    account_user_id = models.UUIDField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        managed = False
        db_table = "student"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Rubric(OwnedTable):
    SCALE_CHOICES = [("numeric", "Numérica"), ("levels", "Niveles"), ("both", "Ambas")]
    title = models.CharField(max_length=180)
    description = models.TextField(blank=True, default="")
    scale_type = models.CharField(max_length=16, choices=SCALE_CHOICES, default="both")

    class Meta:
        managed = False
        db_table = "rubric"

    def __str__(self):
        return self.title


class RubricCriterion(OwnedTable):
    rubric = models.ForeignKey(Rubric, db_constraint=False, on_delete=models.PROTECT, related_name="criteria")
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True, default="")
    max_score = models.DecimalField(max_digits=38, decimal_places=18, default=10)
    weight = models.DecimalField(max_digits=38, decimal_places=18, default=1)
    position = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = "rubric_criterion"
        ordering = ["position", "id"]


class RubricLevel(OwnedTable):
    criterion = models.ForeignKey(RubricCriterion, db_constraint=False, on_delete=models.PROTECT, related_name="levels")
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True, default="")
    score = models.DecimalField(max_digits=38, decimal_places=18)
    position = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = "rubric_level"
        ordering = ["position", "id"]


class Assessment(OwnedTable):
    STATUS_CHOICES = [("draft", "Borrador"), ("ready", "Lista"), ("archived", "Archivada")]
    title = models.CharField(max_length=180)
    subject = models.CharField(max_length=120, blank=True, default="")
    level = models.CharField(max_length=120, blank=True, default="")
    objectives = models.TextField(blank=True, default="")
    instructions = models.TextField(blank=True, default="")
    reference_material = models.TextField(blank=True, default="")
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="draft")
    course = models.ForeignKey(Course, db_constraint=False, on_delete=models.PROTECT, related_name="assessments", null=True, blank=True)

    class Meta:
        managed = False
        db_table = "assessment"
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title


class Question(OwnedTable):
    TYPE_CHOICES = [("open", "Respuesta abierta"), ("short", "Respuesta breve"), ("case", "Caso")]
    prompt = models.TextField()
    expected_answer = models.TextField(blank=True, default="")
    question_type = models.CharField(max_length=16, choices=TYPE_CHOICES, default="open")
    max_score = models.DecimalField(max_digits=38, decimal_places=18, default=10)
    position = models.IntegerField(default=1)
    assessment = models.ForeignKey(Assessment, db_constraint=False, on_delete=models.PROTECT, related_name="questions")
    rubric = models.ForeignKey(Rubric, db_constraint=False, on_delete=models.PROTECT, related_name="questions", null=True, blank=True)

    class Meta:
        managed = False
        db_table = "question"
        ordering = ["position", "id"]


class Enrollment(OwnedTable):
    STATUS_CHOICES = [("active", "Activa"), ("inactive", "Inactiva")]
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="active")
    enrolled_at = models.DateTimeField(auto_now_add=True)
    notes = models.CharField(max_length=250, blank=True, default="")
    course = models.ForeignKey(Course, db_constraint=False, on_delete=models.PROTECT, related_name="enrollments")
    student = models.ForeignKey(Student, db_constraint=False, on_delete=models.PROTECT, related_name="enrollments")

    class Meta:
        managed = False
        db_table = "enrollment"
        ordering = ["student__name"]

    def __str__(self):
        return f"{self.student} — {self.course}"


class Submission(OwnedTable):
    STATUS_CHOICES = [("pending", "Pendiente"), ("processing", "Procesando"), ("review", "A revisar"), ("approved", "Aprobada")]
    SOURCE_CHOICES = [("text", "Texto"), ("txt", "TXT"), ("pdf", "PDF"), ("docx", "DOCX")]
    student_name = models.CharField(max_length=180, blank=True, default="")
    answer_text = models.TextField(blank=True, default="")
    source_type = models.CharField(max_length=16, choices=SOURCE_CHOICES, default="text")
    source_filename = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="pending")
    assessment = models.ForeignKey(Assessment, db_constraint=False, on_delete=models.PROTECT, related_name="submissions")
    question = models.ForeignKey(Question, db_constraint=False, on_delete=models.PROTECT, related_name="submissions", null=True, blank=True)
    student = models.ForeignKey(Student, db_constraint=False, on_delete=models.PROTECT, related_name="submissions", null=True, blank=True)

    class Meta:
        managed = False
        db_table = "submission"
        ordering = ["-created_at"]


class SubmissionAnswer(OwnedTable):
    answer_text = models.TextField()
    source_filename = models.CharField(max_length=255, blank=True, default="")
    submission = models.ForeignKey(Submission, db_constraint=False, on_delete=models.PROTECT, related_name="answers")
    question = models.ForeignKey(Question, db_constraint=False, on_delete=models.PROTECT, related_name="submitted_answers")

    class Meta:
        managed = False
        db_table = "submission_answer"
        ordering = ["question__position", "id"]


class Correction(OwnedTable):
    STATUS_CHOICES = [("pending_review", "Pendiente de revisión"), ("approved", "Aprobada"), ("rejected", "Rechazada")]
    provider = models.CharField(max_length=32, default="mock")
    proposal = models.JSONField(default=dict)
    final_result = models.JSONField(default=dict)
    teacher_feedback = models.TextField(blank=True, default="")
    total_score = models.DecimalField(max_digits=38, decimal_places=18, default=0)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="pending_review")
    approved_at = models.DateTimeField(null=True, blank=True)
    rubric = models.ForeignKey(Rubric, db_constraint=False, on_delete=models.PROTECT, related_name="corrections", null=True, blank=True)
    submission = models.ForeignKey(Submission, db_constraint=False, on_delete=models.PROTECT, related_name="corrections")

    class Meta:
        managed = False
        db_table = "correction"
        ordering = ["-created_at"]


class CorrectionCriterionResult(OwnedTable):
    criterion_name = models.CharField(max_length=160)
    score = models.DecimalField(max_digits=38, decimal_places=18)
    max_score = models.DecimalField(max_digits=38, decimal_places=18)
    evidence = models.TextField(blank=True, default="")
    justification = models.TextField(blank=True, default="")
    feedback = models.TextField(blank=True, default="")
    position = models.IntegerField(default=1)
    correction = models.ForeignKey(Correction, db_constraint=False, on_delete=models.PROTECT, related_name="criterion_results")
    question = models.ForeignKey(Question, db_constraint=False, on_delete=models.PROTECT, related_name="criterion_results", null=True, blank=True)

    class Meta:
        managed = False
        db_table = "correction_criterion_result"
        ordering = ["position", "id"]


class CorrectionRevision(PublicTable):
    correction = models.ForeignKey(Correction, db_constraint=False, on_delete=models.PROTECT, related_name="revisions")
    owner_id = models.UUIDField(editable=False)
    revision_number = models.IntegerField()
    previous_result = models.JSONField(default=dict)
    new_result = models.JSONField(default=dict)
    reason = models.CharField(max_length=250, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "correction_revision"
        ordering = ["revision_number"]


class AIGeneration(PublicTable):
    STATUS_CHOICES = [("succeeded", "Exitosa"), ("failed", "Fallida")]
    owner_id = models.UUIDField(editable=False)
    task = models.CharField(max_length=40)
    provider = models.CharField(max_length=32)
    model_name = models.CharField(max_length=120, blank=True, default="")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES)
    duration_ms = models.IntegerField(default=0)
    input_tokens = models.IntegerField(default=0)
    output_tokens = models.IntegerField(default=0)
    estimated_cost_usd = models.DecimalField(max_digits=38, decimal_places=18, null=True, blank=True)
    prompt_fingerprint = models.CharField(max_length=128, blank=True, default="")
    error_code = models.CharField(max_length=80, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    assessment = models.ForeignKey(Assessment, db_constraint=False, on_delete=models.PROTECT, related_name="ai_generations", null=True, blank=True)
    submission = models.ForeignKey(Submission, db_constraint=False, on_delete=models.PROTECT, related_name="ai_generations", null=True, blank=True)

    class Meta:
        managed = False
        db_table = "ai_generation"
        ordering = ["-created_at"]


class AuditEvent(PublicTable):
    ACTOR_ROLE_CHOICES = [(role, role) for role in ("teacher", "student", "admin", "superadmin", "system")]
    # NULL cuando la identidad dueña fue eliminada de Supabase Auth: la traza se conserva
    # (migración 20261109174649, AUD-008).
    owner_id = models.UUIDField(editable=False, null=True)
    # Largos iguales a las columnas reales de producción (AUD-015).
    event_type = models.CharField(max_length=80)
    object_type = models.CharField(max_length=80)
    object_id = models.CharField(max_length=80)
    detail = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    actor_user_id = models.UUIDField(null=True, blank=True)
    actor_role = models.CharField(max_length=24, choices=ACTOR_ROLE_CHOICES, null=True, blank=True)
    request_id = models.CharField(max_length=128, null=True, blank=True)
    ip_address = models.GenericIPAddressField(protocol="both", unpack_ipv4=True, null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "audit_event"
        ordering = ["-created_at"]


class ContactMessage(PublicTable):
    STATUS_CHOICES = [("new", "Nuevo"), ("in_progress", "En gestión"), ("handled", "Atendido"), ("spam", "Spam")]
    name = models.CharField(max_length=180)
    email = models.EmailField(max_length=254)
    subject = models.CharField(max_length=240)
    message = models.TextField(max_length=4000)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="new")
    internal_notes = models.TextField(blank=True, default="")
    assigned_to = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    user_id = models.UUIDField(null=True, blank=True)
    category = models.CharField(max_length=80, default="general")
    source = models.CharField(max_length=80, default="public_web")
    assigned_at = models.DateTimeField(null=True, blank=True)
    handled_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict)

    class Meta:
        managed = False
        db_table = "contact_message"
        ordering = ["-created_at"]


class UserProfile(PublicTable):
    ROLE_CHOICES = [(r, r) for r in ("teacher", "student", "admin", "superadmin")]
    STATUS_CHOICES = [(s, s) for s in ("active", "suspended", "deleted")]
    user_id = models.UUIDField(unique=True)
    email = models.EmailField(max_length=254, blank=True, default="")
    full_name = models.CharField(max_length=180, blank=True, default="")
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default="teacher")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="active")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    role_updated_at = models.DateTimeField(null=True, blank=True)
    role_updated_by = models.UUIDField(null=True, blank=True)
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspended_by = models.UUIDField(null=True, blank=True)
    suspension_reason = models.TextField(blank=True, default="")

    class Meta:
        managed = False
        db_table = "user_profile"
        ordering = ["-created_at"]


class Institution(PublicTable):
    STATUS_CHOICES = [(s, s) for s in ("active", "suspended", "archived")]
    name = models.CharField(max_length=180)
    slug = models.SlugField(max_length=180, unique=True)
    contact_email = models.EmailField(max_length=254, blank=True, default="")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="active")
    created_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.UUIDField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "institution"
        ordering = ["name"]


class InstitutionMembership(PublicTable):
    ROLE_CHOICES = [(r, r) for r in ("teacher", "department_admin", "institution_admin")]
    STATUS_CHOICES = [(s, s) for s in ("invited", "active", "suspended")]
    institution = models.ForeignKey(Institution, db_constraint=False, on_delete=models.PROTECT, related_name="memberships")
    user_id = models.UUIDField()
    role = models.CharField(max_length=24, choices=ROLE_CHOICES, default="teacher")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="active")
    invited_by = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.UUIDField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "institution_membership"
        ordering = ["-created_at"]


class AIProviderConfig(PublicTable):
    PROVIDER_CHOICES = [(p, p) for p in ("mock", "gemini", "openai", "ollama")]
    provider = models.CharField(max_length=24, choices=PROVIDER_CHOICES, unique=True)
    model_name = models.CharField(max_length=160, blank=True, default="")
    enabled = models.BooleanField(default=False)
    priority = models.SmallIntegerField(default=10)
    timeout_seconds = models.SmallIntegerField(default=60)
    input_usd_per_1k_tokens = models.DecimalField(max_digits=38, decimal_places=18, null=True, blank=True)
    output_usd_per_1k_tokens = models.DecimalField(max_digits=38, decimal_places=18, null=True, blank=True)
    updated_by = models.UUIDField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "ai_provider_config"
        ordering = ["priority", "provider"]
