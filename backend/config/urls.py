import os

from django.http import JsonResponse
from django.urls import include, path

from apps.core.views import health


def api_root(request):
    """Friendly root response for this API-only backend.

    The public website is served by Next.js (normally localhost:3000); Django
    exposes JSON endpoints and should not show Django's debug 404 at /.
    """
    return JsonResponse(
        {
            "service": "MaestrIA API",
            "status": "ok",
            "message": "Este servidor expone la API. Abrí frontend_url para usar el sitio web.",
            "frontend_url": os.getenv("FRONTEND_URL", "http://localhost:3000"),
            "endpoints": {
                "health": "/api/health/",
                "api": "/api/",
            },
        }
    )


urlpatterns = [
    path("", api_root, name="api-root"),
    path("api/health/", health, name="health"),
    path("api/", include("apps.core.urls")),
]
