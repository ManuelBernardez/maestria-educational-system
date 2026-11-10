-- =============================================================================
-- MaestrIA — esquema `public` de producción (snapshot)
-- =============================================================================
-- FUENTE ÚNICA para instalaciones nuevas (reemplazó a los scripts v2, ya eliminados).
--
-- Origen:  `supabase db dump --schema public` del proyecto de producción,
--          tomado el 2026-11-09. Incluye las migraciones hasta
--          20261109140000_maestria_db_cleanup inclusive.
-- Agregado a mano al final (pg_dump de `public` no lo incluye):
--          triggers sobre auth.users y permisos de los roles del navegador.
--
-- Instalación limpia (proyecto Supabase nuevo o `npx supabase start`):
--   1. Ejecutar este archivo.
--   2. Ejecutar en orden las migraciones de backend/database/migrations/ con
--      versión POSTERIOR a 20261109140000.
--   3. cd backend && python manage.py verify_public_schema
--
-- Requiere Supabase (auth.users, auth.uid() y los roles anon/authenticated/
-- service_role). Para Postgres plano, ver docs/PRUEBAS-LOCALES.md.
-- No elimina datos; falla si las tablas ya existen.
-- =============================================================================

BEGIN;



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_contact_message_admin_workflow"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
    NEW.updated_at := now();

    IF NEW.assigned_to IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
              FROM public.user_profile up
             WHERE up.user_id = NEW.assigned_to
               AND up.role IN ('admin', 'superadmin')
               AND up.status = 'active'
        ) THEN
            RAISE EXCEPTION 'El responsable asignado debe ser un administrador activo.';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.assigned_to IS NOT NULL AND NEW.assigned_at IS NULL THEN
            NEW.assigned_at := now();
        END IF;
        IF NEW.status = 'handled' AND NEW.handled_at IS NULL THEN
            NEW.handled_at := now();
        END IF;
    ELSE
        IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
            NEW.assigned_at := CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END;
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status THEN
            NEW.handled_at := CASE WHEN NEW.status = 'handled' THEN now() ELSE NULL END;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."maestria_contact_message_admin_workflow"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_guard_last_superadmin"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
    v_remaining integer;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.role = 'superadmin' AND OLD.status = 'active' THEN
            SELECT count(*) INTO v_remaining
              FROM public.user_profile
             WHERE role = 'superadmin'
               AND status = 'active'
               AND user_id <> OLD.user_id;
            IF v_remaining = 0 THEN
                RAISE EXCEPTION 'No se puede eliminar el último superadministrador activo.';
            END IF;
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.role = 'superadmin' AND OLD.status = 'active'
       AND (NEW.role <> 'superadmin' OR NEW.status <> 'active') THEN
        SELECT count(*) INTO v_remaining
          FROM public.user_profile
         WHERE role = 'superadmin'
           AND status = 'active'
           AND user_id <> OLD.user_id;
        IF v_remaining = 0 THEN
            RAISE EXCEPTION 'No se puede degradar ni suspender al último superadministrador activo.';
        END IF;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
        NEW.role_updated_at := now();
    END IF;

    -- Al perder el rol de administrador activo, se liberan sus mensajes
    -- asignados para que no queden tickets a cargo de una cuenta sin permisos.
    IF OLD.role IN ('admin', 'superadmin') AND OLD.status = 'active'
       AND (NEW.role NOT IN ('admin', 'superadmin') OR NEW.status <> 'active') THEN
        UPDATE public.contact_message
           SET assigned_to = NULL
         WHERE assigned_to = OLD.user_id;
    END IF;

    IF NEW.status = 'suspended' THEN
        IF OLD.status IS DISTINCT FROM 'suspended' THEN
            NEW.suspended_at := now();
        ELSE
            NEW.suspended_at := coalesce(NEW.suspended_at, OLD.suspended_at, now());
        END IF;
    ELSE
        NEW.suspended_at := NULL;
        NEW.suspended_by := NULL;
        NEW.suspension_reason := '';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."maestria_guard_last_superadmin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_sync_auth_user_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  INSERT INTO public.user_profile (user_id, email, full_name, role, status)
  VALUES (
    NEW.id,
    lower(coalesce(NEW.email, '')),
    left(coalesce(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''), 180),
    'teacher', 'active'
  )
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE WHEN public.user_profile.full_name = '' THEN EXCLUDED.full_name ELSE public.user_profile.full_name END,
        updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."maestria_sync_auth_user_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."maestria_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_validate_correction_result_question"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.question_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.correction c JOIN public.submission s ON s.id = c.submission_id
    JOIN public.question q ON q.id = NEW.question_id
    WHERE c.id = NEW.correction_id AND s.assessment_id = q.assessment_id
      AND c.owner_id = NEW.owner_id AND q.owner_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'La pregunta del resultado debe pertenecer a la evaluación de la entrega corregida' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."maestria_validate_correction_result_question"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_validate_criterion_max_score"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.rubric_level l WHERE l.criterion_id = NEW.id AND l.score > NEW.max_score) THEN
    RAISE EXCEPTION 'El máximo del criterio no puede ser menor que la puntuación de un nivel existente' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."maestria_validate_criterion_max_score"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_validate_rubric_level_score"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE max_allowed numeric;
