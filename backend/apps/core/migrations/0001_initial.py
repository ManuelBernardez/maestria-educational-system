import django.db.models.deletion
from decimal import Decimal
from django.db import migrations, models

class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name='Assessment',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('owner_id', models.UUIDField(db_index=True, editable=False)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)), ('title', models.CharField(max_length=180)), ('subject', models.CharField(blank=True, max_length=120)), ('level', models.CharField(blank=True, max_length=120)), ('objectives', models.TextField(blank=True)), ('instructions', models.TextField(blank=True)), ('status', models.CharField(choices=[('draft', 'Borrador'), ('ready', 'Lista'), ('archived', 'Archivada')], default='draft', max_length=24))],
        ),
        migrations.CreateModel(
            name='Rubric',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('owner_id', models.UUIDField(db_index=True, editable=False)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)), ('title', models.CharField(max_length=180)), ('description', models.TextField(blank=True))],
        ),
        migrations.CreateModel(
            name='Student',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('owner_id', models.UUIDField(db_index=True, editable=False)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)), ('name', models.CharField(max_length=180)), ('email', models.EmailField(blank=True, max_length=254)), ('phone', models.CharField(blank=True, max_length=32)), ('external_code', models.CharField(blank=True, max_length=80)), ('active', models.BooleanField(default=True))],
            options={'ordering': ['name']},
        ),
        migrations.CreateModel(
            name='Question',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('owner_id', models.UUIDField(db_index=True, editable=False)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)), ('prompt', models.TextField()), ('max_score', models.DecimalField(decimal_places=2, default=Decimal('10'), max_digits=7)), ('position', models.PositiveIntegerField(default=1)), ('assessment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='questions', to='core.assessment'))],
        ),
        migrations.CreateModel(
            name='RubricCriterion',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('owner_id', models.UUIDField(db_index=True, editable=False)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)), ('name', models.CharField(max_length=160)), ('description', models.TextField(blank=True)), ('max_score', models.DecimalField(decimal_places=2, default=Decimal('10'), max_digits=7)), ('weight', models.DecimalField(decimal_places=3, default=Decimal('1'), max_digits=6)), ('position', models.PositiveIntegerField(default=1)), ('rubric', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='criteria', to='core.rubric'))],
        ),
        migrations.CreateModel(
            name='Submission',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('owner_id', models.UUIDField(db_index=True, editable=False)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)), ('student_name', models.CharField(blank=True, max_length=180)), ('answer_text', models.TextField()), ('status', models.CharField(choices=[('pending', 'Pendiente'), ('processing', 'Procesando'), ('review', 'A revisar'), ('approved', 'Aprobada')], default='pending', max_length=24)), ('assessment', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='submissions', to='core.assessment')), ('question', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='submissions', to='core.question')), ('student', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='submissions', to='core.student'))],
        ),
        migrations.CreateModel(
            name='Correction',
            fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('owner_id', models.UUIDField(db_index=True, editable=False)), ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)), ('provider', models.CharField(default='mock', max_length=32)), ('proposal', models.JSONField(default=dict)), ('final_result', models.JSONField(blank=True, default=dict)), ('teacher_feedback', models.TextField(blank=True)), ('total_score', models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=8)), ('status', models.CharField(choices=[('pending_review', 'Pendiente de revisión'), ('approved', 'Aprobada'), ('rejected', 'Rechazada')], default='pending_review', max_length=24)), ('approved_at', models.DateTimeField(blank=True, null=True)), ('rubric', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='corrections', to='core.rubric')), ('submission', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='corrections', to='core.submission'))],
        ),
        migrations.AddConstraint(model_name='student', constraint=models.UniqueConstraint(condition=~models.Q(('external_code', '')), fields=('owner_id', 'external_code'), name='uniq_student_external_code_per_owner')),
    ]
