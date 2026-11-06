-- MaestrIA v1.0.9: align provider-config timeout with the 85s AI adapter cap.
-- Apply once to the existing Supabase/PostgreSQL project before configuring longer timeouts.
ALTER TABLE public.ai_provider_config
  ALTER COLUMN timeout_seconds SET DEFAULT 60;

ALTER TABLE public.ai_provider_config
  DROP CONSTRAINT IF EXISTS ai_provider_timeout_range,
  ADD CONSTRAINT ai_provider_timeout_range
    CHECK (timeout_seconds >= 5 AND timeout_seconds <= 85);
