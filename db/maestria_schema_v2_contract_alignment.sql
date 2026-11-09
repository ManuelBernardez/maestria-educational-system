-- ⚠ HISTÓRICO (2026-11-09): para instalaciones nuevas usar db/maestria_schema.sql.
--   Se conserva porque documenta cómo se llegó al esquema actual y porque es la
--   instalación sobre Postgres plano de docs/PRUEBAS-LOCALES.md (opción B).
--
-- MaestrIA — alineación del esquema con el contrato que verifica el backend.
--
-- Qué resuelve: `db/maestria_schema_v2.sql` quedó desactualizado respecto de
-- `backend/apps/core/models.py` y de `manage.py verify_public_schema`
-- (faltaban columnas de auditoría/administración, índices operativos, triggers
-- administrativos y nombres de FK compuestas). Una instalación limpia hecha sólo
-- con v2 fallaba la verificación con 68 errores y el backend devolvía 500 en
-- contacto, auditoría y administración.
--
-- Uso:
--   * Instalación limpia: ejecutar `maestria_schema_v2.sql` y luego este archivo.
--   * Base existente: revisar primero con `python manage.py verify_public_schema`.
--     El script es idempotente (IF NOT EXISTS / comprobaciones previas): sólo agrega
--     lo que falta. Hacer backup y aplicarlo en una ventana controlada.
--
-- Efectos sobre datos: no elimina filas ni columnas. Las únicas escrituras son
--   (a) acotar `ai_provider_config.timeout_seconds` al rango 5..85 que acepta el
--       adaptador de IA (valores mayores a 85 pasan a 85; menores a 5 pasan a 5);
-- Las FK simples heredadas se eliminan sólo cuando existe la FK compuesta
-- equivalente, que conserva el mismo comportamiento ON DELETE.
-- `uq_user_profile_email_ci` fallará si existen perfiles con el mismo correo
-- (sin distinguir mayúsculas): en ese caso, resolver los duplicados primero.

BEGIN;

-- 1. Columnas esperadas por los modelos ------------------------------------
ALTER TABLE public.audit_event
  ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_role varchar(24),
  ADD COLUMN IF NOT EXISTS request_id varchar(128),
  ADD COLUMN IF NOT EXISTS ip_address inet,
  ADD COLUMN IF NOT EXISTS user_agent text;

ALTER TABLE public.contact_message
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category varchar(80) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS source varchar(80) NOT NULL DEFAULT 'public_web',
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS handled_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS role_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS role_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason text NOT NULL DEFAULT '';

ALTER TABLE public.institution
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.institution_membership
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_event_actor_role_valid'
                 AND conrelid = 'public.audit_event'::regclass) THEN
    ALTER TABLE public.audit_event ADD CONSTRAINT audit_event_actor_role_valid
      CHECK (actor_role IS NULL OR actor_role IN ('teacher','student','admin','superadmin','system'));
  END IF;
END $$;

