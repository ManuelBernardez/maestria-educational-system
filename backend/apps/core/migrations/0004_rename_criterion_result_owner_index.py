from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0003_courses_files_and_traceability")]

    operations = [
        migrations.RenameIndex(
            model_name="correctioncriterionresult",
            old_name="criterion_result_owner_name_idx",
            new_name="corr_crit_owner_name_idx",
        ),
    ]
