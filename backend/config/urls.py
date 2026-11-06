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
    if relative == "index.html" or (relative and not relative.startswith(("css/", "js/", "assets/"))):
        candidate = (settings.FRONTEND_DIR / "html" / relative).resolve()
    else:
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
    # Cabecera de contenido cruzado: los recursos estáticos solo son legibles por el mismo origen.
    response["Cross-Origin-Resource-Policy"] = "same-origin"
    if candidate.suffix.lower() in {".html", ".htm"}:
        response["Cache-Control"] = "no-store, max-age=0"
        # La aplicación usa un script en línea reducido (tema) en espacio-docente/index.html;
        # se permite 'unsafe-inline' solo para scripts, el resto se restringe a mismo origen.
        # El frontend contacta al Auth de Supabase desde el navegador para OAuth y
        # refresco de tokens; esas llamadas salen a *.supabase.co y deben estar permitidas.
        response["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "connect-src 'self' https://*.supabase.co https://*.supabase.com; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'"
        )
    elif candidate.suffix.lower() in {".js", ".css", ".csv"}:
        # Sin hash en el nombre: revalidar siempre (igual que WhiteNoise) para no servir JS viejo.
        response["Cache-Control"] = "no-cache"
        response["Content-Security-Policy"] = "default-src 'none'; script-src 'self'; style-src 'self'; object-src 'none';"
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
