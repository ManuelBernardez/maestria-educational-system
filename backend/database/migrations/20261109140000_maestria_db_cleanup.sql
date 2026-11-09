-- Migration 20261109140000 / maestria_db_cleanup
-- Limpieza detectada por los advisors de Supabase (2026-11-09).
-- No borra ni reescribe datos de tablas. Todo corre en una sola transacción.
--
-- 1. Índices duplicados (lint 0009_duplicate_index)
-- 2. FK sin índice de cobertura (lint 0001_unindexed_foreign_keys)
-- 3. audit_event: la política pasa de ALL a solo SELECT
--
-- Después de aplicarla: `python manage.py verify_public_schema` debe pasar.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1a. Pares UNIQUE (id, owner_id)
--
-- maestria_schema_v2.sql creó la CONSTRAINT uniq_*_id_owner, y las FK
-- compuestas (fk_*_owner) dependen de su índice. Luego
-- maestria_schema_v2_contract_alignment.sql agregó un índice suelto
-- uq_*_id_owner idéntico, que es el nombre que exige verify_public_schema.
--
-- Solución sin tocar las FK: se borra el índice suelto uq_* y se renombra la
-- constraint uniq_* a uq_* (renombrar la constraint renombra su índice).
-- Resultado: un solo índice, con el nombre del contrato, que sigue
-- respaldando las FK.
-- ---------------------------------------------------------------------------

DROP INDEX public.uq_course_id_owner;
ALTER TABLE public.course RENAME CONSTRAINT uniq_course_id_owner TO uq_course_id_owner;

DROP INDEX public.uq_student_id_owner;
ALTER TABLE public.student RENAME CONSTRAINT uniq_student_id_owner TO uq_student_id_owner;

DROP INDEX public.uq_rubric_id_owner;
ALTER TABLE public.rubric RENAME CONSTRAINT uniq_rubric_id_owner TO uq_rubric_id_owner;

DROP INDEX public.uq_rubric_criterion_id_owner;
ALTER TABLE public.rubric_criterion RENAME CONSTRAINT uniq_rubriccriterion_id_owner TO uq_rubric_criterion_id_owner;

DROP INDEX public.uq_assessment_id_owner;
ALTER TABLE public.assessment RENAME CONSTRAINT uniq_assessment_id_owner TO uq_assessment_id_owner;

DROP INDEX public.uq_question_id_owner;
ALTER TABLE public.question RENAME CONSTRAINT uniq_question_id_owner TO uq_question_id_owner;

DROP INDEX public.uq_submission_id_owner;
ALTER TABLE public.submission RENAME CONSTRAINT uniq_submission_id_owner TO uq_submission_id_owner;

DROP INDEX public.uq_correction_id_owner;
ALTER TABLE public.correction RENAME CONSTRAINT uniq_correction_id_owner TO uq_correction_id_owner;

DROP INDEX public.uq_institution_membership_user;
ALTER TABLE public.institution_membership RENAME CONSTRAINT uniq_institution_member TO uq_institution_membership_user;

-- ---------------------------------------------------------------------------
-- 1b. Índices comunes duplicados: se conserva el nombre ix_* del contrato y
-- se borra el original de maestria_schema_v2.sql. Ninguna constraint los usa.
-- ---------------------------------------------------------------------------

DROP INDEX public.ai_provider_enabled_priority_idx;   -- queda ix_ai_provider_config_enabled_priority
DROP INDEX public.contact_status_created_idx;         -- queda ix_contact_message_inbox
DROP INDEX public.inst_member_user_status_idx;        -- queda ix_institution_membership_user_status

-- ---------------------------------------------------------------------------
-- 2. Índices para FK hacia auth.users sin cobertura. Evitan recorrer la tabla
-- entera en ON DELETE SET NULL cuando se borra un usuario de Auth.
-- Tablas chicas: CREATE INDEX normal (sin CONCURRENTLY) dentro de la transacción.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_ai_provider_config_updated_by         ON public.ai_provider_config (updated_by);
CREATE INDEX IF NOT EXISTS ix_contact_message_user                  ON public.contact_message (user_id);
CREATE INDEX IF NOT EXISTS ix_institution_created_by                ON public.institution (created_by);
CREATE INDEX IF NOT EXISTS ix_institution_updated_by                ON public.institution (updated_by);
CREATE INDEX IF NOT EXISTS ix_institution_membership_invited_by     ON public.institution_membership (invited_by);
CREATE INDEX IF NOT EXISTS ix_institution_membership_updated_by     ON public.institution_membership (updated_by);
CREATE INDEX IF NOT EXISTS ix_user_profile_role_updated_by          ON public.user_profile (role_updated_by);
CREATE INDEX IF NOT EXISTS ix_user_profile_suspended_by             ON public.user_profile (suspended_by);

-- ---------------------------------------------------------------------------
-- 3. audit_event es un registro de solo agregado. La política ALL permitiría a
-- un dueño modificar o borrar su propia auditoría si algún día se otorgan
-- GRANTs a authenticated. Hoy no hay GRANTs y Django escribe con su propio rol,
-- así que el cambio no altera el comportamiento actual.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS audit_event_owner_isolation ON public.audit_event;
CREATE POLICY audit_event_owner_read ON public.audit_event
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id);

COMMIT;
