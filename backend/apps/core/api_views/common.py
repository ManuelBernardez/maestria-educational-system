from decimal import Decimal, InvalidOperation
import asyncio
import csv
import hashlib
import httpx
import io
import json
import logging
import os
from pathlib import Path
import time
import zipfile
from datetime import timedelta

from asgiref.sync import async_to_sync
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Count, IntegerField, Max, OuterRef, Prefetch, Q, Subquery, Value
from django.db.models.functions import Coalesce, Substr
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.exceptions import MethodNotAllowed, NotFound, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from ..ai import ai_error_code, default_rubric_for_question, generate_correction, generate_questions, generate_rubric
from ..models import (
    PROCESSING_LEASE_MINUTES, AIProviderConfig, AIGeneration, Assessment, AuditEvent, ContactMessage, Correction,
    CorrectionCriterionResult, CorrectionRevision, Course, Enrollment,
    Question, Rubric, RubricCriterion, RubricLevel, Student, Submission,
    SubmissionAnswer, UserProfile,
)
from ..serializers import (
    AssessmentEditorSerializer, AssessmentListSerializer, AssessmentSerializer, AssessmentWorkspaceSerializer, CorrectionSerializer,
    CourseDashboardSerializer, CourseNavigationSerializer, CourseOptionSerializer, CourseSerializer, EnrollmentSerializer, QuestionSerializer,
    CorrectionSummarySerializer, RubricCriterionSerializer, RubricLevelSerializer, RubricOptionSerializer, RubricSerializer,
    StudentOptionSerializer, StudentSerializer, SubmissionAnswerSerializer, SubmissionListSerializer, SubmissionSerializer,
)
from ..throttles import AIUserRateThrottle, ContactRateThrottle, ContactUserRateThrottle
from ..admin_api import PublicContactMessageSerializer

logger = logging.getLogger(__name__)
MAX_ANSWER_CHARS = 50_000
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
MAX_CORRECTION_ANSWERS = 10
MAX_CORRECTION_GENERATION_SECONDS = 120
MAX_CORRECTION_INPUT_CHARS = 100_000
MAX_DOCX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
MAX_DOCX_MEMBERS = 1_000

# Misma ventana que el worker de corrección (submissions.py): un
# status="processing" con updated_at anterior al corte es un lease expirado de
# un worker caído, no una corrección en curso, y no debe bloquear la edición
# indefinidamente. La constante vive en models.py (fuente única compartida
# con serializers.py).
def lock_owner_profile(owner_id):
    """Lock the authenticated owner's public profile as a per-user write mutex.

    Supabase owns auth.users and the application role must not lock that internal
    table. user_profile is application-owned, has one row per Auth UUID, and is
    already required by SupabaseJWTAuthentication.
    """
    try:
        return UserProfile.objects.select_for_update().get(user_id=owner_id, status="active")
    except UserProfile.DoesNotExist as exc:
        raise ValidationError({"detail": "El perfil autenticado no está disponible."}) from exc


def processing_lease_cutoff():
    return timezone.now() - timedelta(minutes=PROCESSING_LEASE_MINUTES)


def processing_is_fresh(record) -> bool:
    """True solo si el lease de corrección de la fila sigue en su ventana."""
    return record.status == "processing" and record.updated_at >= processing_lease_cutoff()


def claim_expired_processing_lease(record) -> bool:
    """Reclama un lease vencido devolviendo la fila a `pending` (devuelve True).

    Debe llamarse con la fila bloqueada (select_for_update) dentro de una
    transacción; la ejecución posterior debe volver a considerar el estado.
    """
    if record.status != "processing" or record.updated_at >= processing_lease_cutoff():
        return False
    record.status = "pending"
    record.save(update_fields=["status"])
    return True


def has_fresh_processing_submission(assessment, owner_id) -> bool:
    """Return whether the locked assessment has a live correction lease.

    Call inside transaction.atomic() after locking the Assessment row. Stale
    leases are reclaimed so crashed requests cannot block editing indefinitely.
    Lock submissions in stable PK order to keep concurrent mutations predictable.
    """
    active = False
    records = Submission.objects.select_for_update().filter(
        owner_id=owner_id, assessment=assessment, status="processing",
    ).order_by("pk")
    for record in records:
        if processing_is_fresh(record):
            active = True
        else:
            claim_expired_processing_lease(record)
    return active