-- 2. Índices únicos (id, owner_id) usados por las FK compuestas --------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_id_owner ON public.course(id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_id_owner ON public.student(id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rubric_id_owner ON public.rubric(id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rubric_criterion_id_owner ON public.rubric_criterion(id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_id_owner ON public.assessment(id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_question_id_owner ON public.question(id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_submission_id_owner ON public.submission(id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_correction_id_owner ON public.correction(id, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profile_email_ci ON public.user_profile(lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_membership_user ON public.institution_membership(institution_id, user_id);

-- 3. FK compuestas: nombres canónicos y sin FK simples redundantes -----------
DO $$
DECLARE
  renames text[][] := ARRAY[
    ['rubric_criterion', 'fk_criterion_rubric_owner', 'fk_rc_rubric_owner'],
    ['rubric_level',     'fk_level_criterion_owner',  'fk_rl_criterion_owner']
  ];
  legacy text[][] := ARRAY[
    -- tabla, FK simple heredada, FK compuesta que la reemplaza
    ['rubric_criterion',            'rubric_criterion_rubric_fk',        'fk_rc_rubric_owner'],
    ['rubric_level',                'rubric_level_criterion_fk',         'fk_rl_criterion_owner'],
    ['assessment',                  'assessment_course_fk',              'fk_assessment_course_owner'],
    ['question',                    'question_assessment_fk',            'fk_question_assessment_owner'],
    ['question',                    'question_rubric_fk',                'fk_question_rubric_owner'],
    ['enrollment',                  'enrollment_course_fk',              'fk_enrollment_course_owner'],
    ['enrollment',                  'enrollment_student_fk',             'fk_enrollment_student_owner'],
    ['submission',                  'submission_assessment_fk',          'fk_submission_assessment_owner'],
    ['submission',                  'submission_question_fk',            'fk_submission_question_owner'],
    ['submission',                  'submission_student_fk',             'fk_submission_student_owner'],
    ['submission_answer',           'submission_answer_submission_fk',   'fk_answer_submission_owner'],
    ['submission_answer',           'submission_answer_question_fk',     'fk_answer_question_owner'],
    ['correction',                  'correction_submission_fk',          'fk_correction_submission_owner'],
    ['correction',                  'correction_rubric_fk',              'fk_correction_rubric_owner'],
    ['correction_criterion_result', 'result_correction_fk',              'fk_result_correction_owner'],
    ['correction_criterion_result', 'result_question_fk',                'fk_result_question_owner'],
    ['correction_revision',         'correction_revision_correction_fk', 'fk_revision_correction_owner'],
    ['ai_generation',               'ai_generation_assessment_fk',       'fk_ai_assessment_owner'],
    ['ai_generation',               'ai_generation_submission_fk',       'fk_ai_submission_owner']
  ];
  i int;
  rel regclass;
BEGIN
  FOR i IN 1 .. array_length(renames, 1) LOOP
    rel := format('public.%I', renames[i][1])::regclass;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = rel AND conname = renames[i][2])
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = rel AND conname = renames[i][3]) THEN
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', renames[i][1], renames[i][2], renames[i][3]);
    END IF;
  END LOOP;

  FOR i IN 1 .. array_length(legacy, 1) LOOP
    rel := format('public.%I', legacy[i][1])::regclass;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = rel AND conname = legacy[i][3] AND contype = 'f') THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', legacy[i][1], legacy[i][2]);
    ELSE
      RAISE WARNING 'No se elimina %.%: falta la FK compuesta %', legacy[i][1], legacy[i][2], legacy[i][3];
    END IF;
  END LOOP;
END $$;

-- 4. Índices operativos -----------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_rc_rubric_owner ON public.rubric_criterion(rubric_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_rl_criterion_owner ON public.rubric_level(criterion_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_assessment_course_owner ON public.assessment(course_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_question_assessment_owner ON public.question(assessment_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_question_rubric_owner ON public.question(rubric_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_enrollment_course_owner ON public.enrollment(course_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_enrollment_student_owner ON public.enrollment(student_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_submission_assessment_owner ON public.submission(assessment_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_submission_question_owner ON public.submission(question_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_submission_student_owner ON public.submission(student_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_answer_submission_owner ON public.submission_answer(submission_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_answer_question_owner ON public.submission_answer(question_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_correction_submission_owner ON public.correction(submission_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_correction_rubric_owner ON public.correction(rubric_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_result_correction_owner ON public.correction_criterion_result(correction_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_result_question_owner ON public.correction_criterion_result(question_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_revision_correction_owner ON public.correction_revision(correction_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_ai_assessment_owner ON public.ai_generation(assessment_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_ai_submission_owner ON public.ai_generation(submission_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_user_profile_role_status ON public.user_profile(role, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_user_profile_status_updated ON public.user_profile(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_institution_membership_user_status ON public.institution_membership(user_id, status);
CREATE INDEX IF NOT EXISTS ix_institution_membership_institution_status ON public.institution_membership(institution_id, status, role);
CREATE INDEX IF NOT EXISTS ix_institution_status_created ON public.institution(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_event_actor_created ON public.audit_event(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_event_object_created ON public.audit_event(object_type, object_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_event_type_created ON public.audit_event(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_contact_message_inbox ON public.contact_message(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_contact_message_assignee ON public.contact_message(assigned_to, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_contact_message_email_created ON public.contact_message(lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS ix_contact_message_category_created ON public.contact_message(category, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ai_provider_config_enabled_priority ON public.ai_provider_config(enabled, priority);

-- 5. Triggers administrativos -----------------------------------------------
CREATE OR REPLACE FUNCTION public.maestria_guard_last_superadmin()
RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE remaining integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'superadmin' AND OLD.status = 'active' THEN
      SELECT count(*) INTO remaining FROM public.user_profile
       WHERE role = 'superadmin' AND status = 'active' AND user_id <> OLD.user_id;
      IF remaining = 0 THEN
        RAISE EXCEPTION 'No se puede eliminar el último superadministrador activo.' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.role = 'superadmin' AND OLD.status = 'active' AND (NEW.role <> 'superadmin' OR NEW.status <> 'active') THEN
    SELECT count(*) INTO remaining FROM public.user_profile
     WHERE role = 'superadmin' AND status = 'active' AND user_id <> OLD.user_id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'No se puede degradar ni suspender al último superadministrador activo.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN NEW.role_updated_at := now(); END IF;
  IF OLD.role IN ('admin','superadmin') AND OLD.status = 'active'
     AND (NEW.role NOT IN ('admin','superadmin') OR NEW.status <> 'active') THEN
    UPDATE public.contact_message SET assigned_to = NULL WHERE assigned_to = OLD.user_id;
  END IF;
  IF NEW.status = 'suspended' THEN
    IF OLD.status IS DISTINCT FROM 'suspended' THEN NEW.suspended_at := now();
    ELSE NEW.suspended_at := coalesce(NEW.suspended_at, OLD.suspended_at, now()); END IF;
  ELSE
    NEW.suspended_at := NULL; NEW.suspended_by := NULL; NEW.suspension_reason := '';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_user_profile_guard_last_superadmin ON public.user_profile;
CREATE TRIGGER trg_user_profile_guard_last_superadmin
  BEFORE UPDATE OF role, status OR DELETE ON public.user_profile
  FOR EACH ROW EXECUTE FUNCTION public.maestria_guard_last_superadmin();

CREATE OR REPLACE FUNCTION public.maestria_contact_message_admin_workflow()
RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog, public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_profile up
        WHERE up.user_id = NEW.assigned_to AND up.role IN ('admin','superadmin') AND up.status = 'active') THEN
    RAISE EXCEPTION 'El responsable asignado debe ser un administrador activo.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL AND NEW.assigned_at IS NULL THEN NEW.assigned_at := now(); END IF;
    IF NEW.status = 'handled' AND NEW.handled_at IS NULL THEN NEW.handled_at := now(); END IF;
  ELSE
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      NEW.assigned_at := CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.handled_at := CASE WHEN NEW.status = 'handled' THEN now() ELSE NULL END;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contact_message_admin_workflow ON public.contact_message;
CREATE TRIGGER trg_contact_message_admin_workflow
  BEFORE INSERT OR UPDATE ON public.contact_message
  FOR EACH ROW EXECUTE FUNCTION public.maestria_contact_message_admin_workflow();

REVOKE EXECUTE ON FUNCTION public.maestria_guard_last_superadmin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.maestria_contact_message_admin_workflow() FROM PUBLIC;

-- 6. Timeout de proveedor IA: mismo rango que el adaptador (MAX_PROVIDER_TIMEOUT=85)
--    La migración 20261105202119 lo había limitado a 5..18 s, lo que hacía fallar
--    con error de base de datos cualquier configuración guardada desde el panel
--    de administración con el valor por defecto del backend (60 s).
UPDATE public.ai_provider_config SET timeout_seconds = 85 WHERE timeout_seconds > 85;
UPDATE public.ai_provider_config SET timeout_seconds = 5 WHERE timeout_seconds < 5;
ALTER TABLE public.ai_provider_config
  ALTER COLUMN timeout_seconds SET DEFAULT 60,
  DROP CONSTRAINT IF EXISTS ai_provider_timeout_range,
  ADD CONSTRAINT ai_provider_timeout_range CHECK (timeout_seconds >= 5 AND timeout_seconds <= 85);

COMMIT;

-- Verificación posterior (sólo lectura):
--   cd backend && python manage.py verify_public_schema
