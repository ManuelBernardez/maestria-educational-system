import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# Environment variables supplied by the hosting platform take precedence over .env.
load_dotenv(BASE_DIR / ".env", override=False)

DEBUG = os.getenv("DEBUG", "False").strip().lower() == "true"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "").strip()
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-local-development-key-change-me"
    else:
        raise RuntimeError("Falta DJANGO_SECRET_KEY. Definí una clave aleatoria y privada en el entorno.")
if not DEBUG and ("change-me" in SECRET_KEY.lower() or "replace-with" in SECRET_KEY.lower() or "your-secret" in SECRET_KEY.lower() or len(SECRET_KEY) < 40):
    raise RuntimeError("DJANGO_SECRET_KEY parece una clave de ejemplo o demasiado corta; generá una clave privada de al menos 40 caracteres.")

ALLOWED_HOSTS = [
    h.strip()
    for h in os.getenv(
        "ALLOWED_HOSTS",
        "localhost,127.0.0.1"
    ).split(",")
    if h.strip()
]

# Render proporciona automáticamente el hostname del servicio.
render_hostname = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()

if render_hostname and render_hostname not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(render_hostname)

# One-origin deployment: Django serves the public HTML5 frontend and the API.
FRONTEND_DIR = BASE_DIR.parent / "frontend"
if not FRONTEND_DIR.is_dir():
    raise RuntimeError("No se encontró el directorio frontend/ junto a backend/.")
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

# Avoid the confusing PostgreSQL password error caused by leaving Supabase's
# placeholders in the URI. Never log or echo the connection string itself.
if DATABASE_URL and re.search(r"(?:YOUR(?:[-_ ]?PASSWORD|_URL_ENCODED_PASSWORD)|YOUR[-_ ]?PROJECT|\[YOUR-PASSWORD\]|<[^>]*PASSWORD[^>]*>)", DATABASE_URL, re.I):
    raise RuntimeError("DATABASE_URL todavía contiene marcadores de ejemplo. Copiá la URI real desde Supabase y reemplazá los marcadores sin compartirla.")
if not DEBUG and not DATABASE_URL:
    raise RuntimeError("Falta DATABASE_URL en producción. Configurá la conexión PostgreSQL de Supabase.")

if DATABASE_URL:
    parsed_db_url = urlsplit(DATABASE_URL)
    if parsed_db_url.scheme not in {"postgres", "postgresql", "sqlite"}:
        raise RuntimeError("DATABASE_URL debe ser una URI PostgreSQL (postgresql://...) o SQLite solo para desarrollo.")
    if not DEBUG and parsed_db_url.scheme == "sqlite":
        raise RuntimeError("SQLite está habilitado solo para desarrollo. Configurá DATABASE_URL con PostgreSQL en producción.")
    if parsed_db_url.scheme in {"postgres", "postgresql"} and (not parsed_db_url.hostname or not parsed_db_url.path.strip("/") or not parsed_db_url.username or parsed_db_url.password is None):
        raise RuntimeError("DATABASE_URL no tiene usuario, contraseña, host o nombre de base de datos válido. Copiá la URI completa desde Supabase y codificá los caracteres reservados de la contraseña.")
    use_ssl = not DEBUG or bool(parsed_db_url.hostname and (parsed_db_url.hostname.endswith(".supabase.co") or parsed_db_url.hostname.endswith(".pooler.supabase.com")))
    db_config = dj_database_url.parse(
        DATABASE_URL,
        conn_max_age=60,
        conn_health_checks=True,
        ssl_require=use_ssl,
        engine="django.db.backends.postgresql" if parsed_db_url.scheme in {"postgres", "postgresql"} else "django.db.backends.sqlite3",
    )
    if parsed_db_url.scheme in {"postgres", "postgresql"}:
        # PostgreSQL Supabase schema is externally managed and resolves by public search_path.
        db_options = db_config.setdefault("OPTIONS", {})
        db_options["connect_timeout"] = 10
        # Supabase Shared Pooler transaction mode (port 6543) does not support
        # prepared statements. Render is a persistent backend, so session mode
        # (port 5432) is generally preferred and keeps prepared statements enabled.
        if (
            parsed_db_url.hostname
            and parsed_db_url.hostname.endswith(".pooler.supabase.com")
            and parsed_db_url.port == 6543
        ):
            db_options["prepare_threshold"] = None
        current_options = db_options.get("options", "").strip()
        db_options["options"] = f"{current_options} -c search_path=public".strip()
    DATABASES = {"default": db_config}
else:
    # SQLite is intentionally limited to local development and isolated tests.
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

