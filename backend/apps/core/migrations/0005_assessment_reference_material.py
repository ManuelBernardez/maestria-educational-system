from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0004_rename_criterion_result_owner_index")]

    operations = [
        migrations.AddField(
            model_name="assessment",
            name="reference_material",
            field=models.TextField(blank=True, default=""),
        ),
    ]