BEGIN
  SELECT max_score INTO max_allowed FROM public.rubric_criterion
  WHERE id = NEW.criterion_id AND owner_id = NEW.owner_id FOR UPDATE;
  IF max_allowed IS NULL OR NEW.score > max_allowed THEN
    RAISE EXCEPTION 'El nivel debe pertenecer al criterio y no superar su puntuación máxima' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."maestria_validate_rubric_level_score"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_validate_submission_answer_question"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.submission s JOIN public.question q ON q.id = NEW.question_id
    WHERE s.id = NEW.submission_id AND s.assessment_id = q.assessment_id
      AND s.owner_id = NEW.owner_id AND q.owner_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'La pregunta debe pertenecer a la evaluación de la entrega y al mismo propietario' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."maestria_validate_submission_answer_question"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maestria_validate_submission_question"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.question_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.question q WHERE q.id = NEW.question_id
      AND q.assessment_id = NEW.assessment_id AND q.owner_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'La pregunta debe pertenecer a la evaluación de la entrega y al mismo propietario' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."maestria_validate_submission_question"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_generation" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "task" character varying(40) NOT NULL,
    "provider" character varying(32) NOT NULL,
    "model_name" character varying(100) DEFAULT ''::character varying NOT NULL,
    "status" character varying(16) NOT NULL,
    "duration_ms" integer DEFAULT 0 NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" numeric(12,6),
    "prompt_fingerprint" character varying(64) DEFAULT ''::character varying NOT NULL,
    "error_code" character varying(80) DEFAULT ''::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assessment_id" bigint,
    "submission_id" bigint,
    CONSTRAINT "ai_generation_duration_ms_check" CHECK (("duration_ms" >= 0)),
    CONSTRAINT "ai_generation_estimated_cost_usd_check" CHECK ((("estimated_cost_usd" IS NULL) OR ("estimated_cost_usd" >= (0)::numeric))),
    CONSTRAINT "ai_generation_input_tokens_check" CHECK (("input_tokens" >= 0)),
    CONSTRAINT "ai_generation_output_tokens_check" CHECK (("output_tokens" >= 0)),
    CONSTRAINT "ai_generation_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['succeeded'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."ai_generation" OWNER TO "postgres";


ALTER TABLE "public"."ai_generation" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ai_generation_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_provider_config" (
    "id" bigint NOT NULL,
    "provider" character varying(24) NOT NULL,
    "model_name" character varying(120) DEFAULT ''::character varying NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "priority" smallint DEFAULT 10 NOT NULL,
    "timeout_seconds" smallint DEFAULT 60 NOT NULL,
    "input_usd_per_1k_tokens" numeric(12,8),
    "output_usd_per_1k_tokens" numeric(12,8),
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_provider_config_input_usd_per_1k_tokens_check" CHECK ((("input_usd_per_1k_tokens" IS NULL) OR ("input_usd_per_1k_tokens" >= (0)::numeric))),
    CONSTRAINT "ai_provider_config_output_usd_per_1k_tokens_check" CHECK ((("output_usd_per_1k_tokens" IS NULL) OR ("output_usd_per_1k_tokens" >= (0)::numeric))),
    CONSTRAINT "ai_provider_timeout_range" CHECK ((("timeout_seconds" >= 5) AND ("timeout_seconds" <= 85))),
    CONSTRAINT "ai_provider_valid" CHECK ((("provider")::"text" = ANY ((ARRAY['mock'::character varying, 'gemini'::character varying, 'openai'::character varying, 'ollama'::character varying])::"text"[])))
);


ALTER TABLE "public"."ai_provider_config" OWNER TO "postgres";


ALTER TABLE "public"."ai_provider_config" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ai_provider_config_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."assessment" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" character varying(180) NOT NULL,
    "subject" character varying(120) DEFAULT ''::character varying NOT NULL,
    "level" character varying(120) DEFAULT ''::character varying NOT NULL,
    "objectives" "text" DEFAULT ''::"text" NOT NULL,
    "instructions" "text" DEFAULT ''::"text" NOT NULL,
    "reference_material" "text" DEFAULT ''::"text" NOT NULL,
    "status" character varying(24) DEFAULT 'draft'::character varying NOT NULL,
    "course_id" bigint,
    CONSTRAINT "assessment_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'ready'::character varying, 'archived'::character varying])::"text"[])))
);


ALTER TABLE "public"."assessment" OWNER TO "postgres";


ALTER TABLE "public"."assessment" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."assessment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."audit_event" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "event_type" character varying(80) NOT NULL,
    "object_type" character varying(80) NOT NULL,
    "object_id" character varying(80) NOT NULL,
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" character varying,
    "request_id" character varying,
    "ip_address" "inet",
    "user_agent" "text",
    CONSTRAINT "ck_audit_event_actor_role" CHECK ((("actor_role" IS NULL) OR (("actor_role")::"text" = ANY ((ARRAY['teacher'::character varying, 'student'::character varying, 'admin'::character varying, 'superadmin'::character varying, 'system'::character varying])::"text"[]))))
);


ALTER TABLE "public"."audit_event" OWNER TO "postgres";


COMMENT ON COLUMN "public"."audit_event"."actor_user_id" IS 'Usuario que ejecutó la acción. Se registra separado de owner_id para distinguir actor y propietario del recurso.';



ALTER TABLE "public"."audit_event" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."audit_event_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."contact_message" (
    "id" bigint NOT NULL,
    "name" character varying(120) NOT NULL,
    "email" character varying(254) NOT NULL,
    "subject" character varying(160) NOT NULL,
    "message" "text" NOT NULL,
    "status" character varying(16) DEFAULT 'new'::character varying NOT NULL,
    "internal_notes" "text" DEFAULT ''::"text" NOT NULL,
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "category" character varying DEFAULT 'general'::character varying NOT NULL,
    "source" character varying DEFAULT 'public_web'::character varying NOT NULL,
    "assigned_at" timestamp with time zone,
    "handled_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "contact_message_max_length" CHECK (("char_length"("message") <= 4000)),
    CONSTRAINT "contact_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['new'::character varying, 'in_progress'::character varying, 'handled'::character varying, 'spam'::character varying])::"text"[])))
);


ALTER TABLE "public"."contact_message" OWNER TO "postgres";


COMMENT ON COLUMN "public"."contact_message"."internal_notes" IS 'Notas internas visibles solo para personal autorizado; nunca devolverlas en la API pública.';



COMMENT ON COLUMN "public"."contact_message"."assigned_to" IS 'Administrador activo responsable de gestionar el mensaje.';



COMMENT ON COLUMN "public"."contact_message"."user_id" IS 'Cuenta autenticada que envió el mensaje, si corresponde. NULL permite consultas anónimas desde el sitio público.';



ALTER TABLE "public"."contact_message" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."contact_message_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."correction" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider" character varying(32) DEFAULT 'mock'::character varying NOT NULL,
    "proposal" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "final_result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "teacher_feedback" "text" DEFAULT ''::"text" NOT NULL,
    "total_score" numeric(8,2) DEFAULT 0 NOT NULL,
    "status" character varying(24) DEFAULT 'pending_review'::character varying NOT NULL,
    "approved_at" timestamp with time zone,
    "rubric_id" bigint,
    "submission_id" bigint NOT NULL,
    CONSTRAINT "correction_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['pending_review'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[]))),
    CONSTRAINT "correction_total_nonnegative" CHECK (("total_score" >= (0)::numeric))
);


