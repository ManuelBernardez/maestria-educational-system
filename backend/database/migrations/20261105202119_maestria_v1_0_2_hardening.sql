-- Applied to the connected Supabase project as migration
-- 20261105202119 / maestria_v1_0_2_hardening.
-- No table data is deleted or rewritten by this migration.

ALTER TABLE public.ai_provider_config
  ALTER COLUMN timeout_seconds SET DEFAULT 18;

ALTER TABLE public.ai_provider_config
  DROP CONSTRAINT IF EXISTS ai_provider_timeout_range,
  ADD CONSTRAINT ai_provider_timeout_range
    CHECK (timeout_seconds >= 5 AND timeout_seconds <= 18);

-- Fix search_path for trigger functions to avoid objects being resolved from
-- an attacker-controlled schema. Function bodies use fully-qualified public.*
-- names where needed; pg_catalog remains first.
ALTER FUNCTION public.maestria_touch_updated_at()
  SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.maestria_validate_submission_question()
  SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.maestria_validate_submission_answer_question()
  SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.maestria_validate_correction_result_question()
  SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.maestria_validate_rubric_level_score()
  SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.maestria_validate_criterion_max_score()
  SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.maestria_guard_last_superadmin()
  SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public.maestria_contact_message_admin_workflow()
  SET search_path TO pg_catalog, public, pg_temp;

-- This SECURITY DEFINER function is an auth.users trigger function, not an RPC.
-- PostgreSQL checks EXECUTE permission when the trigger is created; callers
-- should not be able to invoke the function directly through PostgREST.
-- Its own search_path remains empty and all table references are qualified.
REVOKE EXECUTE ON FUNCTION public.maestria_sync_auth_user_profile()
  FROM PUBLIC, anon, authenticated;