def record_audit(owner_id, event_type, object_type, object_id, detail=None, request=None):
    """Persist minimal trace metadata; never include response content or secrets."""
    actor_role = "system"
    actor_user_id = None
    request_id = None
    ip_address = None
    user_agent = None
    if request is not None and getattr(request, "user", None) and getattr(request.user, "is_authenticated", False):
        actor_user_id = request.user.id
        # SupabaseJWTAuthentication already verified this role for the current
        # request. Reuse it instead of performing a second profile lookup for
        # every audit write. Keep a narrow fallback for alternate auth backends.
        verified_role = getattr(request.user, "role", "")
        if verified_role in {"teacher", "student", "admin", "superadmin"}:
            actor_role = verified_role
        else:
            actor_role = UserProfile.objects.filter(
                user_id=actor_user_id, status="active",
            ).values_list("role", flat=True).first() or "system"
        request_id = getattr(request, "request_id", None)
        ip_address = request.META.get("REMOTE_ADDR")
        user_agent = request.META.get("HTTP_USER_AGENT", "")[:1000] or None
    AuditEvent.objects.create(
        owner_id=owner_id, actor_user_id=actor_user_id, actor_role=actor_role,
        event_type=event_type, object_type=object_type, object_id=str(object_id),
        detail=detail or {}, request_id=request_id, ip_address=ip_address, user_agent=user_agent,
    )

def active_ai_provider_config():
    """Read non-secret routing configuration; provider credentials stay in env."""
    selected = AIProviderConfig.objects.filter(enabled=True).order_by("priority", "provider").first()
    if not selected:
        return None
    return {
        "provider": selected.provider,
        "model_name": selected.model_name,
        "timeout_seconds": selected.timeout_seconds,
    }

def record_ai_generation(owner_id, task, started, ok, fingerprint="", error_code="", assessment=None, submission=None, provider_config=None):
    provider_config = provider_config or active_ai_provider_config() or {}
    provider = provider_config.get("provider") or os.getenv("AI_PROVIDER", "mock")
    elapsed = min(max(int((time.monotonic() - started) * 1000), 0), 2_147_483_647)
    model_name = {
        "gemini": os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        "openai": os.getenv("OPENAI_MODEL", ""),
        "ollama": os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
    }.get(provider, "")
    model_name = provider_config.get("model_name") or model_name
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

AI_CONFIGURATION_ERROR_CODES = frozenset({
    "MISSING_GEMINI_API_KEY",
    "MISSING_OPENAI_API_KEY",
    "MISSING_OPENAI_MODEL",
    "INVALID_AI_PROVIDER",
    "INVALID_GEMINI_MODEL",
})


def ai_error_http_status(exc):
    """Map provider/configuration/deadline failures to actionable HTTP statuses."""
    code = ai_error_code(exc)
    if code in AI_CONFIGURATION_ERROR_CODES:
        return status.HTTP_503_SERVICE_UNAVAILABLE
    if code == "PROVIDER_TIMEOUT":
        return status.HTTP_504_GATEWAY_TIMEOUT
    return status.HTTP_502_BAD_GATEWAY


