"""Provision the canonical SQL schema inside pytest-django's disposable test DB."""
import os
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
os.environ["AI_EXTERNAL_PROCESSING_APPROVED"] = "False"
for _key in ("GEMINI_API_KEY", "OPENAI_API_KEY"):
    os.environ[_key] = ""


@pytest.fixture(scope="session", autouse=True)
def install_supabase_contract_schema(django_db_setup, django_db_blocker):
    if connection.vendor != "postgresql":
        pytest.skip("MaestrIA integration tests require PostgreSQL, not SQLite.")
    sql_path = Path(__file__).resolve().parent / "database" / "test_schema.sql"
    sql = sql_path.read_text(encoding="utf-8")
    try:
        import sqlparse
    except ImportError as exc:
        pytest.fail("sqlparse (dependency of Django) is required to load the test schema.")
    with django_db_blocker.unblock():
        with connection.cursor() as cursor:
            for statement in sqlparse.split(sql):
                cleaned = statement.strip()
                if cleaned:
                    cursor.execute(cleaned)
