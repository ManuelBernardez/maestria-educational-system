"""Read-only compatibility audit against the existing Supabase public schema."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

EXPECTED_TABLES = {
    "course": {"id", "owner_id", "created_at", "updated_at", "name", "subject", "level", "academic_year", "description", "active"},
    "student": {"id", "owner_id", "created_at", "updated_at", "name", "email", "phone", "external_code", "account_user_id", "active"},
    "rubric": {"id", "owner_id", "created_at", "updated_at", "title", "description", "scale_type"},
    "rubric_criterion": {"id", "owner_id", "created_at", "updated_at", "name", "description", "max_score", "weight", "position", "rubric_id"},
    "rubric_level": {"id", "owner_id", "created_at", "updated_at", "name", "description", "score", "position", "criterion_id"},
    "assessment": {"id", "owner_id", "created_at", "updated_at", "title", "subject", "level", "objectives", "instructions", "reference_material", "status", "course_id"},
    "question": {"id", "owner_id", "created_at", "updated_at", "prompt", "expected_answer", "question_type", "max_score", "position", "assessment_id", "rubric_id"},
    "enrollment": {"id", "owner_id", "created_at", "updated_at", "status", "enrolled_at", "notes", "course_id", "student_id"},
    "submission": {"id", "owner_id", "created_at", "updated_at", "student_name", "answer_text", "source_type", "source_filename", "status", "assessment_id", "question_id", "student_id"},
    "submission_answer": {"id", "owner_id", "created_at", "updated_at", "answer_text", "source_filename", "submission_id", "question_id"},
    "correction": {"id", "owner_id", "created_at", "updated_at", "provider", "proposal", "final_result", "teacher_feedback", "total_score", "status", "approved_at", "rubric_id", "submission_id"},
    "correction_criterion_result": {"id", "owner_id", "created_at", "updated_at", "criterion_name", "score", "max_score", "evidence", "justification", "feedback", "position", "correction_id", "question_id"},
    "correction_revision": {"id", "owner_id", "correction_id", "revision_number", "previous_result", "new_result", "reason", "created_at"},
    "ai_generation": {"id", "owner_id", "task", "provider", "model_name", "status", "duration_ms", "input_tokens", "output_tokens", "estimated_cost_usd", "prompt_fingerprint", "error_code", "created_at", "assessment_id", "submission_id"},
    "audit_event": {"id", "owner_id", "event_type", "object_type", "object_id", "detail", "created_at", "actor_user_id", "actor_role", "request_id", "ip_address", "user_agent"},
    "contact_message": {"id", "name", "email", "subject", "message", "status", "internal_notes", "assigned_to", "created_at", "updated_at", "user_id", "category", "source", "assigned_at", "handled_at", "metadata"},
    "user_profile": {"id", "user_id", "email", "full_name", "role", "status", "created_at", "updated_at", "role_updated_at", "role_updated_by", "suspended_at", "suspended_by", "suspension_reason"},
    "institution": {"id", "name", "slug", "contact_email", "status", "created_by", "created_at", "updated_at", "updated_by"},
    "institution_membership": {"id", "institution_id", "user_id", "role", "status", "invited_by", "created_at", "updated_at", "updated_by"},
    "ai_provider_config": {"id", "provider", "model_name", "enabled", "priority", "timeout_seconds", "input_usd_per_1k_tokens", "output_usd_per_1k_tokens", "updated_by", "updated_at"},
}

# Each tuple: constraint name, child table, child columns, parent table, parent columns.
COMPOSITE_FKS = [
    ("fk_rc_rubric_owner", "rubric_criterion", ("rubric_id", "owner_id"), "rubric", ("id", "owner_id")),
    ("fk_rl_criterion_owner", "rubric_level", ("criterion_id", "owner_id"), "rubric_criterion", ("id", "owner_id")),
    ("fk_assessment_course_owner", "assessment", ("course_id", "owner_id"), "course", ("id", "owner_id")),
    ("fk_question_assessment_owner", "question", ("assessment_id", "owner_id"), "assessment", ("id", "owner_id")),
    ("fk_question_rubric_owner", "question", ("rubric_id", "owner_id"), "rubric", ("id", "owner_id")),
    ("fk_enrollment_course_owner", "enrollment", ("course_id", "owner_id"), "course", ("id", "owner_id")),
    ("fk_enrollment_student_owner", "enrollment", ("student_id", "owner_id"), "student", ("id", "owner_id")),
    ("fk_submission_assessment_owner", "submission", ("assessment_id", "owner_id"), "assessment", ("id", "owner_id")),
    ("fk_submission_question_owner", "submission", ("question_id", "owner_id"), "question", ("id", "owner_id")),
    ("fk_submission_student_owner", "submission", ("student_id", "owner_id"), "student", ("id", "owner_id")),
    ("fk_answer_submission_owner", "submission_answer", ("submission_id", "owner_id"), "submission", ("id", "owner_id")),
    ("fk_answer_question_owner", "submission_answer", ("question_id", "owner_id"), "question", ("id", "owner_id")),
    ("fk_correction_submission_owner", "correction", ("submission_id", "owner_id"), "submission", ("id", "owner_id")),
    ("fk_correction_rubric_owner", "correction", ("rubric_id", "owner_id"), "rubric", ("id", "owner_id")),
    ("fk_result_correction_owner", "correction_criterion_result", ("correction_id", "owner_id"), "correction", ("id", "owner_id")),
    ("fk_result_question_owner", "correction_criterion_result", ("question_id", "owner_id"), "question", ("id", "owner_id")),
    ("fk_revision_correction_owner", "correction_revision", ("correction_id", "owner_id"), "correction", ("id", "owner_id")),
    ("fk_ai_assessment_owner", "ai_generation", ("assessment_id", "owner_id"), "assessment", ("id", "owner_id")),
    ("fk_ai_submission_owner", "ai_generation", ("submission_id", "owner_id"), "submission", ("id", "owner_id")),
]

REQUIRED_UNIQUE_INDEXES = {
    "uq_course_id_owner": ("course", "(id,owner_id)"),
    "uq_student_id_owner": ("student", "(id,owner_id)"),
    "uq_rubric_id_owner": ("rubric", "(id,owner_id)"),
    "uq_rubric_criterion_id_owner": ("rubric_criterion", "(id,owner_id)"),
    "uq_assessment_id_owner": ("assessment", "(id,owner_id)"),
    "uq_question_id_owner": ("question", "(id,owner_id)"),
    "uq_submission_id_owner": ("submission", "(id,owner_id)"),
    "uq_correction_id_owner": ("correction", "(id,owner_id)"),
    "uq_user_profile_email_ci": ("user_profile", "lower(btrim(email))"),
    "uq_institution_membership_user": ("institution_membership", "(institution_id,user_id)"),
    "user_profile_user_id_key": ("user_profile", "(user_id)"),
    "institution_slug_key": ("institution", "(slug)"),
    "ai_provider_config_provider_key": ("ai_provider_config", "(provider)"),
    # Reglas de negocio que la API traduce a 409 (apps/core/exceptions.py, AUD-003/AUD-004).
    "uniq_course_owner_name_ci": ("course", "owner_id"),
    "uniq_enrollment_course_student": ("enrollment", "(course_id,student_id)"),
    "uniq_student_external_code_per_owner": ("student", "(owner_id,external_code)"),
    "uniq_question_position_per_assessment": ("question", "(assessment_id,\"position\")"),
    "uniq_criterion_position_per_rubric": ("rubric_criterion", "(rubric_id,\"position\")"),
    "uniq_rubric_level_position": ("rubric_level", "(criterion_id,\"position\")"),
    "uniq_submission_question_answer": ("submission_answer", "(submission_id,question_id)"),
    "uniq_approved_correction_per_submission": ("correction", "approved"),
    "uniq_pending_correction_per_submission": ("correction", "pending_review"),
    "uniq_criterion_result_position": ("correction_criterion_result", "(correction_id,\"position\")"),
    "uniq_correction_revision_number": ("correction_revision", "(correction_id,revision_number)"),
    "uniq_enabled_ai_provider": ("ai_provider_config", "(enabled)"),
}

REQUIRED_INDEXES = {
    "ix_rc_rubric_owner": ("rubric_criterion", "(rubric_id,owner_id)"),
    "ix_rl_criterion_owner": ("rubric_level", "(criterion_id,owner_id)"),
    "ix_assessment_course_owner": ("assessment", "(course_id,owner_id)"),
    "ix_question_assessment_owner": ("question", "(assessment_id,owner_id)"),
    "ix_question_rubric_owner": ("question", "(rubric_id,owner_id)"),
    "ix_enrollment_course_owner": ("enrollment", "(course_id,owner_id)"),
    "ix_enrollment_student_owner": ("enrollment", "(student_id,owner_id)"),
    "ix_submission_assessment_owner": ("submission", "(assessment_id,owner_id)"),
    "ix_submission_question_owner": ("submission", "(question_id,owner_id)"),
    "ix_submission_student_owner": ("submission", "(student_id,owner_id)"),
    "ix_answer_submission_owner": ("submission_answer", "(submission_id,owner_id)"),
    "ix_answer_question_owner": ("submission_answer", "(question_id,owner_id)"),
    "ix_correction_submission_owner": ("correction", "(submission_id,owner_id)"),
    "ix_correction_rubric_owner": ("correction", "(rubric_id,owner_id)"),
    "ix_result_correction_owner": ("correction_criterion_result", "(correction_id,owner_id)"),
    "ix_result_question_owner": ("correction_criterion_result", "(question_id,owner_id)"),
    "ix_revision_correction_owner": ("correction_revision", "(correction_id,owner_id)"),
    "ix_ai_assessment_owner": ("ai_generation", "(assessment_id,owner_id)"),
    "ix_ai_submission_owner": ("ai_generation", "(submission_id,owner_id)"),
    "ix_user_profile_role_status": ("user_profile", "(role,status,created_atdesc)"),
    "ix_user_profile_status_updated": ("user_profile", "(status,updated_atdesc)"),
    "ix_institution_membership_user_status": ("institution_membership", "(user_id,status)"),
    "ix_institution_membership_institution_status": ("institution_membership", "(institution_id,status,role)"),
    "ix_institution_status_created": ("institution", "(status,created_atdesc)"),
    "ix_audit_event_actor_created": ("audit_event", "(actor_user_id,created_atdesc)"),
    "ix_audit_event_object_created": ("audit_event", "(object_type,object_id,created_atdesc)"),
    "ix_audit_event_type_created": ("audit_event", "(event_type,created_atdesc)"),
    "ix_contact_message_inbox": ("contact_message", "(status,created_atdesc)"),
    "ix_contact_message_assignee": ("contact_message", "(assigned_to,status,updated_atdesc)"),
    "ix_contact_message_email_created": ("contact_message", "(lower(email),created_atdesc)"),
    "ix_contact_message_category_created": ("contact_message", "(category,created_atdesc)"),
    "ix_ai_provider_config_enabled_priority": ("ai_provider_config", "(enabled,priority)"),
}

REQUIRED_TRIGGERS = {
    "trg_user_profile_guard_last_superadmin": ("user_profile", "maestria_guard_last_superadmin"),
    "trg_contact_message_admin_workflow": ("contact_message", "maestria_contact_message_admin_workflow"),
}

# PostgreSQL internal types for the identity, ownership, relation, JSON and temporal
# columns whose compatibility is critical to the ORM mapping.
EXPECTED_UDT = {
    (table, "id"): "int8" for table in EXPECTED_TABLES
}
EXPECTED_UDT.update({
    (table, "owner_id"): "uuid" for table in (
        "course", "student", "rubric", "rubric_criterion", "rubric_level",
        "assessment", "question", "enrollment", "submission",
        "submission_answer", "correction", "correction_criterion_result",
        "correction_revision", "ai_generation", "audit_event",
    )
})
EXPECTED_UDT.update({
    ("student", "account_user_id"): "uuid",
    ("rubric_criterion", "rubric_id"): "int8",
    ("rubric_level", "criterion_id"): "int8",
    ("assessment", "course_id"): "int8",
    ("question", "assessment_id"): "int8", ("question", "rubric_id"): "int8",
    ("enrollment", "course_id"): "int8", ("enrollment", "student_id"): "int8",
    ("submission", "assessment_id"): "int8", ("submission", "question_id"): "int8", ("submission", "student_id"): "int8",
    ("submission_answer", "submission_id"): "int8", ("submission_answer", "question_id"): "int8",
    ("correction", "rubric_id"): "int8", ("correction", "submission_id"): "int8",
    ("correction_criterion_result", "correction_id"): "int8", ("correction_criterion_result", "question_id"): "int8",
    ("correction_revision", "correction_id"): "int8",
    ("ai_generation", "assessment_id"): "int8", ("ai_generation", "submission_id"): "int8",
    ("contact_message", "assigned_to"): "uuid", ("contact_message", "user_id"): "uuid",
    ("user_profile", "user_id"): "uuid", ("user_profile", "role_updated_by"): "uuid",
    ("user_profile", "suspended_by"): "uuid",
    ("institution", "created_by"): "uuid", ("institution", "updated_by"): "uuid",
    ("institution_membership", "institution_id"): "int8", ("institution_membership", "user_id"): "uuid",
    ("institution_membership", "invited_by"): "uuid", ("institution_membership", "updated_by"): "uuid",
    ("ai_provider_config", "updated_by"): "uuid",
    ("correction", "proposal"): "jsonb", ("correction", "final_result"): "jsonb",
    ("correction_revision", "previous_result"): "jsonb", ("correction_revision", "new_result"): "jsonb",
    ("audit_event", "detail"): "jsonb", ("contact_message", "metadata"): "jsonb",
    ("audit_event", "ip_address"): "inet",
    ("course", "active"): "bool", ("student", "active"): "bool",
    ("ai_provider_config", "enabled"): "bool",
    ("rubric_criterion", "max_score"): "numeric", ("rubric_criterion", "weight"): "numeric",
    ("rubric_level", "score"): "numeric", ("question", "max_score"): "numeric",
    ("correction", "total_score"): "numeric",
    ("correction_criterion_result", "score"): "numeric", ("correction_criterion_result", "max_score"): "numeric",
    ("ai_provider_config", "input_usd_per_1k_tokens"): "numeric",
    ("ai_provider_config", "output_usd_per_1k_tokens"): "numeric",
    ("ai_generation", "estimated_cost_usd"): "numeric",
    ("ai_provider_config", "priority"): "int2", ("ai_provider_config", "timeout_seconds"): "int2",
})


class Command(BaseCommand):
    help = "Compara el esquema PostgreSQL existente con el contrato ORM de MaestrIA (solo lectura)."

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            raise CommandError("Este verificador requiere PostgreSQL; no modifica la base de datos.")
        errors, warnings = [], []
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(), current_schema(), current_setting('search_path')")
            db_name, schema_name, search_path = cursor.fetchone()
            self.stdout.write(f"Base: {db_name} | esquema actual: {schema_name} | search_path: {search_path}")

            cursor.execute("SELECT table_name, column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_schema='public'")
            columns = {}
            for table, column, data_type, udt_name, nullable in cursor.fetchall():
                columns.setdefault(table, {})[column] = (data_type, udt_name, nullable)

            for table, expected in EXPECTED_TABLES.items():
                if table not in columns:
                    errors.append(f"No existe public.{table}")
                    continue
                missing = expected - set(columns[table])
                if missing:
                    errors.append(f"public.{table}: faltan columnas {', '.join(sorted(missing))}")
                for (type_table, column), udt in EXPECTED_UDT.items():
                    if type_table != table or column not in columns[table]:
                        continue
                    actual_udt = columns[table][column][1]
                    if actual_udt != udt:
                        errors.append(f"public.{table}.{column}: tipo PostgreSQL esperado {udt}, encontrado {actual_udt}.")
                if "id" in columns[table] and columns[table]["id"][1] == "int8":
                    cursor.execute("SELECT is_identity FROM information_schema.columns WHERE table_schema='public' AND table_name=%s AND column_name='id'", [table])
                    identity = cursor.fetchone()[0]
                    if identity != "YES":
                        errors.append(f"public.{table}.id debe ser BIGINT GENERATED ALWAYS/ BY DEFAULT AS IDENTITY.")

            if schema_name != "public" or "public" not in search_path.split(",") and "public" not in search_path:
                warnings.append("La conexión no muestra public como esquema actual/search_path; revisar OPTIONS -c search_path=public.")

            # pg_catalog en lugar de to_regclass('auth.users'): to_regclass exige USAGE sobre el
            # esquema auth, que el rol de mínimo privilegio maestria_app no tiene (AUD-006).
            cursor.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_catalog.pg_class c
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'auth' AND c.relname = 'users'
                )
            """)
            if not cursor.fetchone()[0]:
                errors.append("No se encuentra auth.users; Supabase Auth debe existir.")

            cursor.execute("""
                SELECT c.conname, c.conrelid::regclass::text, c.confrelid::regclass::text,
                       pg_get_constraintdef(c.oid, true)
                FROM pg_constraint c
                WHERE c.contype='f' AND c.connamespace='public'::regnamespace
            """)
            constraint_rows = cursor.fetchall()
            constraints = {row[0]: row[1:] for row in constraint_rows}
            fks_by_pair = {}
            for fk_name, fk_child, fk_parent, fk_definition in constraint_rows:
                pair = (fk_child.split(".")[-1].strip('"'), fk_parent.split(".")[-1].strip('"'))
                fks_by_pair.setdefault(pair, []).append((fk_name, fk_definition))
            for name, child, child_cols, parent, parent_cols in COMPOSITE_FKS:
                item = constraints.get(name)
                expected_def = f"FOREIGN KEY ({', '.join(child_cols)}) REFERENCES {parent}({', '.join(parent_cols)})"
                if not item:
                    errors.append(f"Falta FK compuesta {name} ({child} → {parent}).")
                    continue
                actual_child, actual_parent, definition = item
                normalized = " ".join(definition.lower().replace('public.', '').split())
                expected = " ".join(expected_def.lower().split())
                pair = (child, parent)
                pair_constraints = fks_by_pair.get(pair, [])
                if actual_child.split(".")[-1].strip('"') != child or actual_parent.split(".")[-1].strip('"') != parent or not normalized.startswith(expected):
                    errors.append(f"FK {name} no coincide: {definition}")
                if [constraint_name for constraint_name, _ in pair_constraints] != [name]:
                    errors.append(f"La relación {child} → {parent} debe tener únicamente la FK compuesta {name}; encontradas: {[entry[0] for entry in pair_constraints]}")

            cursor.execute("SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname='public'")
            indexes = {name: (table, definition) for name, table, definition in cursor.fetchall()}
            for index, (table, expression) in REQUIRED_UNIQUE_INDEXES.items():
                item = indexes.get(index)
                if not item:
                    errors.append(f"Falta índice único {index} en public.{table}.")
                    continue
                actual_table, definition = item
                compact = "".join(definition.lower().split())
                expected_expression = "".join(expression.lower().split())
                expression_matches = expected_expression in compact
                if index == "uq_user_profile_email_ci":
                    # PostgreSQL may render implicit varchar->text casts inside
                    # pg_indexes.indexdef. Verify the semantic expression tokens.
                    expression_matches = all(token in compact for token in ("lower(", "btrim(", "email"))
                if actual_table != table or "uniqueindex" not in compact or not expression_matches:
                    errors.append(f"Índice {index} no garantiza UNIQUE {expression}: {definition}")

            for index, (table, expression) in REQUIRED_INDEXES.items():
                item = indexes.get(index)
                if not item:
                    errors.append(f"Falta índice {index} en public.{table}.")
                    continue
                actual_table, definition = item
                compact = "".join(definition.lower().split())
                expected_expression = "".join(expression.lower().split())
                expression_matches = expected_expression in compact
                if index == "ix_contact_message_email_created":
                    expression_matches = "lower(" in compact and "email" in compact and "created_atdesc" in compact
                if actual_table != table or not expression_matches:
                    errors.append(f"Índice {index} no coincide con {expression}: {definition}")

            cursor.execute("""
                SELECT t.tgname, c.relname, p.proname
                FROM pg_trigger t
                JOIN pg_class c ON c.oid=t.tgrelid
                JOIN pg_namespace n ON n.oid=c.relnamespace
                JOIN pg_proc p ON p.oid=t.tgfoid
                WHERE n.nspname='public' AND NOT t.tgisinternal
            """)
            triggers = {name: (table, function) for name, table, function in cursor.fetchall()}
            for trigger, expected in REQUIRED_TRIGGERS.items():
                if triggers.get(trigger) != expected:
                    errors.append(f"Falta el trigger {trigger} en public.{expected[0]} o no ejecuta {expected[1]}.")

            cursor.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'core_%' ORDER BY tablename")
            legacy = [r[0] for r in cursor.fetchall()]
            if legacy:
                warnings.append("Se detectaron tablas legacy core_*: " + ", ".join(legacy[:20]))

            cursor.execute("SELECT to_regclass('public.django_migrations')")
            if cursor.fetchone()[0]:
                cursor.execute("SELECT count(*) FROM public.django_migrations WHERE app='core'")
                applied = cursor.fetchone()[0]
                if applied:
                    warnings.append(f"django_migrations conserva {applied} filas históricas para app=core; no ejecutar la antigua cadena contra este esquema.")

        for warning in warnings:
            self.stdout.write(self.style.WARNING("AVISO: " + warning))
        if errors:
            for error in errors:
                self.stderr.write(self.style.ERROR("ERROR: " + error))
            raise CommandError(f"Esquema incompatible: {len(errors)} error(es), {len(warnings)} aviso(s).")
        self.stdout.write(self.style.SUCCESS(
            f"Esquema compatible: {len(EXPECTED_TABLES)} tablas, {len(COMPOSITE_FKS)} FK compuestas, "
            f"{len(REQUIRED_UNIQUE_INDEXES)} índices únicos, {len(REQUIRED_INDEXES)} índices operativos "
            f"y {len(REQUIRED_TRIGGERS)} triggers verificados."
        ))
