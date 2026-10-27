"""Enforce tenant ownership across relational links at the PostgreSQL layer.

The API filters every queryset by owner_id. These composite FKs are a second
barrier: even a future endpoint bug cannot attach one teacher's row to another
teacher's course, assessment, student, rubric, submission or correction.
"""
from django.db import migrations, models


# (child table, child FK column, parent table, constraint name, delete action)
RELATIONSHIPS = (
    ("core_enrollment", "course_id", "core_course", "fk_enrollment_course_owner", "CASCADE"),
    ("core_enrollment", "student_id", "core_student", "fk_enrollment_student_owner", "NO ACTION"),
    ("core_assessment", "course_id", "core_course", "fk_assessment_course_owner", "SET NULL (course_id)"),
    ("core_rubriccriterion", "rubric_id", "core_rubric", "fk_criterion_rubric_owner", "CASCADE"),
    ("core_rubriclevel", "criterion_id", "core_rubriccriterion", "fk_level_criterion_owner", "CASCADE"),
    ("core_question", "assessment_id", "core_assessment", "fk_question_assessment_owner", "CASCADE"),
    ("core_question", "rubric_id", "core_rubric", "fk_question_rubric_owner", "SET NULL (rubric_id)"),
    ("core_submission", "assessment_id", "core_assessment", "fk_submission_assessment_owner", "NO ACTION"),
    ("core_submission", "question_id", "core_question", "fk_submission_question_owner", "NO ACTION"),
    ("core_submission", "student_id", "core_student", "fk_submission_student_owner", "NO ACTION"),
    ("core_submissionanswer", "submission_id", "core_submission", "fk_answer_submission_owner", "CASCADE"),
    ("core_submissionanswer", "question_id", "core_question", "fk_answer_question_owner", "NO ACTION"),
    ("core_correction", "submission_id", "core_submission", "fk_correction_submission_owner", "CASCADE"),
    ("core_correction", "rubric_id", "core_rubric", "fk_correction_rubric_owner", "NO ACTION"),
    ("core_correctioncriterionresult", "correction_id", "core_correction", "fk_result_correction_owner", "CASCADE"),
    ("core_correctioncriterionresult", "question_id", "core_question", "fk_result_question_owner", "SET NULL (question_id)"),
    ("core_correctionrevision", "correction_id", "core_correction", "fk_revision_correction_owner", "CASCADE"),
    ("core_aigeneration", "assessment_id", "core_assessment", "fk_ai_assessment_owner", "SET NULL (assessment_id)"),
    ("core_aigeneration", "submission_id", "core_submission", "fk_ai_submission_owner", "SET NULL (submission_id)"),
)


def check_relationships(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        tables = set(connection.introspection.table_names())
        for child, field, parent, _constraint, _on_delete in RELATIONSHIPS:
            if child not in tables or parent not in tables:
                raise RuntimeError(
                    f"No se puede asegurar la propiedad entre {child}.{field} y {parent}: "
                    "falta una tabla. Verificá el orden de migraciones."
                )
            cursor.execute(
                f"SELECT count(*) FROM public.{child} c "
                f"LEFT JOIN public.{parent} p ON p.id = c.{field} AND p.owner_id = c.owner_id "
                f"WHERE c.{field} IS NOT NULL AND p.id IS NULL"
            )
            mismatches = cursor.fetchone()[0]
            if mismatches:
                raise RuntimeError(
                    f"No se puede aplicar la migración: {child}.{field} tiene {mismatches} "
                    "relación(es) inexistentes o de otra cuenta. No se modificaron los datos; "
                    "ejecutá database/diagnostico-pendientes-v0.2.0.sql y corregí las relaciones en una copia."
                )


def add_relationship_constraints(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        existing_tables = set(connection.introspection.table_names())
        for child, field, parent, constraint, on_delete in RELATIONSHIPS:
            if child not in existing_tables or parent not in existing_tables:
                raise RuntimeError(f"Falta la tabla requerida para la restricción {constraint}.")
            cursor.execute(
                "SELECT 1 FROM pg_constraint WHERE conname = %s AND conrelid = %s::regclass",
                [constraint, f"public.{child}"],
            )
            if cursor.fetchone():
                continue
            cursor.execute(
                f"ALTER TABLE public.{child} ADD CONSTRAINT {constraint} "
                f"FOREIGN KEY ({field}, owner_id) REFERENCES public.{parent} (id, owner_id) "
                f"ON DELETE {on_delete} NOT VALID"
            )
            cursor.execute(
                f"ALTER TABLE public.{child} VALIDATE CONSTRAINT {constraint}"
            )


def remove_relationship_constraints(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        for child, _field, _parent, constraint, _on_delete in reversed(RELATIONSHIPS):
            cursor.execute(
                "SELECT 1 FROM pg_constraint WHERE conname = %s AND conrelid = %s::regclass",
                [constraint, f"public.{child}"],
            )
            if cursor.fetchone():
                cursor.execute(f"ALTER TABLE public.{child} DROP CONSTRAINT {constraint}")


class Migration(migrations.Migration):
    dependencies = [("core", "0006_owner_auth_user_foreign_keys")]
    operations = [
        migrations.RunPython(check_relationships, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="course",
            constraint=models.UniqueConstraint(fields=("id", "owner_id"), name="uniq_course_id_owner"),
        ),
        migrations.AddConstraint(
            model_name="student",
            constraint=models.UniqueConstraint(fields=("id", "owner_id"), name="uniq_student_id_owner"),
        ),
        migrations.AddConstraint(
            model_name="rubric",
            constraint=models.UniqueConstraint(fields=("id", "owner_id"), name="uniq_rubric_id_owner"),
        ),
        migrations.AddConstraint(
            model_name="rubriccriterion",
            constraint=models.UniqueConstraint(fields=("id", "owner_id"), name="uniq_rubriccriterion_id_owner"),
        ),
        migrations.AddConstraint(
            model_name="assessment",
            constraint=models.UniqueConstraint(fields=("id", "owner_id"), name="uniq_assessment_id_owner"),
        ),
        migrations.AddConstraint(
            model_name="question",
            constraint=models.UniqueConstraint(fields=("id", "owner_id"), name="uniq_question_id_owner"),
        ),
        migrations.AddConstraint(
            model_name="submission",
            constraint=models.UniqueConstraint(fields=("id", "owner_id"), name="uniq_submission_id_owner"),
        ),
        migrations.AddConstraint(
            model_name="correction",
            constraint=models.UniqueConstraint(fields=("id", "owner_id"), name="uniq_correction_id_owner"),
        ),
        migrations.RunPython(add_relationship_constraints, remove_relationship_constraints),
    ]
