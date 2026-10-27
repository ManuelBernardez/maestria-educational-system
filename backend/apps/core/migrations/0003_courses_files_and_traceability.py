import django.db.models.deletion
import uuid
from django.db import migrations, models
from django.db.models import Q

def normalize_existing_positions(apps, schema_editor):
    """Repair legacy duplicate positions before adding uniqueness constraints."""
    Question = apps.get_model("core", "Question")
    RubricCriterion = apps.get_model("core", "RubricCriterion")
    db = schema_editor.connection.alias
    for assessment_id in Question.objects.using(db).values_list("assessment_id", flat=True).distinct():
        rows = Question.objects.using(db).filter(assessment_id=assessment_id).order_by("position", "id")
        for position, row in enumerate(rows, start=1):
            if row.position != position:
                Question.objects.using(db).filter(pk=row.pk).update(position=position)
    for rubric_id in RubricCriterion.objects.using(db).values_list("rubric_id", flat=True).distinct():
        rows = RubricCriterion.objects.using(db).filter(rubric_id=rubric_id).order_by("position", "id")
        for position, row in enumerate(rows, start=1):
            if row.position != position:
                RubricCriterion.objects.using(db).filter(pk=row.pk).update(position=position)


def reverse_normalize(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("core", "0002_auditevent")]
    operations = [
        migrations.CreateModel(
            name="Course",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_id", models.UUIDField(db_index=True, editable=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=160)), ("subject", models.CharField(blank=True, max_length=120)),
                ("level", models.CharField(blank=True, max_length=120)), ("academic_year", models.CharField(blank=True, max_length=20)),
                ("description", models.TextField(blank=True)), ("active", models.BooleanField(default=True)),
            ], options={"ordering": ["-updated_at", "name"]},
        ),
        migrations.AddField(
            model_name="rubric", name="scale_type",
            field=models.CharField(choices=[("numeric", "Numérica"), ("levels", "Niveles de desempeño"), ("both", "Ambas")], default="both", max_length=16),
        ),
        migrations.AddField(
            model_name="assessment", name="course",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assessments", to="core.course"),
        ),
        migrations.AddField(
            model_name="question", name="rubric",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="questions", to="core.rubric"),
        ),
        migrations.AddField(model_name="question", name="expected_answer", field=models.TextField(blank=True, default=""), preserve_default=False),
        migrations.AddField(model_name="question", name="question_type", field=models.CharField(choices=[("open", "Respuesta abierta"), ("short", "Respuesta breve"), ("case", "Caso aplicado")], default="open", max_length=16)),
        migrations.AlterField(model_name="submission", name="answer_text", field=models.TextField(blank=True, default="")),
        migrations.AddField(model_name="submission", name="source_type", field=models.CharField(choices=[("text", "Texto"), ("txt", "TXT"), ("pdf", "PDF"), ("docx", "DOCX")], default="text", max_length=16)),
        migrations.AddField(model_name="submission", name="source_filename", field=models.CharField(blank=True, max_length=255, default=""), preserve_default=False),
        migrations.CreateModel(
            name="Enrollment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_id", models.UUIDField(db_index=True, editable=False)), ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)), ("status", models.CharField(choices=[("active", "Activa"), ("inactive", "Inactiva")], default="active", max_length=16)),
                ("enrolled_at", models.DateTimeField(auto_now_add=True)), ("notes", models.CharField(blank=True, max_length=250)),
                ("course", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="enrollments", to="core.course")),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="enrollments", to="core.student")),
            ], options={"ordering": ["student__name"]},
        ),
        migrations.CreateModel(
            name="RubricLevel",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_id", models.UUIDField(db_index=True, editable=False)), ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)), ("name", models.CharField(max_length=80)), ("description", models.TextField(blank=True)),
                ("score", models.DecimalField(decimal_places=2, max_digits=7)), ("position", models.PositiveIntegerField(default=1)),
                ("criterion", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="levels", to="core.rubriccriterion")),
            ], options={"ordering": ["position", "id"]},
        ),
        migrations.CreateModel(
            name="SubmissionAnswer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_id", models.UUIDField(db_index=True, editable=False)), ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)), ("answer_text", models.TextField()), ("source_filename", models.CharField(blank=True, max_length=255)),
                ("question", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="submitted_answers", to="core.question")),
                ("submission", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="answers", to="core.submission")),
            ], options={"ordering": ["question__position", "id"]},
        ),
        migrations.CreateModel(
            name="CorrectionCriterionResult",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_id", models.UUIDField(db_index=True, editable=False)), ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)), ("criterion_name", models.CharField(max_length=160)),
                ("score", models.DecimalField(decimal_places=2, max_digits=7)), ("max_score", models.DecimalField(decimal_places=2, max_digits=7)),
                ("evidence", models.TextField(blank=True)), ("justification", models.TextField(blank=True)), ("feedback", models.TextField(blank=True)),
                ("position", models.PositiveIntegerField(default=1)),
                ("correction", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="criterion_results", to="core.correction")),
                ("question", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="criterion_results", to="core.question")),
            ], options={"ordering": ["position", "id"]},
        ),
        migrations.CreateModel(
            name="CorrectionRevision",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_id", models.UUIDField(db_index=True, editable=False)), ("revision_number", models.PositiveIntegerField()),
                ("previous_result", models.JSONField(blank=True, default=dict)), ("new_result", models.JSONField(default=dict)),
                ("reason", models.CharField(blank=True, max_length=250)), ("created_at", models.DateTimeField(auto_now_add=True)),
                ("correction", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="revisions", to="core.correction")),
            ], options={"ordering": ["revision_number"]},
        ),
        migrations.CreateModel(
            name="AIGeneration",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_id", models.UUIDField(db_index=True, editable=False)), ("task", models.CharField(db_index=True, max_length=40)),
                ("provider", models.CharField(max_length=32)), ("model_name", models.CharField(blank=True, max_length=100)),
                ("status", models.CharField(choices=[("succeeded", "Exitosa"), ("failed", "Fallida")], max_length=16)),
                ("duration_ms", models.PositiveIntegerField(default=0)), ("prompt_fingerprint", models.CharField(blank=True, max_length=64)),
                ("error_code", models.CharField(blank=True, max_length=80)), ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("assessment", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="ai_generations", to="core.assessment")),
                ("submission", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="ai_generations", to="core.submission")),
            ], options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="ContactMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)), ("email", models.EmailField(max_length=254)),
                ("subject", models.CharField(max_length=160)), ("message", models.TextField(max_length=4000)),
                ("status", models.CharField(choices=[("new", "Nuevo"), ("handled", "Atendido"), ("spam", "Spam")], default="new", max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
            ], options={"ordering": ["-created_at"]},
        ),
        migrations.AlterField(model_name="question", name="position", field=models.PositiveIntegerField(default=1)),
        migrations.AlterField(model_name="rubriccriterion", name="position", field=models.PositiveIntegerField(default=1)),
        migrations.RunPython(normalize_existing_positions, reverse_normalize),
        migrations.AddConstraint(model_name="course", constraint=models.UniqueConstraint(fields=("owner_id", "name"), name="uniq_course_name_per_owner")),
        migrations.AddIndex(model_name="course", index=models.Index(fields=["owner_id", "active"], name="course_owner_active_idx")),
        migrations.AddIndex(model_name="student", index=models.Index(fields=["owner_id", "active"], name="student_owner_active_idx")),
        migrations.AddConstraint(model_name="enrollment", constraint=models.UniqueConstraint(fields=("course", "student"), name="uniq_enrollment_course_student")),
        migrations.AddIndex(model_name="enrollment", index=models.Index(fields=["owner_id", "course", "status"], name="enroll_owner_course_status_idx")),
        migrations.AddConstraint(model_name="rubriccriterion", constraint=models.UniqueConstraint(fields=("rubric", "position"), name="uniq_criterion_position_per_rubric")),
        migrations.AddConstraint(model_name="rubriccriterion", constraint=models.CheckConstraint(condition=Q(max_score__gt=0) & Q(max_score__lte=1000), name="criterion_score_range")),
        migrations.AddConstraint(model_name="rubriccriterion", constraint=models.CheckConstraint(condition=Q(weight__gte=0) & Q(weight__lte=100), name="criterion_weight_range")),
        migrations.AddConstraint(model_name="rubriclevel", constraint=models.UniqueConstraint(fields=("criterion", "position"), name="uniq_rubric_level_position")),
        migrations.AddConstraint(model_name="rubriclevel", constraint=models.CheckConstraint(condition=Q(("score__gte", 0)), name="rubric_level_score_nonnegative")),
        migrations.AddConstraint(model_name="question", constraint=models.UniqueConstraint(fields=("assessment", "position"), name="uniq_question_position_per_assessment")),
        migrations.AddConstraint(model_name="question", constraint=models.CheckConstraint(condition=Q(max_score__gt=0) & Q(max_score__lte=1000), name="question_score_range")),
        migrations.AddIndex(model_name="assessment", index=models.Index(fields=["owner_id", "status"], name="assessment_owner_status_idx")),
        migrations.AddIndex(model_name="submission", index=models.Index(fields=["owner_id", "status"], name="submission_owner_status_idx")),
        migrations.AddConstraint(model_name="submissionanswer", constraint=models.UniqueConstraint(fields=("submission", "question"), name="uniq_submission_question_answer")),
        migrations.AddConstraint(model_name="correctioncriterionresult", constraint=models.UniqueConstraint(fields=("correction", "position"), name="uniq_criterion_result_position")),
        migrations.AddConstraint(model_name="correctioncriterionresult", constraint=models.CheckConstraint(condition=Q(score__gte=0) & Q(max_score__gte=0) & Q(score__lte=models.F("max_score")), name="criterion_result_score_range")),
        migrations.AddIndex(model_name="correctioncriterionresult", index=models.Index(fields=["owner_id", "criterion_name"], name="criterion_result_owner_name_idx")),
        migrations.AddConstraint(model_name="correctionrevision", constraint=models.UniqueConstraint(fields=("correction", "revision_number"), name="uniq_correction_revision_number")),
        migrations.AddIndex(model_name="aigeneration", index=models.Index(fields=["owner_id", "task", "created_at"], name="ai_generation_owner_task_idx")),
        migrations.AddIndex(model_name="correction", index=models.Index(fields=["owner_id", "status"], name="correction_owner_status_idx")),
        migrations.AddConstraint(model_name="correction", constraint=models.CheckConstraint(condition=Q(total_score__gte=0), name="correction_total_nonnegative")),
        migrations.AddConstraint(model_name="enrollment", constraint=models.CheckConstraint(condition=Q(status__in=["active", "inactive"]), name="enrollment_status_valid")),
        migrations.AddConstraint(model_name="rubric", constraint=models.CheckConstraint(condition=Q(scale_type__in=["numeric", "levels", "both"]), name="rubric_scale_type_valid")),
        migrations.AddConstraint(model_name="assessment", constraint=models.CheckConstraint(condition=Q(status__in=["draft", "ready", "archived"]), name="assessment_status_valid")),
        migrations.AddConstraint(model_name="question", constraint=models.CheckConstraint(condition=Q(question_type__in=["open", "short", "case"]), name="question_type_valid")),
        migrations.AddConstraint(model_name="submission", constraint=models.CheckConstraint(condition=Q(status__in=["pending", "processing", "review", "approved"]), name="submission_status_valid")),
        migrations.AddConstraint(model_name="submission", constraint=models.CheckConstraint(condition=Q(source_type__in=["text", "txt", "pdf", "docx"]), name="submission_source_type_valid")),
        migrations.AddConstraint(model_name="correction", constraint=models.CheckConstraint(condition=Q(status__in=["pending_review", "approved", "rejected"]), name="correction_status_valid")),
        migrations.AddConstraint(model_name="aigeneration", constraint=models.CheckConstraint(condition=Q(status__in=["succeeded", "failed"]), name="ai_generation_status_valid")),
        migrations.AddConstraint(model_name="contactmessage", constraint=models.CheckConstraint(condition=Q(status__in=["new", "handled", "spam"]), name="contact_status_valid")),
        migrations.AddConstraint(model_name="contactmessage", constraint=models.CheckConstraint(condition=Q(message__length__lte=4000), name="contact_message_max_length")),
    ]
