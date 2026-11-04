"""Provision the canonical SQL schema inside pytest-django's disposable test DB."""
from pathlib import Path

import pytest
from django.db import connection


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
