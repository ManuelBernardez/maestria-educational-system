"""Prevent concurrent or case-only duplicate course names per teacher."""
from django.db import migrations, models
from django.db.models import Count
from django.db.models.functions import Lower


def check_case_insensitive_duplicates(apps, schema_editor):
    Course = apps.get_model("core", "Course")
    db = schema_editor.connection.alias
    duplicates = (
        Course.objects.using(db)
        .order_by()
        .annotate(_normalized_name=Lower("name"))
        .values("owner_id", "_normalized_name")
        .annotate(_total=Count("pk"))
        .filter(_total__gt=1)
    )
    if duplicates.exists():
        raise RuntimeError(
            "Hay cursos de una misma cuenta cuyos nombres solo se diferencian "
            "por mayúsculas/minúsculas. No se modificaron datos. Renombrá esos "
            "cursos y volvé a ejecutar las migraciones."
        )


class Migration(migrations.Migration):
    dependencies = [("core", "0008_merge_20261026_1639")]

    operations = [
        migrations.RunPython(check_case_insensitive_duplicates, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="course",
            name="uniq_course_name_per_owner",
        ),
        migrations.AddConstraint(
            model_name="course",
            constraint=models.UniqueConstraint(
                Lower("name"), "owner_id", name="uniq_course_owner_name_ci"
            ),
        ),
    ]
