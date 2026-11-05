from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("core", "0001_initial")]
    operations = [
        migrations.CreateModel(
            name="AuditEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_id", models.UUIDField(db_index=True)),
                ("event_type", models.CharField(db_index=True, max_length=80)),
                ("object_type", models.CharField(max_length=80)),
                ("object_id", models.CharField(max_length=80)),
                ("detail", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddIndex(model_name="auditevent", index=models.Index(fields=["owner_id", "-created_at"], name="audit_owner_created_idx")),
    ]
