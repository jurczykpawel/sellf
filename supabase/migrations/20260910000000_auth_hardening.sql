-- Single-use ledger for solved captcha payloads, plus a fix to the
-- application rate limiter so windows longer than an hour behave correctly.

-- ===== Captcha nonce ledger =====

CREATE TABLE IF NOT EXISTS public.captcha_nonces (
  nonce_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_captcha_nonces_cleanup
  ON public.captcha_nonces (expires_at);

ALTER TABLE public.captcha_nonces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON public.captcha_nonces
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.captcha_nonces FROM anon, authenticated;
GRANT ALL ON public.captcha_nonces TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_captcha_nonces()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.captcha_nonces
  WHERE expires_at < now() - interval '1 day';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_captcha_nonces() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_captcha_nonces() TO service_role;

COMMENT ON FUNCTION public.cleanup_captcha_nonces IS
  'Hourly maintenance: deletes consumed captcha nonces older than 24h past expiry.';

SELECT cron.schedule(
  'cleanup-captcha-nonces',
  '0 * * * *',
  'SELECT public.cleanup_captcha_nonces();'
);

-- ===== Fix application rate limit window alignment =====
--
-- The previous implementation rounded down to the top of the current hour,
-- then added a window-sized offset computed from minutes-since-hour-start.
-- For any window_minutes > 60 that offset is always 0 (minutes-since-hour-start
-- is at most 59), so every window collapsed to a fixed 1-hour bucket. Epoch
-- alignment makes every window size behave the same way.

CREATE OR REPLACE FUNCTION check_application_rate_limit(
  identifier_param TEXT,
  action_type_param TEXT,
  max_requests INTEGER,
  window_minutes INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  window_start_param TIMESTAMPTZ;
  current_count INTEGER;
BEGIN
  -- Input validation
  IF identifier_param IS NULL OR length(identifier_param) = 0 OR length(identifier_param) > 200 THEN
    RETURN FALSE;
  END IF;

  IF action_type_param IS NULL OR length(action_type_param) = 0 OR length(action_type_param) > 100 THEN
    RETURN FALSE;
  END IF;

  IF window_minutes IS NULL OR window_minutes < 1 OR window_minutes > 10080 THEN
    RETURN FALSE;
  END IF;

  -- Calculate window start (round down to an epoch-aligned window boundary,
  -- so windows longer than 60 minutes stay correctly sized).
  window_start_param := to_timestamp(
    floor(extract(epoch FROM now()) / (window_minutes * 60)) * (window_minutes * 60)
  );

  -- Try to increment existing record or insert new one
  INSERT INTO public.application_rate_limits (identifier, action_type, window_start, call_count)
  VALUES (identifier_param, action_type_param, window_start_param, 1)
  ON CONFLICT (identifier, action_type, window_start)
  DO UPDATE SET
    call_count = public.application_rate_limits.call_count + 1,
    updated_at = NOW()
  RETURNING public.application_rate_limits.call_count INTO current_count;

  -- Check if we're over the limit
  RETURN current_count <= max_requests;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION check_application_rate_limit IS
  'Application-level rate limiting for Next.js API routes. Use this from /lib/rate-limiting.ts. Windows are epoch-aligned so sizes > 60 minutes work correctly.';

-- ===== Fresh-install grants must match production least privilege =====
--
-- A database built purely from migrations inherits the platform's default
-- privileges, which on some Supabase builds give anon/authenticated TRUNCATE,
-- TRIGGER and REFERENCES on every table created by postgres (TRUNCATE is not
-- subject to RLS). Production never had these. Revoke them on existing tables
-- and stop them from being granted to future tables. No-op on production.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated',
      t.relname
    );
  END LOOP;
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

-- The free-product claim RPC lost its authenticated grant on fresh installs:
-- a later REVOKE ... FROM PUBLIC removed the only path authenticated had.
-- Production still has it; make the intended grant explicit.
GRANT EXECUTE ON FUNCTION public.grant_free_product_access(text, integer, text) TO authenticated;
