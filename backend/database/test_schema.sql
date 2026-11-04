-- TEST ONLY: disposable PostgreSQL database. Never run against production.
-- Mirrors the supplied MaestrIA post-migration schema sufficiently to run ORM/API integration tests.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

CREATE TABLE public.course (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 name varchar NOT NULL, subject varchar NOT NULL DEFAULT '', level varchar NOT NULL DEFAULT '',
 academic_year varchar NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.student (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 name varchar NOT NULL, email varchar NOT NULL DEFAULT '', phone varchar NOT NULL DEFAULT '',
 external_code varchar NOT NULL DEFAULT '', account_user_id uuid REFERENCES auth.users(id), active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.rubric (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 title varchar NOT NULL, description text NOT NULL DEFAULT '', scale_type varchar NOT NULL DEFAULT 'both'
 CHECK (scale_type IN ('numeric','levels','both'))
);
CREATE TABLE public.rubric_criterion (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 name varchar NOT NULL, description text NOT NULL DEFAULT '',
 max_score numeric NOT NULL DEFAULT 10 CHECK (max_score > 0 AND max_score <= 1000),
 weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 100),
 position integer NOT NULL DEFAULT 1 CHECK (position >= 0), rubric_id bigint NOT NULL
);
CREATE TABLE public.rubric_level (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 name varchar NOT NULL, description text NOT NULL DEFAULT '', score numeric NOT NULL CHECK (score >= 0),
 position integer NOT NULL DEFAULT 1 CHECK (position >= 0), criterion_id bigint NOT NULL
);
CREATE TABLE public.assessment (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 title varchar NOT NULL, subject varchar NOT NULL DEFAULT '', level varchar NOT NULL DEFAULT '',
 objectives text NOT NULL DEFAULT '', instructions text NOT NULL DEFAULT '', reference_material text NOT NULL DEFAULT '',
 status varchar NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','archived')), course_id bigint
);
CREATE TABLE public.question (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 prompt text NOT NULL, expected_answer text NOT NULL DEFAULT '',
 question_type varchar NOT NULL DEFAULT 'open' CHECK (question_type IN ('open','short','case')),
 max_score numeric NOT NULL DEFAULT 10 CHECK (max_score > 0 AND max_score <= 1000),
 position integer NOT NULL DEFAULT 1 CHECK (position >= 0), assessment_id bigint NOT NULL, rubric_id bigint
);
CREATE TABLE public.enrollment (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 status varchar NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 enrolled_at timestamptz NOT NULL DEFAULT now(), notes varchar NOT NULL DEFAULT '', course_id bigint NOT NULL, student_id bigint NOT NULL
);
CREATE TABLE public.submission (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 student_name varchar NOT NULL DEFAULT '', answer_text text NOT NULL DEFAULT '',
 source_type varchar NOT NULL DEFAULT 'text' CHECK (source_type IN ('text','txt','pdf','docx')),
 source_filename varchar NOT NULL DEFAULT '', status varchar NOT NULL DEFAULT 'pending'
 CHECK (status IN ('pending','processing','review','approved')),
 assessment_id bigint NOT NULL, question_id bigint, student_id bigint
);
CREATE TABLE public.submission_answer (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 answer_text text NOT NULL, source_filename varchar NOT NULL DEFAULT '', submission_id bigint NOT NULL, question_id bigint NOT NULL
);
CREATE TABLE public.correction (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 provider varchar NOT NULL DEFAULT 'mock', proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
 final_result jsonb NOT NULL DEFAULT '{}'::jsonb, teacher_feedback text NOT NULL DEFAULT '',
 total_score numeric NOT NULL DEFAULT 0 CHECK (total_score >= 0),
 status varchar NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected')),
 approved_at timestamptz, rubric_id bigint, submission_id bigint NOT NULL
);
CREATE TABLE public.correction_criterion_result (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 criterion_name varchar NOT NULL, score numeric NOT NULL, max_score numeric NOT NULL,
 evidence text NOT NULL DEFAULT '', justification text NOT NULL DEFAULT '', feedback text NOT NULL DEFAULT '',
 position integer NOT NULL DEFAULT 1 CHECK (position >= 0), correction_id bigint NOT NULL, question_id bigint
);
CREATE TABLE public.correction_revision (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, correction_id bigint NOT NULL,
 owner_id uuid NOT NULL REFERENCES auth.users(id), revision_number integer NOT NULL CHECK (revision_number >= 0),
 previous_result jsonb NOT NULL DEFAULT '{}'::jsonb, new_result jsonb NOT NULL DEFAULT '{}'::jsonb,
 reason varchar NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ai_generation (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id),
 task varchar NOT NULL, provider varchar NOT NULL, model_name varchar NOT NULL DEFAULT '',
 status varchar NOT NULL CHECK (status IN ('succeeded','failed')),
 duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
 input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0), output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
 estimated_cost_usd numeric CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
 prompt_fingerprint varchar NOT NULL DEFAULT '', error_code varchar NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), assessment_id bigint, submission_id bigint
);
CREATE TABLE public.audit_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id),
 event_type varchar NOT NULL, object_type varchar NOT NULL, object_id varchar NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 actor_role varchar CHECK (actor_role IS NULL OR actor_role IN ('teacher','student','admin','superadmin','system')),
 request_id varchar, ip_address inet, user_agent text
);
CREATE TABLE public.contact_message (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name varchar NOT NULL, email varchar NOT NULL,
 subject varchar NOT NULL, message text NOT NULL CHECK (char_length(message) <= 4000),
 status varchar NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','handled','spam')),
 internal_notes text NOT NULL DEFAULT '', assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 category varchar NOT NULL DEFAULT 'general', source varchar NOT NULL DEFAULT 'public_web',
 assigned_at timestamptz, handled_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.user_profile (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
 email varchar NOT NULL DEFAULT '', full_name varchar NOT NULL DEFAULT '',
 role varchar NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher','student','admin','superadmin')),
 status varchar NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 role_updated_at timestamptz, role_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 suspended_at timestamptz, suspended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, suspension_reason text NOT NULL DEFAULT ''
);
CREATE TABLE public.institution (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name varchar NOT NULL, slug varchar NOT NULL UNIQUE,
 contact_email varchar NOT NULL DEFAULT '', status varchar NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
 created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TABLE public.institution_membership (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, institution_id bigint NOT NULL REFERENCES public.institution(id),
 user_id uuid NOT NULL REFERENCES auth.users(id), role varchar NOT NULL DEFAULT 'teacher'
 CHECK (role IN ('teacher','department_admin','institution_admin')),
 status varchar NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended')),
 invited_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TABLE public.ai_provider_config (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, provider varchar NOT NULL UNIQUE
 CHECK (provider IN ('mock','gemini','openai','ollama')),
 model_name varchar NOT NULL DEFAULT '', enabled boolean NOT NULL DEFAULT false,
 priority smallint NOT NULL DEFAULT 10, timeout_seconds smallint NOT NULL DEFAULT 45
 CHECK (timeout_seconds >= 5 AND timeout_seconds <= 90),
 input_usd_per_1k_tokens numeric CHECK (input_usd_per_1k_tokens IS NULL OR input_usd_per_1k_tokens >= 0),
 output_usd_per_1k_tokens numeric CHECK (output_usd_per_1k_tokens IS NULL OR output_usd_per_1k_tokens >= 0),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_course_id_owner ON public.course(id,owner_id);
CREATE UNIQUE INDEX uq_student_id_owner ON public.student(id,owner_id);
CREATE UNIQUE INDEX uq_rubric_id_owner ON public.rubric(id,owner_id);
CREATE UNIQUE INDEX uq_rubric_criterion_id_owner ON public.rubric_criterion(id,owner_id);
CREATE UNIQUE INDEX uq_assessment_id_owner ON public.assessment(id,owner_id);
CREATE UNIQUE INDEX uq_question_id_owner ON public.question(id,owner_id);
CREATE UNIQUE INDEX uq_submission_id_owner ON public.submission(id,owner_id);
CREATE UNIQUE INDEX uq_correction_id_owner ON public.correction(id,owner_id);
CREATE INDEX ix_rc_rubric_owner ON public.rubric_criterion(rubric_id,owner_id);
CREATE INDEX ix_rl_criterion_owner ON public.rubric_level(criterion_id,owner_id);
CREATE INDEX ix_assessment_course_owner ON public.assessment(course_id,owner_id);
CREATE INDEX ix_question_assessment_owner ON public.question(assessment_id,owner_id);
CREATE INDEX ix_question_rubric_owner ON public.question(rubric_id,owner_id);
CREATE INDEX ix_enrollment_course_owner ON public.enrollment(course_id,owner_id);
CREATE INDEX ix_enrollment_student_owner ON public.enrollment(student_id,owner_id);
CREATE INDEX ix_submission_assessment_owner ON public.submission(assessment_id,owner_id);
CREATE INDEX ix_submission_question_owner ON public.submission(question_id,owner_id);
CREATE INDEX ix_submission_student_owner ON public.submission(student_id,owner_id);
CREATE INDEX ix_answer_submission_owner ON public.submission_answer(submission_id,owner_id);
CREATE INDEX ix_answer_question_owner ON public.submission_answer(question_id,owner_id);
CREATE INDEX ix_correction_submission_owner ON public.correction(submission_id,owner_id);
CREATE INDEX ix_correction_rubric_owner ON public.correction(rubric_id,owner_id);
CREATE INDEX ix_result_correction_owner ON public.correction_criterion_result(correction_id,owner_id);
CREATE INDEX ix_result_question_owner ON public.correction_criterion_result(question_id,owner_id);
CREATE INDEX ix_revision_correction_owner ON public.correction_revision(correction_id,owner_id);
CREATE INDEX ix_ai_assessment_owner ON public.ai_generation(assessment_id,owner_id);
CREATE INDEX ix_ai_submission_owner ON public.ai_generation(submission_id,owner_id);
CREATE UNIQUE INDEX uq_user_profile_email_ci ON public.user_profile(lower(btrim(email))) WHERE email IS NOT NULL AND btrim(email) <> '';
CREATE UNIQUE INDEX uq_institution_membership_user ON public.institution_membership(institution_id,user_id);
CREATE INDEX ix_user_profile_role_status ON public.user_profile(role,status,created_at DESC);
CREATE INDEX ix_user_profile_status_updated ON public.user_profile(status,updated_at DESC);
CREATE INDEX ix_institution_membership_user_status ON public.institution_membership(user_id,status);
CREATE INDEX ix_institution_membership_institution_status ON public.institution_membership(institution_id,status,role);
CREATE INDEX ix_institution_status_created ON public.institution(status,created_at DESC);
CREATE INDEX ix_audit_event_actor_created ON public.audit_event(actor_user_id,created_at DESC);
CREATE INDEX ix_audit_event_object_created ON public.audit_event(object_type,object_id,created_at DESC);
CREATE INDEX ix_audit_event_type_created ON public.audit_event(event_type,created_at DESC);
CREATE INDEX ix_contact_message_inbox ON public.contact_message(status,created_at DESC);
CREATE INDEX ix_contact_message_assignee ON public.contact_message(assigned_to,status,updated_at DESC);
CREATE INDEX ix_contact_message_email_created ON public.contact_message(lower(email),created_at DESC);
CREATE INDEX ix_contact_message_category_created ON public.contact_message(category,created_at DESC);
CREATE INDEX ix_ai_provider_config_enabled_priority ON public.ai_provider_config(enabled,priority);

ALTER TABLE public.rubric_criterion ADD CONSTRAINT fk_rc_rubric_owner FOREIGN KEY (rubric_id,owner_id) REFERENCES public.rubric(id,owner_id);
ALTER TABLE public.rubric_level ADD CONSTRAINT fk_rl_criterion_owner FOREIGN KEY (criterion_id,owner_id) REFERENCES public.rubric_criterion(id,owner_id);
ALTER TABLE public.assessment ADD CONSTRAINT fk_assessment_course_owner FOREIGN KEY (course_id,owner_id) REFERENCES public.course(id,owner_id);
ALTER TABLE public.question ADD CONSTRAINT fk_question_assessment_owner FOREIGN KEY (assessment_id,owner_id) REFERENCES public.assessment(id,owner_id);
ALTER TABLE public.question ADD CONSTRAINT fk_question_rubric_owner FOREIGN KEY (rubric_id,owner_id) REFERENCES public.rubric(id,owner_id);
ALTER TABLE public.enrollment ADD CONSTRAINT fk_enrollment_course_owner FOREIGN KEY (course_id,owner_id) REFERENCES public.course(id,owner_id);
ALTER TABLE public.enrollment ADD CONSTRAINT fk_enrollment_student_owner FOREIGN KEY (student_id,owner_id) REFERENCES public.student(id,owner_id);
ALTER TABLE public.submission ADD CONSTRAINT fk_submission_assessment_owner FOREIGN KEY (assessment_id,owner_id) REFERENCES public.assessment(id,owner_id);
ALTER TABLE public.submission ADD CONSTRAINT fk_submission_question_owner FOREIGN KEY (question_id,owner_id) REFERENCES public.question(id,owner_id);
ALTER TABLE public.submission ADD CONSTRAINT fk_submission_student_owner FOREIGN KEY (student_id,owner_id) REFERENCES public.student(id,owner_id);
ALTER TABLE public.submission_answer ADD CONSTRAINT fk_answer_submission_owner FOREIGN KEY (submission_id,owner_id) REFERENCES public.submission(id,owner_id);
ALTER TABLE public.submission_answer ADD CONSTRAINT fk_answer_question_owner FOREIGN KEY (question_id,owner_id) REFERENCES public.question(id,owner_id);
ALTER TABLE public.correction ADD CONSTRAINT fk_correction_submission_owner FOREIGN KEY (submission_id,owner_id) REFERENCES public.submission(id,owner_id);
ALTER TABLE public.correction ADD CONSTRAINT fk_correction_rubric_owner FOREIGN KEY (rubric_id,owner_id) REFERENCES public.rubric(id,owner_id);
ALTER TABLE public.correction_criterion_result ADD CONSTRAINT fk_result_correction_owner FOREIGN KEY (correction_id,owner_id) REFERENCES public.correction(id,owner_id);
ALTER TABLE public.correction_criterion_result ADD CONSTRAINT fk_result_question_owner FOREIGN KEY (question_id,owner_id) REFERENCES public.question(id,owner_id);
ALTER TABLE public.correction_revision ADD CONSTRAINT fk_revision_correction_owner FOREIGN KEY (correction_id,owner_id) REFERENCES public.correction(id,owner_id);
ALTER TABLE public.ai_generation ADD CONSTRAINT fk_ai_assessment_owner FOREIGN KEY (assessment_id,owner_id) REFERENCES public.assessment(id,owner_id);
ALTER TABLE public.ai_generation ADD CONSTRAINT fk_ai_submission_owner FOREIGN KEY (submission_id,owner_id) REFERENCES public.submission(id,owner_id);

CREATE OR REPLACE FUNCTION public.maestria_guard_last_superadmin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE remaining integer;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.role='superadmin' AND OLD.status='active' THEN
   SELECT count(*) INTO remaining FROM public.user_profile WHERE role='superadmin' AND status='active' AND user_id<>OLD.user_id;
   IF remaining=0 THEN RAISE EXCEPTION 'No se puede eliminar el último superadministrador activo.'; END IF;
  END IF;
  RETURN OLD;
 END IF;
 IF OLD.role='superadmin' AND OLD.status='active' AND (NEW.role<>'superadmin' OR NEW.status<>'active') THEN
  SELECT count(*) INTO remaining FROM public.user_profile WHERE role='superadmin' AND status='active' AND user_id<>OLD.user_id;
  IF remaining=0 THEN RAISE EXCEPTION 'No se puede degradar ni suspender al último superadministrador activo.'; END IF;
 END IF;
 IF NEW.role IS DISTINCT FROM OLD.role THEN NEW.role_updated_at:=now(); END IF;
 IF OLD.role IN ('admin','superadmin') AND OLD.status='active' AND (NEW.role NOT IN ('admin','superadmin') OR NEW.status<>'active') THEN
  UPDATE public.contact_message SET assigned_to=NULL WHERE assigned_to=OLD.user_id;
 END IF;
 IF NEW.status='suspended' THEN
  IF OLD.status IS DISTINCT FROM 'suspended' THEN NEW.suspended_at:=now(); ELSE NEW.suspended_at:=coalesce(NEW.suspended_at,OLD.suspended_at,now()); END IF;
 ELSE NEW.suspended_at:=NULL; NEW.suspended_by:=NULL; NEW.suspension_reason:=''; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_user_profile_guard_last_superadmin BEFORE UPDATE OF role,status OR DELETE ON public.user_profile FOR EACH ROW EXECUTE FUNCTION public.maestria_guard_last_superadmin();

CREATE OR REPLACE FUNCTION public.maestria_contact_message_admin_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.updated_at:=now();
 IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_profile up WHERE up.user_id=NEW.assigned_to AND up.role IN ('admin','superadmin') AND up.status='active') THEN
  RAISE EXCEPTION 'El responsable asignado debe ser un administrador activo.';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_at IS NULL THEN NEW.assigned_at:=now(); END IF;
  IF NEW.status='handled' AND NEW.handled_at IS NULL THEN NEW.handled_at:=now(); END IF;
 ELSE
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN NEW.assigned_at:=CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.handled_at:=CASE WHEN NEW.status='handled' THEN now() ELSE NULL END; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_contact_message_admin_workflow BEFORE INSERT OR UPDATE ON public.contact_message FOR EACH ROW EXECUTE FUNCTION public.maestria_contact_message_admin_workflow();