ALTER TABLE "public"."correction" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."correction_criterion_result" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "criterion_name" character varying(160) NOT NULL,
    "score" numeric(7,2) NOT NULL,
    "max_score" numeric(7,2) NOT NULL,
    "evidence" "text" DEFAULT ''::"text" NOT NULL,
    "justification" "text" DEFAULT ''::"text" NOT NULL,
    "feedback" "text" DEFAULT ''::"text" NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "correction_id" bigint NOT NULL,
    "question_id" bigint,
    CONSTRAINT "correction_criterion_result_position_check" CHECK (("position" >= 0)),
    CONSTRAINT "criterion_result_score_range" CHECK ((("score" >= (0)::numeric) AND ("max_score" >= (0)::numeric) AND ("score" <= "max_score")))
);


ALTER TABLE "public"."correction_criterion_result" OWNER TO "postgres";


ALTER TABLE "public"."correction_criterion_result" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."correction_criterion_result_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."correction" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."correction_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."correction_revision" (
    "id" bigint NOT NULL,
    "correction_id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "revision_number" integer NOT NULL,
    "previous_result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "new_result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "reason" character varying(250) DEFAULT ''::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "correction_revision_revision_number_check" CHECK (("revision_number" >= 0))
);


ALTER TABLE "public"."correction_revision" OWNER TO "postgres";


ALTER TABLE "public"."correction_revision" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."correction_revision_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."course" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" character varying(160) NOT NULL,
    "subject" character varying(120) DEFAULT ''::character varying NOT NULL,
    "level" character varying(120) DEFAULT ''::character varying NOT NULL,
    "academic_year" character varying(20) DEFAULT ''::character varying NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."course" OWNER TO "postgres";


ALTER TABLE "public"."course" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."course_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."django_cache" (
    "cache_key" character varying(255) NOT NULL,
    "value" "text" NOT NULL,
    "expires" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."django_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."django_cache" IS 'Caché de Django (DatabaseCache) para contadores de límites de frecuencia. Datos efímeros: se puede vaciar sin pérdida.';



CREATE TABLE IF NOT EXISTS "public"."enrollment" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "enrolled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" character varying(250) DEFAULT ''::character varying NOT NULL,
    "course_id" bigint NOT NULL,
    "student_id" bigint NOT NULL,
    CONSTRAINT "enrollment_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::"text"[])))
);


ALTER TABLE "public"."enrollment" OWNER TO "postgres";


ALTER TABLE "public"."enrollment" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."enrollment_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."institution" (
    "id" bigint NOT NULL,
    "name" character varying(180) NOT NULL,
    "slug" character varying(180) NOT NULL,
    "contact_email" character varying(254) DEFAULT ''::character varying NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "institution_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'archived'::character varying])::"text"[])))
);


ALTER TABLE "public"."institution" OWNER TO "postgres";


ALTER TABLE "public"."institution" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."institution_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."institution_membership" (
    "id" bigint NOT NULL,
    "institution_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" character varying(24) DEFAULT 'teacher'::character varying NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "institution_member_role_valid" CHECK ((("role")::"text" = ANY ((ARRAY['teacher'::character varying, 'department_admin'::character varying, 'institution_admin'::character varying])::"text"[]))),
    CONSTRAINT "institution_member_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['invited'::character varying, 'active'::character varying, 'suspended'::character varying])::"text"[])))
);


ALTER TABLE "public"."institution_membership" OWNER TO "postgres";


COMMENT ON COLUMN "public"."institution_membership"."role" IS 'Rol acotado a una institución: teacher, department_admin o institution_admin.';



ALTER TABLE "public"."institution_membership" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."institution_membership_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."question" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prompt" "text" NOT NULL,
    "expected_answer" "text" DEFAULT ''::"text" NOT NULL,
    "question_type" character varying(16) DEFAULT 'open'::character varying NOT NULL,
    "max_score" numeric(7,2) DEFAULT 10 NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "assessment_id" bigint NOT NULL,
    "rubric_id" bigint,
    CONSTRAINT "question_position_check" CHECK (("position" >= 0)),
    CONSTRAINT "question_score_range" CHECK ((("max_score" > (0)::numeric) AND ("max_score" <= (1000)::numeric))),
    CONSTRAINT "question_type_valid" CHECK ((("question_type")::"text" = ANY ((ARRAY['open'::character varying, 'short'::character varying, 'case'::character varying])::"text"[])))
);


ALTER TABLE "public"."question" OWNER TO "postgres";


ALTER TABLE "public"."question" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."question_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."rubric" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" character varying(180) NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "scale_type" character varying(16) DEFAULT 'both'::character varying NOT NULL,
    CONSTRAINT "rubric_scale_type_valid" CHECK ((("scale_type")::"text" = ANY ((ARRAY['numeric'::character varying, 'levels'::character varying, 'both'::character varying])::"text"[])))
);


ALTER TABLE "public"."rubric" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rubric_criterion" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" character varying(160) NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "max_score" numeric(7,2) DEFAULT 10 NOT NULL,
    "weight" numeric(6,3) DEFAULT 1 NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "rubric_id" bigint NOT NULL,
    CONSTRAINT "criterion_score_range" CHECK ((("max_score" > (0)::numeric) AND ("max_score" <= (1000)::numeric))),
    CONSTRAINT "criterion_weight_range" CHECK ((("weight" >= (0)::numeric) AND ("weight" <= (100)::numeric))),
    CONSTRAINT "rubric_criterion_position_check" CHECK (("position" >= 0))
);


ALTER TABLE "public"."rubric_criterion" OWNER TO "postgres";


ALTER TABLE "public"."rubric_criterion" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."rubric_criterion_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."rubric" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."rubric_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."rubric_level" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" character varying(80) NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "score" numeric(7,2) NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    "criterion_id" bigint NOT NULL,
    CONSTRAINT "rubric_level_position_check" CHECK (("position" >= 0)),
    CONSTRAINT "rubric_level_score_check" CHECK (("score" >= (0)::numeric))
);


ALTER TABLE "public"."rubric_level" OWNER TO "postgres";


