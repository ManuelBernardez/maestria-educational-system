"""Bind tenant-owned records to the Supabase Auth identity that owns them.

On Supabase/PostgreSQL, every owner_id references auth.users(id) and account
removal cascades through the owner's MaestrIA data. SQLite remains available for
local isolated tests; it intentionally skips the Supabase-specific constraint.
"""
from django.db import migrations


OWNER_TABLES = (
    "core_course",
    "core_student",
    "core_enrollment",
    "core_rubric",
    "core_rubriccriterion",
    "core_rubriclevel",
    "core_assessment",
    "core_question",
    "core_submission",
    "core_submissionanswer",
    "core_correction",
    "core_correctioncriterionresult",
    "core_correctionrevision",
    "core_aigeneration",
    "core_auditevent",
)


def add_owner_foreign_keys(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return

    quote = connection.ops.quote_name
    with connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('auth.users')")
        if cursor.fetchone()[0] is None:
            raise RuntimeError(
                "MaestrIA requiere Supabase Auth: no existe auth.users. "
                "Configurá DATABASE_URL para el proyecto Supabase correcto."
            )

        existing_tables = set(connection.introspection.table_names())
        for table in OWNER_TABLES:
            if table not in existing_tables:
                raise RuntimeError(f"No se puede enlazar la propiedad: falta la tabla {table}.")
            constraint = f"{table}_owner_auth_user_fk"
            cursor.execute(
                "SELECT 1 FROM pg_constraint WHERE conname = %s AND conrelid = %s::regclass",
                [constraint, f"public.{table}"],
            )
            if cursor.fetchone():
                continue
            cursor.execute(
                f"SELECT count(*) FROM public.{quote(table)} t "
                "LEFT JOIN auth.users u ON u.id = t.owner_id WHERE u.id IS NULL"
            )
            orphan_count = cursor.fetchone()[0]
            if orphan_count:
                raise RuntimeError(
                    f"La tabla {table} contiene {orphan_count} registro(s) cuyo owner_id no existe en auth.users. "
                    "No se modificaron esos datos; revisá el backup y la consulta de diagnóstico antes de migrar."
                )
            cursor.execute(
                f"ALTER TABLE public.{quote(table)} "
                f"ADD CONSTRAINT {quote(constraint)} "
                f"FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID"
            )
            # Validate existing data now; don't silently leave orphan owner UUIDs.
            cursor.execute(
                f"ALTER TABLE public.{quote(table)} VALIDATE CONSTRAINT {quote(constraint)}"
            )


def remove_owner_foreign_keys(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    quote = connection.ops.quote_name
    with connection.cursor() as cursor:
        for table in reversed(OWNER_TABLES):
            constraint = f"{table}_owner_auth_user_fk"
            cursor.execute(
                "SELECT 1 FROM pg_constraint WHERE conname = %s AND conrelid = %s::regclass",
                [constraint, f"public.{table}"],
            )
            if cursor.fetchone():
                cursor.execute(
                    f"ALTER TABLE public.{quote(table)} DROP CONSTRAINT {quote(constraint)}"
                )


class Migration(migrations.Migration):
    dependencies = [("core", "0005_assessment_reference_material")]
    operations = [migrations.RunPython(add_owner_foreign_keys, remove_owner_foreign_keys)]
