-- Durable retry for purchase mails delivered through Supabase Auth (W147-8, W147-9).
-- The post-payment login link and the free-license key mail both go out as auth OTP mails. When
-- the auth mailer refuses (hourly send limit, per-user cooldown, transient failure) the buyer used to
-- get nothing and nothing retried. A refused send is parked here and the minute cron retries it
-- with backoff; the row is deleted once delivered. One pending row per (email, redirect), so a page
-- reload cannot multiply mails. Service role only: rows can carry a license key until delivered.

CREATE TABLE public.auth_mail_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  redirect_to text NOT NULL CHECK (length(redirect_to) BETWEEN 1 AND 2048),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 8192),
  kind text NOT NULL CHECK (kind IN ('post_checkout', 'license')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 40),
  given_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, redirect_to)
);
CREATE INDEX auth_mail_retries_due ON public.auth_mail_retries (next_attempt_at) WHERE given_up_at IS NULL;
ALTER TABLE public.auth_mail_retries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.auth_mail_retries FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.auth_mail_retries FROM anon, authenticated;
GRANT ALL ON public.auth_mail_retries TO service_role;

-- Parks a refused mail. A repeat for the same destination refreshes the payload but keeps the
-- attempt count and does not pull the next attempt earlier.
CREATE FUNCTION public.queue_auth_mail_retry(p_email text, p_redirect_to text, p_data jsonb, p_kind text, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.auth_mail_retries(email, redirect_to, data, kind, next_attempt_at, last_error)
  VALUES (lower(btrim(p_email)), p_redirect_to, coalesce(p_data, '{}'::jsonb), p_kind, now() + interval '2 minutes', left(p_error, 40))
  ON CONFLICT (email, redirect_to) DO UPDATE SET data = EXCLUDED.data, last_error = EXCLUDED.last_error,
    given_up_at = NULL, attempts = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.attempts ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) TO service_role;

-- Claims due rows for one worker: bumps attempts and leases them for 10 minutes, so a parallel
-- cron run skips them (SKIP LOCKED) and a crashed run retries later. Old given-up rows are purged.
CREATE FUNCTION public.claim_auth_mail_retries(p_limit integer DEFAULT 20)
RETURNS SETOF public.auth_mail_retries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.auth_mail_retries WHERE given_up_at < now() - interval '7 days';
  RETURN QUERY
  UPDATE public.auth_mail_retries r SET attempts = r.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE r.id IN (SELECT q.id FROM public.auth_mail_retries q WHERE q.given_up_at IS NULL AND q.next_attempt_at <= now()
    ORDER BY q.next_attempt_at LIMIT least(greatest(coalesce(p_limit, 20), 1), 100) FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_auth_mail_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) TO service_role;
