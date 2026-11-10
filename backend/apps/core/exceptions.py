"""Traducción de errores de base de datos a respuestas HTTP controladas (AUD-003).

PostgreSQL es la fuente de verdad de la integridad (índices únicos, FK compuestas,
triggers). Cuando una escritura los viola, el cliente debe recibir un 409 con un
mensaje comprensible, no un 500 opaco. Nunca se expone el nombre del índice ni el
detalle de PostgreSQL (puede incluir valores de otras filas).
"""
import logging
import math

from django.db import DataError, IntegrityError
from django.db.models import ProtectedError, RestrictedError
from rest_framework import status
from rest_framework.exceptions import Throttled
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)

# Mensajes por restricción conocida de producción. Las no listadas usan el genérico.
CONSTRAINT_MESSAGES = {
    "uniq_course_owner_name_ci": "Ya existe un curso con ese nombre en tu cuenta.",
    "uniq_enrollment_course_student": "El estudiante ya tiene una matrícula en este curso.",
    "uniq_student_external_code_per_owner": "Ya existe un estudiante con ese código externo.",
    "uniq_question_position_per_assessment": "Otra consigna ya ocupa esa posición. Recargá la evaluación e intentá nuevamente.",
    "uniq_criterion_position_per_rubric": "Otro criterio ya ocupa esa posición en la rúbrica.",
    "uniq_rubric_level_position": "Otro nivel ya ocupa esa posición en el criterio.",
    "uniq_submission_question_answer": "La entrega ya tiene una respuesta para esa consigna.",
    "uniq_approved_correction_per_submission": "La entrega ya tiene una corrección aprobada.",
    "uniq_pending_correction_per_submission": "Ya existe una propuesta pendiente para esta entrega.",
    "uniq_enabled_ai_provider": "Ya hay otro proveedor de IA habilitado. Deshabilitalo antes de activar uno nuevo.",
    "uq_institution_membership_user": "La persona ya tiene una membresía en esta institución.",
    "uq_user_profile_email_ci": "Ya existe un perfil con ese correo electrónico.",
    "institution_slug_key": "Ya existe una institución con ese identificador (slug).",
    "ai_provider_config_provider_key": "Ese proveedor de IA ya está configurado.",
}
GENERIC_CONFLICT = "La operación entra en conflicto con datos existentes. Recargá e intentá nuevamente."


def _constraint_name(exc):
    cause = getattr(exc, "__cause__", None)
    diag = getattr(cause, "diag", None)
    return getattr(diag, "constraint_name", None) or ""


def _with_request_id(response, context):
    request = context.get("request")
    request_id = getattr(request, "request_id", None) or getattr(getattr(request, "_request", None), "request_id", None)
    if request_id and isinstance(response.data, dict):
        response.data.setdefault("request_id", request_id)
    return response


def _wait_text(wait):
    if not wait:
        return "en unos instantes"
    seconds = int(math.ceil(wait))
    if seconds < 60:
        return "en 1 segundo" if seconds == 1 else f"en {seconds} segundos"
    minutes = int(math.ceil(seconds / 60))
    return "en 1 minuto" if minutes == 1 else f"en {minutes} minutos"


def _throttle_scopes(context):
    view = context.get("view")
    return {getattr(cls, "scope", None) for cls in getattr(view, "throttle_classes", ()) or ()}


def _throttled_message(wait, scopes):
    """Explica qué límite se alcanzó, por qué existe y cuándo se puede volver a intentar.

    Reemplaza el texto genérico de DRF («Solicitud fue regulada (throttled)…»).
    """
    when = _wait_text(wait)
    if "contact" in scopes:
        return (
            "Ya enviaste varios mensajes en poco tiempo. Para evitar el spam, el formulario "
            "acepta hasta 5 mensajes por hora desde cada conexión. Tus mensajes anteriores sí "
            f"se recibieron. Vas a poder enviar uno nuevo {when}."
        )
    if "ai" in scopes:
        return (
            "Hiciste muchas solicitudes a la IA en poco tiempo. Para cuidar el servicio hay un "
            f"límite por hora. No se generó nada nuevo: podés volver a intentarlo {when}."
        )
    return (
        "Se hicieron demasiadas solicitudes seguidas desde tu conexión y el servidor las pausó "
        f"por seguridad. No se guardó ningún cambio. Podés intentarlo de nuevo {when}."
    )


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None:
        # Los Throttled con mensaje propio (p. ej. la cuota diaria de IA) se respetan;
        # sólo se reemplaza el texto genérico de DRF.
        if isinstance(exc, Throttled) and str(exc.detail).startswith(str(Throttled.default_detail)):
            response.data["detail"] = _throttled_message(exc.wait, _throttle_scopes(context))
        return response
    view_name = type(context.get("view")).__name__
    if isinstance(exc, IntegrityError):
        constraint = _constraint_name(exc)
        logger.info("Integrity conflict in %s (constraint=%s)", view_name, constraint or "unknown")
        detail = CONSTRAINT_MESSAGES.get(constraint, GENERIC_CONFLICT)
        return _with_request_id(Response({"detail": detail}, status=status.HTTP_409_CONFLICT), context)
    if isinstance(exc, (ProtectedError, RestrictedError)):
        logger.info("Protected delete rejected in %s", view_name)
        return _with_request_id(Response(
            {"detail": "No se puede eliminar porque tiene información asociada. Archivalo en lugar de eliminarlo."},
            status=status.HTTP_409_CONFLICT,
        ), context)
    if isinstance(exc, DataError):
        logger.info("Data error in %s", view_name)
        return _with_request_id(Response(
            {"detail": "Algún dato enviado no tiene un formato o longitud válidos."},
            status=status.HTTP_400_BAD_REQUEST,
        ), context)
    return None
