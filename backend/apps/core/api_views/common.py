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
    AIProviderConfig, AIGeneration, Assessment, AuditEvent, ContactMessage, Correction,
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
MAX_CORRECTION_INPUT_CHARS = 100_000
MAX_DOCX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
MAX_DOCX_MEMBERS = 1_000

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
        "openai": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
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
    if len(message) <= 350 and message.startswith(("Gemini no devolvió", "La IA devolvió", "La IA no devolvió", "No se pudo alinear")):
        return message + " Probá de nuevo; si persiste, revisá el modelo configurado."
    # Mensajes accionables según el tipo de falla del proveedor, sin exponer su respuesta cruda.
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 429:
            return "El proveedor de IA alcanzó su límite de cuota o de velocidad. Esperá un minuto e intentá de nuevo (o revisá la cuota del proyecto)."
        if code in (401, 403):
            return "El proveedor de IA rechazó la clave API (HTTP %d). Revisá GEMINI_API_KEY y que la API esté habilitada para el proyecto." % code
        if code in (400, 404):
            return "El proveedor de IA rechazó la solicitud (HTTP %d). Verificá que GEMINI_MODEL sea un modelo disponible para tu clave." % code
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
