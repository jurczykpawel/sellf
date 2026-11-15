-- Sellf 2026.11.1: queue retries (W252c).
--
-- 1. Abandoned license mails can be resumed. A repeated license grant puts a given-up
--    auth_mail_retries row back in the queue (application side). When the worker purges a
--    given-up row after seven days it now also forgets the mail's receipt, so a later grant
--    sends the key again instead of treating the never-delivered mail as sent.
--
-- 2. Business events that keep failing no longer starve new ones. Each claim counts an
--    attempt; a failed attempt waits with a growing interval (next_attempt_at) and after
--    eight attempts the event is abandoned: it stays visible in the admin panel (webhook
--    deliveries) and can be retried from there. The queue is ordered by next_attempt_at, so a
--    new event goes ahead of events that are waiting out their backoff. Measured before the fix
--    (report W252b, point 5): with 120 permanently failing events and a cron tick every 62 s a
--    new event was never dispatched, because every tick re-claimed the same 100 oldest events.
--
-- Service role only, as before: no table or function is reachable by anon or authenticated.

-- ===== 1. License mail receipts follow purged given-up retries =====

CREATE OR REPLACE FUNCTION public.claim_auth_mail_retries(p_limit integer DEFAULT 20)
RETURNS SETOF public.auth_mail_retries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A purged license mail was never delivered: dropping its receipt lets a repeated grant send it again.
  WITH purged AS (
    DELETE FROM public.auth_mail_retries WHERE given_up_at < now() - interval '7 days' RETURNING license_mail_key
  )
  DELETE FROM public.license_mail_receipts r USING purged p WHERE r.mail_key = p.license_mail_key;
  RETURN QUERY
  UPDATE public.auth_mail_retries r SET attempts = r.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE r.id IN (SELECT q.id FROM public.auth_mail_retries q WHERE q.given_up_at IS NULL AND q.next_attempt_at <= now()
    ORDER BY q.next_attempt_at LIMIT least(greatest(coalesce(p_limit, 20), 1), 100) FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_auth_mail_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) TO service_role;
