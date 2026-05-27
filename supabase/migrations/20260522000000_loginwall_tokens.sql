-- Single-use nonce store for the per-product login wall handoff.
-- The HMAC-signed handoff token carries (product_id, user_id, exp, nonce);
-- this table is the consumed-nonce ledger that makes each token usable once.

CREATE TABLE IF NOT EXISTS public.loginwall_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loginwall_tokens_active
  ON public.loginwall_tokens (user_id, product_id)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_loginwall_tokens_cleanup
  ON public.loginwall_tokens (expires_at);

ALTER TABLE public.loginwall_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON public.loginwall_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.loginwall_tokens FROM anon, authenticated;
GRANT ALL ON public.loginwall_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_loginwall_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.loginwall_tokens
  WHERE expires_at < now() - interval '1 day';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_loginwall_tokens() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_loginwall_tokens() TO service_role;

COMMENT ON FUNCTION public.cleanup_loginwall_tokens IS
  'Hourly maintenance: deletes login wall nonces older than 24h past expiry.';

SELECT cron.schedule(
  'cleanup-loginwall-tokens',
  '0 * * * *',
  'SELECT public.cleanup_loginwall_tokens();'
);
