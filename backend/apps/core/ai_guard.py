"""Protección de capacidad y costo para las llamadas síncronas a IA (AUD-001, AUD-005).

Cada generación ocupa un hilo de Gunicorn mientras espera al proveedor. Sin un tope,
unas pocas correcciones simultáneas dejaban sin hilos a todo el sitio (HTML, API y
health check). `ai_slot()` limita las generaciones concurrentes por proceso y aplica
una cuota diaria persistente por docente, contada en `public.ai_generation`.
"""
import asyncio
import threading
from contextlib import contextmanager
from datetime import timedelta

from asgiref.sync import async_to_sync
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException, Throttled

from .models import AIGeneration

_semaphore = None
_semaphore_size = None
_semaphore_lock = threading.Lock()


class AIBusy(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = (
        "MaestrIA está procesando muchas solicitudes de IA en este momento. "
        "Esperá unos segundos e intentá nuevamente; no se generó ninguna propuesta."
    )
    default_code = "ai_busy"

    def __init__(self, wait=15):
        super().__init__()
        # DRF agrega la cabecera Retry-After a partir de este atributo.
        self.wait = wait


def _get_semaphore():
    global _semaphore, _semaphore_size
    size = settings.AI_MAX_CONCURRENT_REQUESTS
    with _semaphore_lock:
        if _semaphore is None or _semaphore_size != size:
            _semaphore = threading.BoundedSemaphore(size)
            _semaphore_size = size
        return _semaphore


def check_daily_quota(owner_id):
    limit = settings.AI_DAILY_LIMIT_PER_USER
    if not limit:
        return
    since = timezone.now() - timedelta(hours=24)
    used = AIGeneration.objects.filter(owner_id=owner_id, created_at__gte=since).count()
    if used >= limit:
        raise Throttled(
            wait=60 * 60,
            detail=f"Alcanzaste el límite de {limit} generaciones con IA en 24 horas. Volvé a intentarlo más tarde.",
        )


def run_with_deadline(coroutine_function, *, deadline_seconds=None, **kwargs):
    """Ejecuta una generación async con un tope total (incluye reintentos del adaptador).

    Sin este tope, consignas y rúbricas podían ocupar un hilo ~170 s (85 s por intento
    más un reintento). Al vencer lanza asyncio.TimeoutError → PROVIDER_TIMEOUT (504).
    """
    timeout = deadline_seconds or settings.AI_SUGGESTION_DEADLINE_SECONDS

    async def runner():
        return await asyncio.wait_for(coroutine_function(**kwargs), timeout=timeout)

    return async_to_sync(runner)()


@contextmanager
def ai_slot(owner_id):
    """Reserva un cupo de IA del proceso; 503 si no se libera uno a tiempo."""
    check_daily_quota(owner_id)
    semaphore = _get_semaphore()
    if not semaphore.acquire(timeout=settings.AI_SLOT_WAIT_SECONDS):
        raise AIBusy()
    try:
        yield
    finally:
        semaphore.release()