ALTER TABLE "public"."rubric_level" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."rubric_level_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."student" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" character varying(180) NOT NULL,
    "email" character varying(254) DEFAULT ''::character varying NOT NULL,
    "phone" character varying(32) DEFAULT ''::character varying NOT NULL,
    "external_code" character varying(80) DEFAULT ''::character varying NOT NULL,
    "account_user_id" "uuid",
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."student" OWNER TO "postgres";


ALTER TABLE "public"."student" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."student_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."submission" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "student_name" character varying(180) DEFAULT ''::character varying NOT NULL,
    "answer_text" "text" DEFAULT ''::"text" NOT NULL,
    "source_type" character varying(16) DEFAULT 'text'::character varying NOT NULL,
    "source_filename" character varying(255) DEFAULT ''::character varying NOT NULL,
    "status" character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    "assessment_id" bigint NOT NULL,
    "question_id" bigint,
    "student_id" bigint,
    CONSTRAINT "submission_source_type_valid" CHECK ((("source_type")::"text" = ANY ((ARRAY['text'::character varying, 'txt'::character varying, 'pdf'::character varying, 'docx'::character varying])::"text"[]))),
    CONSTRAINT "submission_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'review'::character varying, 'approved'::character varying])::"text"[])))
);


ALTER TABLE "public"."submission" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_answer" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "answer_text" "text" NOT NULL,
    "source_filename" character varying(255) DEFAULT ''::character varying NOT NULL,
    "submission_id" bigint NOT NULL,
    "question_id" bigint NOT NULL
);


ALTER TABLE "public"."submission_answer" OWNER TO "postgres";


ALTER TABLE "public"."submission_answer" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."submission_answer_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."submission" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."submission_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_profile" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" character varying(254) DEFAULT ''::character varying NOT NULL,
    "full_name" character varying(180) DEFAULT ''::character varying NOT NULL,
    "role" character varying(24) DEFAULT 'teacher'::character varying NOT NULL,
    "status" character varying(16) DEFAULT 'active'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role_updated_at" timestamp with time zone,
    "role_updated_by" "uuid",
    "suspended_at" timestamp with time zone,
    "suspended_by" "uuid",
    "suspension_reason" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "user_profile_role_valid" CHECK ((("role")::"text" = ANY ((ARRAY['teacher'::character varying, 'student'::character varying, 'admin'::character varying, 'superadmin'::character varying])::"text"[]))),
    CONSTRAINT "user_profile_status_valid" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'deleted'::character varying])::"text"[])))
);


ALTER TABLE "public"."user_profile" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_profile"."role" IS 'Rol global de la cuenta: teacher, student, admin o superadmin. Los permisos deben validarse también en el backend.';



COMMENT ON COLUMN "public"."user_profile"."status" IS 'Estado de la cuenta dentro de MaestrIA: active, suspended o deleted.';



ALTER TABLE "public"."user_profile" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_profile_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."ai_generation"
    ADD CONSTRAINT "ai_generation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_provider_config"
    ADD CONSTRAINT "ai_provider_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_provider_config"
    ADD CONSTRAINT "ai_provider_config_provider_key" UNIQUE ("provider");



ALTER TABLE ONLY "public"."assessment"
    ADD CONSTRAINT "assessment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_event"
    ADD CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_message"
    ADD CONSTRAINT "contact_message_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."correction_criterion_result"
    ADD CONSTRAINT "correction_criterion_result_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."correction"
    ADD CONSTRAINT "correction_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."correction_revision"
    ADD CONSTRAINT "correction_revision_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course"
    ADD CONSTRAINT "course_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."django_cache"
    ADD CONSTRAINT "django_cache_pkey" PRIMARY KEY ("cache_key");



ALTER TABLE ONLY "public"."enrollment"
    ADD CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institution_membership"
    ADD CONSTRAINT "institution_membership_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institution"
    ADD CONSTRAINT "institution_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institution"
    ADD CONSTRAINT "institution_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."question"
    ADD CONSTRAINT "question_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubric_criterion"
    ADD CONSTRAINT "rubric_criterion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubric_level"
    ADD CONSTRAINT "rubric_level_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubric"
    ADD CONSTRAINT "rubric_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student"
    ADD CONSTRAINT "student_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_answer"
    ADD CONSTRAINT "submission_answer_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission"
    ADD CONSTRAINT "submission_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."correction_revision"
    ADD CONSTRAINT "uniq_correction_revision_number" UNIQUE ("correction_id", "revision_number");



ALTER TABLE ONLY "public"."rubric_criterion"
    ADD CONSTRAINT "uniq_criterion_position_per_rubric" UNIQUE ("rubric_id", "position");



ALTER TABLE ONLY "public"."correction_criterion_result"
    ADD CONSTRAINT "uniq_criterion_result_position" UNIQUE ("correction_id", "position");



ALTER TABLE ONLY "public"."enrollment"
    ADD CONSTRAINT "uniq_enrollment_course_student" UNIQUE ("course_id", "student_id");



ALTER TABLE ONLY "public"."question"
    ADD CONSTRAINT "uniq_question_position_per_assessment" UNIQUE ("assessment_id", "position");



ALTER TABLE ONLY "public"."rubric_level"
    ADD CONSTRAINT "uniq_rubric_level_position" UNIQUE ("criterion_id", "position");



ALTER TABLE ONLY "public"."submission_answer"
    ADD CONSTRAINT "uniq_submission_question_answer" UNIQUE ("submission_id", "question_id");



ALTER TABLE ONLY "public"."assessment"
    ADD CONSTRAINT "uq_assessment_id_owner" UNIQUE ("id", "owner_id");



ALTER TABLE ONLY "public"."correction"
    ADD CONSTRAINT "uq_correction_id_owner" UNIQUE ("id", "owner_id");



ALTER TABLE ONLY "public"."course"
    ADD CONSTRAINT "uq_course_id_owner" UNIQUE ("id", "owner_id");



ALTER TABLE ONLY "public"."institution_membership"
    ADD CONSTRAINT "uq_institution_membership_user" UNIQUE ("institution_id", "user_id");



ALTER TABLE ONLY "public"."question"
    ADD CONSTRAINT "uq_question_id_owner" UNIQUE ("id", "owner_id");



ALTER TABLE ONLY "public"."rubric_criterion"
    ADD CONSTRAINT "uq_rubric_criterion_id_owner" UNIQUE ("id", "owner_id");



