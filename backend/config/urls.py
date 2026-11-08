import mimetypes
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.conf import settings

from apps.core.views import health

ASSETS_COOKIE = "maestria_assets"


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
    """Serve the HTML5 frontend from the same origin without directory listing.

    Las rutas de recursos estáticos (/assets/, /css/, /js/) son responsabilidad
    exclusiva de WhiteNoise en producción y de los finders de
    django.contrib.staticfiles en desarrollo. Esta vista de fallback solo sirve
    documentos HTML del sitio público y del espacio docente; nunca intenta resolver
    archivos estáticos, para evitar devolver 404 con MIME text/html cuando
    WhiteNoise no encuentra el recurso.
    """
    relative = (frontend_path or "index.html").lstrip("/")
    if relative.startswith(("assets/", "css/", "js/")):
        raise Http404
    if not relative:
        relative = "index.html"
    candidate = (settings.FRONTEND_DIR / "html" / relative).resolve()
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
        # Una sola vez por versión: borra JS/CSS que el navegador guardó con la política
        # de caché anterior (7 días sin revalidar) y que mezclaría con los módulos nuevos.
        version = settings.FRONTEND_ASSETS_VERSION
        if request.COOKIES.get(ASSETS_COOKIE) != version:
            response["Clear-Site-Data"] = '"cache"'
            response.set_cookie(ASSETS_COOKIE, version, max_age=60 * 60 * 24 * 365, secure=request.is_secure(), httponly=True, samesite="Lax")
        # CSP belongs on the HTML document: its connect-src directive governs
        # browser fetches to Supabase Auth. All inline scripts/styles were removed.
        response["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "connect-src 'self' https://*.supabase.co https://*.supabase.com; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
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