def _safe_ai_error_detail(exc, fallback):
    """Expose actionable local configuration errors, never raw provider responses."""
    message = str(exc).strip()
    if ai_error_code(exc) == "PROVIDER_TIMEOUT":
        return "La generación superó el tiempo máximo de procesamiento. La entrega quedó disponible para reintentar; revisá el proveedor o reducí la cantidad de respuestas."
    safe_prefixes = (
        "Falta GEMINI_API_KEY",
        "Falta OPENAI_API_KEY",
        "Falta OPENAI_MODEL",
        "AI_PROVIDER debe ser",
        "GEMINI_MODEL no tiene un nombre válido.",
    )
    if len(message) <= 350 and message.startswith(safe_prefixes):
        return message
    if len(message) <= 350 and message.startswith(("Gemini no devolvió", "La IA devolvió", "La IA no devolvió", "No se pudo alinear")):
        return message + " Probá de nuevo; si persiste, revisá el modelo configurado."
    # Mensajes accionables según el tipo de falla del proveedor, sin exponer su respuesta cruda.
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 429:
            return "El proveedor de IA alcanzó su límite de cuota o de velocidad. Esperá un minuto e intentá de nuevo (o revisá la cuota del proyecto)."
        host = (getattr(exc.response, "url", None).host if getattr(exc.response, "url", None) else "")
        if code in (401, 403):
            if host == "api.openai.com":
                return "OpenAI rechazó la clave API (HTTP %d). Revisá OPENAI_API_KEY y el acceso al modelo configurado." % code
            if host == "generativelanguage.googleapis.com":
                return "Gemini rechazó la clave API (HTTP %d). Revisá GEMINI_API_KEY y que la API esté habilitada para el proyecto." % code
            return "El proveedor de IA rechazó la autenticación (HTTP %d). Revisá la credencial configurada." % code
        if code in (400, 404):
            from ..ai import provider_error_info
            provider_message, provider_state = provider_error_info(exc)
            if host == "api.openai.com":
                hint = " Revisá OPENAI_MODEL, los permisos de la clave y la disponibilidad del modelo en tu proyecto."
                return f"OpenAI rechazó la solicitud (HTTP {code} {provider_state}): {provider_message}.{hint}".replace("..", ".")
            if host == "generativelanguage.googleapis.com":
                hint = " Revisá GEMINI_API_KEY y GEMINI_MODEL."
                if "location" in provider_message.lower():
                    hint = " La región del servidor no está habilitada para esta API."
                elif "billing" in provider_message.lower() or "quota" in provider_message.lower():
                    hint = " Revisá la facturación/cuota del proyecto en Google AI Studio."
                return f"Google rechazó la solicitud (HTTP {code} {provider_state}): {provider_message}.{hint}".replace("..", ".")
            return f"El proveedor rechazó la solicitud (HTTP {code}): {provider_message}. Revisá el modelo y la configuración.".replace("..", ".")
        if code >= 500:
            return "El proveedor de IA tuvo un error temporal (HTTP %d). Intentá nuevamente en unos instantes." % code
    if isinstance(exc, httpx.TimeoutException):
        return "El proveedor de IA tardó demasiado en responder. Intentá nuevamente; si la entrega es muy larga, dividila."
    if isinstance(exc, httpx.ConnectError):
        return "No se pudo conectar con el proveedor de IA desde el servidor. Intentá nuevamente en unos instantes."
    return fallback

def courses_with_dashboard_counts(owner_id, *, active_only=False):
    """Return owner-scoped courses with isolated count subqueries.

    Separate correlated subqueries avoid multiplying enrollment and assessment
    rows together in a joined aggregate when a course has many of both.
    """
    active_enrollment_count = (
        Enrollment.objects.filter(
            owner_id=owner_id,
            course_id=OuterRef("pk"),
            status="active",
            student__owner_id=owner_id,
            student__active=True,
        )
        .order_by()
        .values("course_id")
        .annotate(total=Count("student_id"))
        .values("total")[:1]
    )
    assessment_count = (
        Assessment.objects.filter(owner_id=owner_id, course_id=OuterRef("pk"))
        .order_by()
        .values("course_id")
        .annotate(total=Count("id"))
        .values("total")[:1]
    )
    queryset = Course.objects.filter(owner_id=owner_id)
    if active_only:
        queryset = queryset.filter(active=True)
    return queryset.annotate(
        student_count=Coalesce(Subquery(active_enrollment_count, output_field=IntegerField()), Value(0), output_field=IntegerField()),
        assessment_count=Coalesce(Subquery(assessment_count, output_field=IntegerField()), Value(0), output_field=IntegerField()),
    )

class OwnerViewSet(viewsets.ModelViewSet):
    """Base class enforcing tenant filtering and server-assigned ownership."""
    def get_queryset(self):
        return self.queryset.filter(owner_id=self.request.user.id)

    def perform_create(self, serializer):
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
