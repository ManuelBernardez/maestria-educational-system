"""Request correlation and timing metadata without request-payload logging."""
import re
from time import perf_counter
from uuid import uuid4

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class ApiServerTimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = perf_counter()
        candidate = request.headers.get("X-Request-ID", "")
        request.request_id = candidate if _REQUEST_ID_RE.fullmatch(candidate) else str(uuid4())
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            duration_ms = max(0.0, (perf_counter() - started) * 1000)
            response["Server-Timing"] = f"django;dur={duration_ms:.1f}"
            response["X-Request-ID"] = request.request_id
        return response
