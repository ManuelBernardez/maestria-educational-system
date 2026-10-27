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

ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]
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
        # Preserve sslmode from the URI/ssl_require while adding a short connect timeout.
        db_config.setdefault("OPTIONS", {})["connect_timeout"] = 10
    DATABASES = {"default": db_config}
else:
    # SQLite is intentionally limited to local development and isolated tests.
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

# Supabase Auth is the only identity provider. Django's built-in auth/session apps
# are intentionally not installed because the API authenticates bearer JWTs directly.
INSTALLED_APPS = [
    "corsheaders",
    "rest_framework",
    "apps.core",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
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
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = [x.strip().rstrip("/") for x in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",") if x.strip()]
CSRF_TRUSTED_ORIGINS = [x.strip().rstrip("/") for x in os.getenv("CSRF_TRUSTED_ORIGINS", "http://localhost:3000").split(",") if x.strip()]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.core.authentication.SupabaseJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    # Avoid loading django.contrib.auth.models.AnonymousUser for unauthenticated API requests.
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": "30/min", "user": "120/min", "ai": "10/hour", "contact": "5/hour"},
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
CSRF_COOKIE_HTTPONLY = False  # Django's CSRF token may be read by trusted frontend code if needed.
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True").lower() == "true"
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "")
