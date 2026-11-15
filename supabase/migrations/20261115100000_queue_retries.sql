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

-- ===== 2. Business event attempts, backoff and abandonment =====

ALTER TABLE public.business_events
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_error text CHECK (last_error IS NULL OR length(last_error) <= 200),
  ADD COLUMN abandoned_at timestamptz;

-- Backfill: pending events keep their original order (oldest first); delivered ones are never read again.
UPDATE public.business_events SET next_attempt_at = created_at WHERE dispatched_at IS NULL;

DROP INDEX IF EXISTS public.business_events_pending_idx;
CREATE INDEX business_events_due_idx ON public.business_events (next_attempt_at, created_at, id)
  WHERE dispatched_at IS NULL AND abandoned_at IS NULL;
CREATE INDEX business_events_abandoned_idx ON public.business_events (abandoned_at DESC)
  WHERE dispatched_at IS NULL AND abandoned_at IS NOT NULL;

-- Claims due events for one worker. The one-minute lease still keeps a parallel run away; an
-- event whose attempts ran out without a recorded failure (worker crashed mid-delivery) is
-- abandoned here instead of being claimed forever.
-- Contract for callers: every claimed event must be delivered or recorded with
-- fail_business_event in the same run, whatever happened before the claim (W252cr P2: a failed
-- detection step used to end the run and let claimed events expire into abandonment).
CREATE OR REPLACE FUNCTION public.claim_business_events(p_limit integer DEFAULT 100) RETURNS SETOF public.business_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.business_events SET abandoned_at = now(), last_error = coalesce(last_error, 'lease_expired')
  WHERE dispatched_at IS NULL AND abandoned_at IS NULL AND attempts >= 8 AND (leased_until IS NULL OR leased_until < now());
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.business_events
    WHERE dispatched_at IS NULL AND abandoned_at IS NULL AND next_attempt_at <= now()
      AND (leased_until IS NULL OR leased_until < now())
    ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT greatest(1, least(coalesce(p_limit, 100), 100))
  ),
  leased AS (
    UPDATE public.business_events b SET leased_until = now() + interval '1 minute', attempts = b.attempts + 1
    FROM picked WHERE b.id = picked.id RETURNING b.*
  )
  SELECT * FROM leased ORDER BY next_attempt_at, created_at, id;
END $$;
REVOKE ALL ON FUNCTION public.claim_business_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_business_events(integer) TO service_role;

-- Records a failed attempt: waits 1, 5, 15, 30, 60, 120, 240 minutes after attempts 1-7 and
-- abandons the event after the eighth. Returns true when the event was abandoned.
CREATE FUNCTION public.fail_business_event(p_id uuid, p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  backoff constant integer[] := ARRAY[1, 5, 15, 30, 60, 120, 240];
  done integer;
BEGIN
  UPDATE public.business_events SET
    leased_until = NULL,
    last_error = left(coalesce(nullif(btrim(p_error), ''), 'delivery_failed'), 200),
    abandoned_at = CASE WHEN attempts >= 8 THEN now() ELSE NULL END,
    next_attempt_at = CASE WHEN attempts >= 8 THEN next_attempt_at
      ELSE now() + make_interval(mins => backoff[least(greatest(attempts, 1), 7)]) END
  WHERE id = p_id AND dispatched_at IS NULL AND abandoned_at IS NULL
  RETURNING attempts INTO done;
  RETURN coalesce(done >= 8, false);
END $$;
REVOKE ALL ON FUNCTION public.fail_business_event(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_business_event(uuid, text) TO service_role;

-- An admin's retry of an abandoned event: fresh attempts, due on the next worker tick.
CREATE FUNCTION public.retry_business_event(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.business_events SET abandoned_at = NULL, attempts = 0, next_attempt_at = now(), leased_until = NULL, last_error = NULL
  WHERE id = p_id AND dispatched_at IS NULL AND abandoned_at IS NOT NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.retry_business_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_business_event(uuid) TO service_role;
