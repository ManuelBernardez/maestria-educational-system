import mimetypes
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.conf import settings

from apps.core.views import health


def api_root(request):
    """Small health-oriented API description; no secrets are exposed here."""
    return JsonResponse({
        "service": "MaestrIA API",
        "status": "ok",
        "message": "Aplicación MaestrIA disponible.",
        "frontend_url": settings.SITE_URL,
        "endpoints": {"health": "/api/health/", "api": "/api/"},
    })


def frontend_file(request, frontend_path=""):
    """Serve the HTML5 frontend from the same origin without directory listing."""
    relative = (frontend_path or "index.html").lstrip("/")
    candidate = (settings.FRONTEND_DIR / relative).resolve()
    root = settings.FRONTEND_DIR.resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise Http404
    if candidate.is_dir():
        candidate = candidate / "index.html"
    if not candidate.is_file() or candidate.name.startswith("."):
        raise Http404

    content_type, _ = mimetypes.guess_type(str(candidate))
    response = FileResponse(candidate.open("rb"), content_type=content_type or "application/octet-stream")
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response["X-Frame-Options"] = "DENY"
    response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    if candidate.suffix.lower() in {".html", ".htm"}:
        response["Cache-Control"] = "no-store, max-age=0"
    else:
        response["Cache-Control"] = "public, max-age=3600"
    return response


urlpatterns = [
    path("api/health/", health, name="health"),
    path("api/", api_root, name="api-root"),
    path("api/", include("apps.core.urls")),
    path("", frontend_file, name="frontend-home"),
    re_path(r"^(?P<frontend_path>.*)$", frontend_file, name="frontend-file"),
]
