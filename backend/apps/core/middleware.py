"""Small API timing header to separate backend work from browser/network latency."""
from time import perf_counter


class ApiServerTimingMiddleware:
    """Expose total Django response time for API diagnostics without logging payloads."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = perf_counter()
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            duration_ms = max(0.0, (perf_counter() - started) * 1000)
            response["Server-Timing"] = f"django;dur={duration_ms:.1f}"
        return response