ALTER TABLE ONLY "public"."rubric"
    ADD CONSTRAINT "uq_rubric_id_owner" UNIQUE ("id", "owner_id");



ALTER TABLE ONLY "public"."student"
    ADD CONSTRAINT "uq_student_id_owner" UNIQUE ("id", "owner_id");



ALTER TABLE ONLY "public"."submission"
    ADD CONSTRAINT "uq_submission_id_owner" UNIQUE ("id", "owner_id");



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_user_id_key" UNIQUE ("user_id");



CREATE INDEX "ai_generation_assessment_id_idx" ON "public"."ai_generation" USING "btree" ("assessment_id");



CREATE INDEX "ai_generation_created_at_idx" ON "public"."ai_generation" USING "btree" ("created_at");



CREATE INDEX "ai_generation_owner_id_idx" ON "public"."ai_generation" USING "btree" ("owner_id");



CREATE INDEX "ai_generation_owner_task_idx" ON "public"."ai_generation" USING "btree" ("owner_id", "task", "created_at");



CREATE INDEX "ai_generation_submission_id_idx" ON "public"."ai_generation" USING "btree" ("submission_id");



CREATE INDEX "ai_generation_task_idx" ON "public"."ai_generation" USING "btree" ("task");



CREATE INDEX "assessment_course_id_idx" ON "public"."assessment" USING "btree" ("course_id");



CREATE INDEX "assessment_owner_id_idx" ON "public"."assessment" USING "btree" ("owner_id");



CREATE INDEX "assessment_owner_status_idx" ON "public"."assessment" USING "btree" ("owner_id", "status");



CREATE INDEX "audit_event_created_at_idx" ON "public"."audit_event" USING "btree" ("created_at");



CREATE INDEX "audit_event_event_type_idx" ON "public"."audit_event" USING "btree" ("event_type");



CREATE INDEX "audit_event_owner_id_idx" ON "public"."audit_event" USING "btree" ("owner_id");



CREATE INDEX "audit_owner_created_idx" ON "public"."audit_event" USING "btree" ("owner_id", "created_at" DESC);



