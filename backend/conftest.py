"""Install the real production schema inside pytest-django's disposable test DB.

La suite usa el MISMO contrato que producción: `db/maestria_schema.sql` (snapshot de
`supabase db dump`) más las migraciones de `backend/database/migrations/` posteriores
a la versión que declara su encabezado. Así los índices únicos, FK compuestas,
triggers y longitudes de columnas que rigen en Supabase también rigen en los tests
(AUD-004: el antiguo `test_schema.sql` mantenido a mano había divergido).
"""
import os
import re
from pathlib import Path

import pytest
from django.conf import settings
from django.db import connection

# settings.py carga backend/.env automáticamente. Ese archivo suele apuntar a la base
# Supabase real y a un proveedor de IA externo con credenciales. La suite nunca debe
# crear su base de prueba en ese servidor ni enviar datos de prueba a un proveedor.
_db_host = str(settings.DATABASES["default"].get("HOST") or "").lower()
if _db_host.endswith((".supabase.co", ".supabase.com")):
    pytest.exit(
        "La suite de pruebas no puede ejecutarse contra Supabase (DATABASE_URL apunta a "
        f"{_db_host}). Exportá DATABASE_URL con un PostgreSQL local o de CI antes de ejecutar pytest.",
        returncode=2,
    )
# El proveedor se lee del entorno en cada llamada: forzar mock y vaciar credenciales.
# Las pruebas que necesitan otro proveedor lo configuran explícitamente con mocks HTTP.
os.environ["AI_PROVIDER"] = "mock"
for _key in ("GEMINI_API_KEY", "OPENAI_API_KEY"):
    os.environ[_key] = ""

REPO_ROOT = Path(__file__).resolve().parent.parent
SUPABASE_STUB = REPO_ROOT / "db" / "local_supabase_stub.sql"
PRODUCTION_SNAPSHOT = REPO_ROOT / "db" / "maestria_schema.sql"
MIGRATIONS_DIR = Path(__file__).resolve().parent / "database" / "migrations"
# El encabezado puede partir la frase en dos líneas de comentario SQL ("--").
_SNAPSHOT_VERSION_RE = re.compile(r"Incluye las migraciones hasta[\s-]+(\d{14})")


def schema_install_files():
    """Stub de Supabase, snapshot de producción y migraciones pendientes, en orden."""
    header = PRODUCTION_SNAPSHOT.read_text(encoding="utf-8")[:4000]
    match = _SNAPSHOT_VERSION_RE.search(header)
    if not match:
        raise RuntimeError(
            "db/maestria_schema.sql debe declarar en su encabezado "
            "'Incluye las migraciones hasta <versión>'."
        )
    snapshot_version = match.group(1)
    pending = sorted(
        path for path in MIGRATIONS_DIR.glob("*.sql")
        if path.name[:14].isdigit() and path.name[:14] > snapshot_version
    )
    return [SUPABASE_STUB, PRODUCTION_SNAPSHOT, *pending]


def _execute_sql_file(cursor, path, sqlparse):
    for statement in sqlparse.split(path.read_text(encoding="utf-8")):
        cleaned = statement.strip()
        if cleaned:
            cursor.execute(cleaned)


@pytest.fixture(scope="session", autouse=True)
def install_supabase_contract_schema(django_db_setup, django_db_blocker):
    if connection.vendor != "postgresql":
        pytest.skip("MaestrIA integration tests require PostgreSQL, not SQLite.")
    try:
        import sqlparse
    except ImportError:
        pytest.fail("sqlparse (dependency of Django) is required to load the test schema.")
    with django_db_blocker.unblock(), connection.cursor() as cursor:
        # Con una caché DatabaseCache, Django crea django_cache al armar la base de test;
        # la definición válida es la del snapshot de producción.
        cursor.execute("DROP TABLE IF EXISTS public.django_cache")
        for path in schema_install_files():
            _execute_sql_file(cursor, path, sqlparse)
        # Sólo en pruebas: permite `SET LOCAL ROLE maestria_app` para ejecutar la API con
        # el rol de mínimo privilegio (LeastPrivilegeRoleTests). En Supabase local, como en
        # producción, postgres no es superusuario y necesita la membresía explícita.
        cursor.execute("GRANT maestria_app TO CURRENT_USER")
        # pg_dump deja en la sesión `search_path` vacío y `row_security = off` (este último
        # convertiría cualquier consulta afectada por RLS en error): volver a los valores
        # de la conexión, que incluyen `-c search_path=public` de settings.py.
        cursor.execute("RESET ALL")
