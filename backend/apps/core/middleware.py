"""Request correlation and timing metadata without request-payload logging."""
import logging
import re
from time import perf_counter
from uuid import uuid4

from .network import proxy_header_shape

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class ApiServerTimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = perf_counter()
        candidate = request.headers.get("X-Request-ID", "")
        request.request_id = candidate if _REQUEST_ID_RE.fullmatch(candidate) else str(uuid4())
        response = self.get_response(request)
        response.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        if request.path.startswith("/api/"):
            duration_ms = max(0.0, (perf_counter() - started) * 1000)
            response["Server-Timing"] = f"django;dur={duration_ms:.1f}"
            response["X-Request-ID"] = request.request_id
            response["Cache-Control"] = "no-store"
            # La API devuelve JSON; no debe cargar ni incrustar recursos de ningún origen.
            response.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none';")
            response.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        return response


_proxy_logger = logging.getLogger("maestria.proxy")


class ProxyHeaderProbeMiddleware:
    """Diagnóstico temporal (LOG_PROXY_HEADERS=True): registra la forma de los headers
    de proxy de cada pedido a /api/ para medir NUM_PROXIES en producción. No registra
    IPs, rutas con identificadores ni contenido; se desactiva quitando la variable."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/"):
            _proxy_logger.warning("proxy_headers %s", proxy_header_shape(request))
        return self.get_response(request)