# Supabase Auth is the only identity provider. Django's built-in auth/session apps
# are intentionally not installed because the API authenticates bearer JWTs directly.
INSTALLED_APPS = [
    # `runserver` delega /assets/ en WhiteNoise: mismo `no-cache` que producción, para que
    # el navegador no mezcle módulos ES viejos y nuevos (ver config/static_files.py).
    "whitenoise.runserver_nostatic",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "apps.core",
]

# Supabase SQL owns public.*. The legacy core migration graph creates core_* and
# targets obsolete tables; do not replay/fake it. The ORM models are unmanaged.
MIGRATION_MODULES = {"core": None}
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise debe ir inmediatamente después de SecurityMiddleware (antes de cualquier otro
    # middleware) para interceptar y servir los archivos estáticos recopilados en STATIC_ROOT.
    # WhiteNoise con búsqueda de estáticos corregida para Windows (ver config/static_files.py).
    "config.static_files.MaestriaWhiteNoiseMiddleware",
    # Comprime las respuestas JSON de la API (listas de entregas/cursos): menos bytes sobre la red.
    "django.middleware.gzip.GZipMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "apps.core.middleware.ApiServerTimingMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = []
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

LANGUAGE_CODE = "es-ar"
TIME_ZONE = "America/Argentina/Buenos_Aires"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/assets/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# Django espera tuplas (prefijo, directorio). Con el orden invertido el sitio queda sin CSS ni JS.
STATICFILES_DIRS = [("css", FRONTEND_DIR / "css"), ("js", FRONTEND_DIR / "js"), FRONTEND_DIR / "assets"]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
WHITENOISE_MAX_AGE = 60 * 60 * 24


# Versión de los recursos del frontend. Al cambiarla, cada navegador recibe una única vez
# `Clear-Site-Data: "cache"` en el próximo HTML y descarta copias viejas de JS/CSS.
FRONTEND_ASSETS_VERSION = "1.1.3"


def _whitenoise_headers(headers, path, url):
    """JS, CSS y CSV se revalidan siempre (ETag/Last-Modified → 304 si no cambiaron).

    Los módulos ES se importan entre sí sin versión en la URL (`./core/utils.js`): si el
    navegador los guarda con max-age, tras un despliegue mezcla módulos viejos y nuevos
    (export inexistente, 404 de archivos renombrados). Por eso nunca se cachean sin revalidar.
    """
    if str(url).endswith((".js", ".mjs", ".css", ".csv")):
        headers["Cache-Control"] = "no-cache"


WHITENOISE_ADD_HEADERS_FUNCTION = _whitenoise_headers
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# In the combined deployment, browser requests are same-origin. Keep optional
# explicit origins for local development or a future separately hosted client.
CORS_ALLOWED_ORIGINS = [x.strip().rstrip("/") for x in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500").split(",") if x.strip()]
CSRF_TRUSTED_ORIGINS = [x.strip().rstrip("/") for x in os.getenv("CSRF_TRUSTED_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500").split(",") if x.strip()]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.core.authentication.SupabaseJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["apps.core.permissions.IsWorkspaceUser"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    # Avoid loading django.contrib.auth.models.AnonymousUser for unauthenticated API requests.
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"],
    # Cada guardado del espacio docente recarga ~10 recursos; 120/min se agotaba en pocas acciones.
    # Los límites se pueden ajustar por entorno sin tocar el código.
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.getenv("THROTTLE_ANON_RATE", "60/min"),
        "user": os.getenv("THROTTLE_USER_RATE", "900/min"),
        "ai": os.getenv("THROTTLE_AI_RATE", "120/hour"),
        "contact": "5/hour",
    },
    # Paginar los listados por defecto para evitar respuestas ilimitadas a medida que
    # crecen los cursos, entregas, correcciones y mensajes de administración.
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.BoundedPageNumberPagination",
}

# Upload/body limits are intentionally conservative; CSV import also checks 2 MB and 500 rows.
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_SSL_REDIRECT = not DEBUG
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
# La API se autentica con Bearer JWT en sessionStorage, no con cookies de sesión,
# por lo que la cookie CSRF no necesita leerse desde JS ni enviarse en peticiones
# cruzadas del frontend. SameSite Lax es suficiente para el uso de un mismo origen.
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

# SITE_URL is the public origin. FRONTEND_URL remains supported for compatibility.
SITE_URL = os.getenv("SITE_URL", os.getenv("FRONTEND_URL", "http://localhost:5500")).strip().rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", SITE_URL).strip().rstrip("/")

EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True").lower() == "true"
# SMTP must not hold an API worker indefinitely when the provider is unreachable.
try:
    EMAIL_TIMEOUT = min(max(int(os.getenv("EMAIL_TIMEOUT", "5")), 1), 30)
except ValueError:
    EMAIL_TIMEOUT = 5
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "")