CREATE INDEX "contact_message_assigned_to_idx" ON "public"."contact_message" USING "btree" ("assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "contact_message_created_at_idx" ON "public"."contact_message" USING "btree" ("created_at");



CREATE INDEX "corr_crit_owner_name_idx" ON "public"."correction_criterion_result" USING "btree" ("owner_id", "criterion_name");



CREATE INDEX "correction_owner_id_idx" ON "public"."correction" USING "btree" ("owner_id");



CREATE INDEX "correction_owner_status_idx" ON "public"."correction" USING "btree" ("owner_id", "status");



CREATE INDEX "correction_result_correction_id_idx" ON "public"."correction_criterion_result" USING "btree" ("correction_id");



CREATE INDEX "correction_result_owner_id_idx" ON "public"."correction_criterion_result" USING "btree" ("owner_id");



CREATE INDEX "correction_result_question_id_idx" ON "public"."correction_criterion_result" USING "btree" ("question_id");



CREATE INDEX "correction_revision_correction_id_idx" ON "public"."correction_revision" USING "btree" ("correction_id");



CREATE INDEX "correction_revision_owner_id_idx" ON "public"."correction_revision" USING "btree" ("owner_id");



CREATE INDEX "correction_rubric_id_idx" ON "public"."correction" USING "btree" ("rubric_id");



CREATE INDEX "correction_status_approved_idx" ON "public"."correction" USING "btree" ("status", "approved_at" DESC);



CREATE INDEX "correction_submission_id_idx" ON "public"."correction" USING "btree" ("submission_id");



CREATE INDEX "course_owner_active_idx" ON "public"."course" USING "btree" ("owner_id", "active");



CREATE INDEX "course_owner_id_idx" ON "public"."course" USING "btree" ("owner_id");



CREATE INDEX "django_cache_expires" ON "public"."django_cache" USING "btree" ("expires");



CREATE INDEX "enroll_owner_course_status_idx" ON "public"."enrollment" USING "btree" ("owner_id", "course_id", "status");



CREATE INDEX "enrollment_course_id_idx" ON "public"."enrollment" USING "btree" ("course_id");



CREATE INDEX "enrollment_owner_id_idx" ON "public"."enrollment" USING "btree" ("owner_id");



CREATE INDEX "enrollment_student_id_idx" ON "public"."enrollment" USING "btree" ("student_id");



CREATE INDEX "inst_member_institution_role_idx" ON "public"."institution_membership" USING "btree" ("institution_id", "role", "status");



CREATE INDEX "institution_status_name_idx" ON "public"."institution" USING "btree" ("status", "name");



CREATE INDEX "ix_ai_assessment_owner" ON "public"."ai_generation" USING "btree" ("assessment_id", "owner_id");



CREATE INDEX "ix_ai_provider_config_enabled_priority" ON "public"."ai_provider_config" USING "btree" ("enabled", "priority");



CREATE INDEX "ix_ai_provider_config_updated_by" ON "public"."ai_provider_config" USING "btree" ("updated_by");



CREATE INDEX "ix_ai_submission_owner" ON "public"."ai_generation" USING "btree" ("submission_id", "owner_id");



CREATE INDEX "ix_answer_question_owner" ON "public"."submission_answer" USING "btree" ("question_id", "owner_id");



CREATE INDEX "ix_answer_submission_owner" ON "public"."submission_answer" USING "btree" ("submission_id", "owner_id");



CREATE INDEX "ix_assessment_course_owner" ON "public"."assessment" USING "btree" ("course_id", "owner_id");



CREATE INDEX "ix_audit_event_actor_created" ON "public"."audit_event" USING "btree" ("actor_user_id", "created_at" DESC);



CREATE INDEX "ix_audit_event_object_created" ON "public"."audit_event" USING "btree" ("object_type", "object_id", "created_at" DESC);



CREATE INDEX "ix_audit_event_type_created" ON "public"."audit_event" USING "btree" ("event_type", "created_at" DESC);



CREATE INDEX "ix_contact_message_assignee" ON "public"."contact_message" USING "btree" ("assigned_to", "status", "updated_at" DESC);



CREATE INDEX "ix_contact_message_category_created" ON "public"."contact_message" USING "btree" ("category", "created_at" DESC);



CREATE INDEX "ix_contact_message_email_created" ON "public"."contact_message" USING "btree" ("lower"(("email")::"text"), "created_at" DESC);



CREATE INDEX "ix_contact_message_inbox" ON "public"."contact_message" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "ix_contact_message_user" ON "public"."contact_message" USING "btree" ("user_id");



CREATE INDEX "ix_correction_rubric_owner" ON "public"."correction" USING "btree" ("rubric_id", "owner_id");



CREATE INDEX "ix_correction_submission_owner" ON "public"."correction" USING "btree" ("submission_id", "owner_id");



CREATE INDEX "ix_enrollment_course_owner" ON "public"."enrollment" USING "btree" ("course_id", "owner_id");



CREATE INDEX "ix_enrollment_student_owner" ON "public"."enrollment" USING "btree" ("student_id", "owner_id");



CREATE INDEX "ix_institution_created_by" ON "public"."institution" USING "btree" ("created_by");



CREATE INDEX "ix_institution_membership_institution_status" ON "public"."institution_membership" USING "btree" ("institution_id", "status", "role");



CREATE INDEX "ix_institution_membership_invited_by" ON "public"."institution_membership" USING "btree" ("invited_by");



CREATE INDEX "ix_institution_membership_updated_by" ON "public"."institution_membership" USING "btree" ("updated_by");



CREATE INDEX "ix_institution_membership_user_status" ON "public"."institution_membership" USING "btree" ("user_id", "status");



CREATE INDEX "ix_institution_status_created" ON "public"."institution" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "ix_institution_updated_by" ON "public"."institution" USING "btree" ("updated_by");



CREATE INDEX "ix_question_assessment_owner" ON "public"."question" USING "btree" ("assessment_id", "owner_id");



CREATE INDEX "ix_question_rubric_owner" ON "public"."question" USING "btree" ("rubric_id", "owner_id");



CREATE INDEX "ix_rc_rubric_owner" ON "public"."rubric_criterion" USING "btree" ("rubric_id", "owner_id");



CREATE INDEX "ix_result_correction_owner" ON "public"."correction_criterion_result" USING "btree" ("correction_id", "owner_id");



CREATE INDEX "ix_result_question_owner" ON "public"."correction_criterion_result" USING "btree" ("question_id", "owner_id");



CREATE INDEX "ix_revision_correction_owner" ON "public"."correction_revision" USING "btree" ("correction_id", "owner_id");



CREATE INDEX "ix_rl_criterion_owner" ON "public"."rubric_level" USING "btree" ("criterion_id", "owner_id");



CREATE INDEX "ix_submission_assessment_owner" ON "public"."submission" USING "btree" ("assessment_id", "owner_id");



CREATE INDEX "ix_submission_question_owner" ON "public"."submission" USING "btree" ("question_id", "owner_id");



CREATE INDEX "ix_submission_student_owner" ON "public"."submission" USING "btree" ("student_id", "owner_id");



CREATE INDEX "ix_user_profile_role_status" ON "public"."user_profile" USING "btree" ("role", "status", "created_at" DESC);



CREATE INDEX "ix_user_profile_role_updated_by" ON "public"."user_profile" USING "btree" ("role_updated_by");



CREATE INDEX "ix_user_profile_status_updated" ON "public"."user_profile" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "ix_user_profile_suspended_by" ON "public"."user_profile" USING "btree" ("suspended_by");



CREATE INDEX "question_assessment_id_idx" ON "public"."question" USING "btree" ("assessment_id");



CREATE INDEX "question_owner_id_idx" ON "public"."question" USING "btree" ("owner_id");



CREATE INDEX "question_rubric_id_idx" ON "public"."question" USING "btree" ("rubric_id");



CREATE INDEX "rubric_criterion_owner_id_idx" ON "public"."rubric_criterion" USING "btree" ("owner_id");



CREATE INDEX "rubric_criterion_rubric_id_idx" ON "public"."rubric_criterion" USING "btree" ("rubric_id");



CREATE INDEX "rubric_level_criterion_id_idx" ON "public"."rubric_level" USING "btree" ("criterion_id");



CREATE INDEX "rubric_level_owner_id_idx" ON "public"."rubric_level" USING "btree" ("owner_id");



CREATE INDEX "rubric_owner_id_idx" ON "public"."rubric" USING "btree" ("owner_id");



CREATE INDEX "student_account_user_id_idx" ON "public"."student" USING "btree" ("account_user_id") WHERE ("account_user_id" IS NOT NULL);



CREATE INDEX "student_owner_active_idx" ON "public"."student" USING "btree" ("owner_id", "active");



CREATE INDEX "student_owner_id_idx" ON "public"."student" USING "btree" ("owner_id");



CREATE INDEX "submission_answer_owner_id_idx" ON "public"."submission_answer" USING "btree" ("owner_id");



CREATE INDEX "submission_answer_question_id_idx" ON "public"."submission_answer" USING "btree" ("question_id");



CREATE INDEX "submission_answer_submission_id_idx" ON "public"."submission_answer" USING "btree" ("submission_id");



CREATE INDEX "submission_assessment_id_idx" ON "public"."submission" USING "btree" ("assessment_id");



CREATE INDEX "submission_owner_id_idx" ON "public"."submission" USING "btree" ("owner_id");



CREATE INDEX "submission_owner_status_idx" ON "public"."submission" USING "btree" ("owner_id", "status");



CREATE INDEX "submission_question_id_idx" ON "public"."submission" USING "btree" ("question_id");



CREATE INDEX "submission_student_id_idx" ON "public"."submission" USING "btree" ("student_id");



CREATE UNIQUE INDEX "uniq_approved_correction_per_submission" ON "public"."correction" USING "btree" ("submission_id") WHERE (("status")::"text" = 'approved'::"text");



CREATE UNIQUE INDEX "uniq_course_owner_name_ci" ON "public"."course" USING "btree" ("lower"(("name")::"text"), "owner_id");



CREATE UNIQUE INDEX "uniq_enabled_ai_provider" ON "public"."ai_provider_config" USING "btree" ("enabled") WHERE ("enabled" = true);



CREATE UNIQUE INDEX "uniq_student_external_code_per_owner" ON "public"."student" USING "btree" ("owner_id", "external_code") WHERE (("external_code")::"text" <> ''::"text");



CREATE UNIQUE INDEX "uq_user_profile_email_ci" ON "public"."user_profile" USING "btree" ("lower"("btrim"(("email")::"text"))) WHERE (("email" IS NOT NULL) AND ("btrim"(("email")::"text") <> ''::"text"));



CREATE INDEX "user_profile_email_ci_idx" ON "public"."user_profile" USING "btree" ("lower"(("email")::"text"));



CREATE INDEX "user_profile_role_status_idx" ON "public"."user_profile" USING "btree" ("role", "status");



CREATE OR REPLACE TRIGGER "ai_provider_config_touch_updated_at" BEFORE UPDATE ON "public"."ai_provider_config" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "assessment_touch_updated_at" BEFORE UPDATE ON "public"."assessment" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "contact_message_touch_updated_at" BEFORE UPDATE ON "public"."contact_message" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "correction_criterion_result_touch_updated_at" BEFORE UPDATE ON "public"."correction_criterion_result" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "correction_result_question_same_assessment" BEFORE INSERT OR UPDATE OF "correction_id", "question_id", "owner_id" ON "public"."correction_criterion_result" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_validate_correction_result_question"();



CREATE OR REPLACE TRIGGER "correction_touch_updated_at" BEFORE UPDATE ON "public"."correction" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "course_touch_updated_at" BEFORE UPDATE ON "public"."course" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "enrollment_touch_updated_at" BEFORE UPDATE ON "public"."enrollment" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "institution_membership_touch_updated_at" BEFORE UPDATE ON "public"."institution_membership" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "institution_touch_updated_at" BEFORE UPDATE ON "public"."institution" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "question_touch_updated_at" BEFORE UPDATE ON "public"."question" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "rubric_criterion_max_score_consistency" BEFORE UPDATE OF "max_score" ON "public"."rubric_criterion" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_validate_criterion_max_score"();



CREATE OR REPLACE TRIGGER "rubric_criterion_touch_updated_at" BEFORE UPDATE ON "public"."rubric_criterion" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "rubric_level_score_within_criterion" BEFORE INSERT OR UPDATE OF "criterion_id", "owner_id", "score" ON "public"."rubric_level" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_validate_rubric_level_score"();



CREATE OR REPLACE TRIGGER "rubric_level_touch_updated_at" BEFORE UPDATE ON "public"."rubric_level" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "rubric_touch_updated_at" BEFORE UPDATE ON "public"."rubric" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "student_touch_updated_at" BEFORE UPDATE ON "public"."student" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "submission_answer_question_same_assessment" BEFORE INSERT OR UPDATE OF "submission_id", "question_id", "owner_id" ON "public"."submission_answer" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_validate_submission_answer_question"();



CREATE OR REPLACE TRIGGER "submission_answer_touch_updated_at" BEFORE UPDATE ON "public"."submission_answer" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "submission_question_same_assessment" BEFORE INSERT OR UPDATE OF "assessment_id", "question_id", "owner_id" ON "public"."submission" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_validate_submission_question"();



CREATE OR REPLACE TRIGGER "submission_touch_updated_at" BEFORE UPDATE ON "public"."submission" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_contact_message_admin_workflow" BEFORE INSERT OR UPDATE ON "public"."contact_message" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_contact_message_admin_workflow"();



CREATE OR REPLACE TRIGGER "trg_user_profile_guard_last_superadmin" BEFORE DELETE OR UPDATE OF "role", "status" ON "public"."user_profile" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_guard_last_superadmin"();



CREATE OR REPLACE TRIGGER "user_profile_touch_updated_at" BEFORE UPDATE ON "public"."user_profile" FOR EACH ROW EXECUTE FUNCTION "public"."maestria_touch_updated_at"();



ALTER TABLE ONLY "public"."ai_generation"
    ADD CONSTRAINT "core_aigeneration_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessment"
    ADD CONSTRAINT "core_assessment_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_event"
    ADD CONSTRAINT "core_auditevent_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."correction"
    ADD CONSTRAINT "core_correction_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."correction_criterion_result"
    ADD CONSTRAINT "core_correctioncriterionresult_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."correction_revision"
    ADD CONSTRAINT "core_correctionrevision_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course"
    ADD CONSTRAINT "core_course_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollment"
    ADD CONSTRAINT "core_enrollment_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question"
    ADD CONSTRAINT "core_question_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rubric"
    ADD CONSTRAINT "core_rubric_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rubric_criterion"
    ADD CONSTRAINT "core_rubriccriterion_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rubric_level"
    ADD CONSTRAINT "core_rubriclevel_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student"
    ADD CONSTRAINT "core_student_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission"
    ADD CONSTRAINT "core_submission_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_answer"
    ADD CONSTRAINT "core_submissionanswer_owner_auth_user_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_generation"
    ADD CONSTRAINT "fk_ai_assessment_owner" FOREIGN KEY ("assessment_id", "owner_id") REFERENCES "public"."assessment"("id", "owner_id");



ALTER TABLE ONLY "public"."ai_provider_config"
    ADD CONSTRAINT "fk_ai_provider_config_updated_by" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_generation"
    ADD CONSTRAINT "fk_ai_submission_owner" FOREIGN KEY ("submission_id", "owner_id") REFERENCES "public"."submission"("id", "owner_id");



ALTER TABLE ONLY "public"."submission_answer"
    ADD CONSTRAINT "fk_answer_question_owner" FOREIGN KEY ("question_id", "owner_id") REFERENCES "public"."question"("id", "owner_id");



ALTER TABLE ONLY "public"."submission_answer"
    ADD CONSTRAINT "fk_answer_submission_owner" FOREIGN KEY ("submission_id", "owner_id") REFERENCES "public"."submission"("id", "owner_id");



ALTER TABLE ONLY "public"."assessment"
    ADD CONSTRAINT "fk_assessment_course_owner" FOREIGN KEY ("course_id", "owner_id") REFERENCES "public"."course"("id", "owner_id");



ALTER TABLE ONLY "public"."audit_event"
    ADD CONSTRAINT "fk_audit_event_actor_user" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contact_message"
    ADD CONSTRAINT "fk_contact_message_assigned_admin" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contact_message"
    ADD CONSTRAINT "fk_contact_message_user" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."correction"
    ADD CONSTRAINT "fk_correction_rubric_owner" FOREIGN KEY ("rubric_id", "owner_id") REFERENCES "public"."rubric"("id", "owner_id");



ALTER TABLE ONLY "public"."correction"
    ADD CONSTRAINT "fk_correction_submission_owner" FOREIGN KEY ("submission_id", "owner_id") REFERENCES "public"."submission"("id", "owner_id");



ALTER TABLE ONLY "public"."enrollment"
    ADD CONSTRAINT "fk_enrollment_course_owner" FOREIGN KEY ("course_id", "owner_id") REFERENCES "public"."course"("id", "owner_id");



ALTER TABLE ONLY "public"."enrollment"
    ADD CONSTRAINT "fk_enrollment_student_owner" FOREIGN KEY ("student_id", "owner_id") REFERENCES "public"."student"("id", "owner_id");



ALTER TABLE ONLY "public"."institution_membership"
    ADD CONSTRAINT "fk_institution_membership_updated_by" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."institution"
    ADD CONSTRAINT "fk_institution_updated_by" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."question"
    ADD CONSTRAINT "fk_question_assessment_owner" FOREIGN KEY ("assessment_id", "owner_id") REFERENCES "public"."assessment"("id", "owner_id");



ALTER TABLE ONLY "public"."question"
    ADD CONSTRAINT "fk_question_rubric_owner" FOREIGN KEY ("rubric_id", "owner_id") REFERENCES "public"."rubric"("id", "owner_id");



ALTER TABLE ONLY "public"."rubric_criterion"
    ADD CONSTRAINT "fk_rc_rubric_owner" FOREIGN KEY ("rubric_id", "owner_id") REFERENCES "public"."rubric"("id", "owner_id");



ALTER TABLE ONLY "public"."correction_criterion_result"
    ADD CONSTRAINT "fk_result_correction_owner" FOREIGN KEY ("correction_id", "owner_id") REFERENCES "public"."correction"("id", "owner_id");



ALTER TABLE ONLY "public"."correction_criterion_result"
    ADD CONSTRAINT "fk_result_question_owner" FOREIGN KEY ("question_id", "owner_id") REFERENCES "public"."question"("id", "owner_id");



ALTER TABLE ONLY "public"."correction_revision"
    ADD CONSTRAINT "fk_revision_correction_owner" FOREIGN KEY ("correction_id", "owner_id") REFERENCES "public"."correction"("id", "owner_id");



ALTER TABLE ONLY "public"."rubric_level"
    ADD CONSTRAINT "fk_rl_criterion_owner" FOREIGN KEY ("criterion_id", "owner_id") REFERENCES "public"."rubric_criterion"("id", "owner_id");



ALTER TABLE ONLY "public"."submission"
    ADD CONSTRAINT "fk_submission_assessment_owner" FOREIGN KEY ("assessment_id", "owner_id") REFERENCES "public"."assessment"("id", "owner_id");



ALTER TABLE ONLY "public"."submission"
    ADD CONSTRAINT "fk_submission_question_owner" FOREIGN KEY ("question_id", "owner_id") REFERENCES "public"."question"("id", "owner_id");



ALTER TABLE ONLY "public"."submission"
    ADD CONSTRAINT "fk_submission_student_owner" FOREIGN KEY ("student_id", "owner_id") REFERENCES "public"."student"("id", "owner_id");



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "fk_user_profile_role_updated_by" FOREIGN KEY ("role_updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "fk_user_profile_suspended_by" FOREIGN KEY ("suspended_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."institution"
    ADD CONSTRAINT "institution_created_by_auth_user_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."institution_membership"
    ADD CONSTRAINT "institution_membership_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institution"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."institution_membership"
    ADD CONSTRAINT "institution_membership_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."institution_membership"
    ADD CONSTRAINT "institution_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student"
    ADD CONSTRAINT "student_account_auth_user_fk" FOREIGN KEY ("account_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profile"
    ADD CONSTRAINT "user_profile_auth_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."ai_generation" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_generation_owner_isolation" ON "public"."ai_generation" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."ai_provider_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assessment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessment_owner_isolation" ON "public"."assessment" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."audit_event" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_event_owner_read" ON "public"."audit_event" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."contact_message" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."correction" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."correction_criterion_result" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "correction_criterion_result_owner_isolation" ON "public"."correction_criterion_result" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "correction_owner_isolation" ON "public"."correction" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."correction_revision" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "correction_revision_owner_isolation" ON "public"."correction_revision" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."course" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "course_owner_isolation" ON "public"."course" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."django_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enrollment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "enrollment_owner_isolation" ON "public"."enrollment" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."institution" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "institution_creator_read" ON "public"."institution" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "created_by"));



ALTER TABLE "public"."institution_membership" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "institution_membership_self_read" ON "public"."institution_membership" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."question" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "question_owner_isolation" ON "public"."question" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."rubric" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubric_criterion" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rubric_criterion_owner_isolation" ON "public"."rubric_criterion" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."rubric_level" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rubric_level_owner_isolation" ON "public"."rubric_level" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "rubric_owner_isolation" ON "public"."rubric" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."student" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_owner_isolation" ON "public"."student" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."submission" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submission_answer" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "submission_answer_owner_isolation" ON "public"."submission_answer" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "submission_owner_isolation" ON "public"."submission" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



ALTER TABLE "public"."user_profile" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_profile_self_read" ON "public"."user_profile" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."maestria_sync_auth_user_profile"() FROM PUBLIC;





-- =============================================================================
-- Agregado a mano: objetos que pg_dump de `public` no incluye
-- =============================================================================

-- Triggers sobre auth.users: sincronizan public.user_profile con Supabase Auth.
DROP TRIGGER IF EXISTS maestria_auth_user_profile_insert ON auth.users;
CREATE TRIGGER maestria_auth_user_profile_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.maestria_sync_auth_user_profile();

DROP TRIGGER IF EXISTS maestria_auth_user_profile_update ON auth.users;
CREATE TRIGGER maestria_auth_user_profile_update
  AFTER UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.maestria_sync_auth_user_profile();

-- Permisos. En producción, anon, authenticated y service_role no tienen acceso
-- a `public`: todo pasa por Django con el rol postgres. Un proyecto Supabase
-- nuevo, en cambio, otorga esos permisos por defecto, así que se revocan acá.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.maestria_sync_auth_user_profile() FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;

COMMIT;
