-- Webhook delivery retry + DLQ
--
-- Adds state for automatic retries (attempt_count, max_attempts, next_retry_at)
-- and dead-letter queue (failed_permanently_at), plus two helper functions
-- used by the worker (atomic claim+lease) and the queue (attempt bump).

ALTER TABLE seller_main.webhook_logs
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_permanently_at timestamptz;

ALTER TABLE seller_main.webhook_logs DROP CONSTRAINT IF EXISTS webhook_logs_status_check;
ALTER TABLE seller_main.webhook_logs ADD CONSTRAINT webhook_logs_status_check
  CHECK (status IN ('success', 'failed', 'retried', 'archived', 'pending_retry', 'permanently_failed'));

CREATE INDEX IF NOT EXISTS idx_webhook_logs_pending_retry
  ON seller_main.webhook_logs (next_retry_at)
  WHERE status = 'pending_retry';

CREATE INDEX IF NOT EXISTS idx_webhook_logs_dlq
  ON seller_main.webhook_logs (failed_permanently_at DESC)
  WHERE status = 'permanently_failed';

CREATE OR REPLACE FUNCTION seller_main.pick_due_webhook_deliveries(p_limit int)
RETURNS TABLE (
  id uuid,
  endpoint_id uuid,
  event_type text,
  payload jsonb,
  attempt_count int,
  max_attempts int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease_until timestamptz := NOW() + interval '60 seconds';
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT wl.id
    FROM seller_main.webhook_logs wl
    WHERE wl.status = 'pending_retry'
      AND wl.next_retry_at IS NOT NULL
      AND wl.next_retry_at <= NOW()
    ORDER BY wl.next_retry_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  leased AS (
    UPDATE seller_main.webhook_logs wl
    SET next_retry_at = lease_until
    FROM due
    WHERE wl.id = due.id
    RETURNING wl.id, wl.endpoint_id, wl.event_type, wl.payload, wl.attempt_count, wl.max_attempts
  )
  SELECT leased.id, leased.endpoint_id, leased.event_type, leased.payload, leased.attempt_count, leased.max_attempts
  FROM leased;
END;
$$;

REVOKE EXECUTE ON FUNCTION seller_main.pick_due_webhook_deliveries(int) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION seller_main.pick_due_webhook_deliveries(int) TO service_role;

CREATE OR REPLACE FUNCTION seller_main.increment_webhook_attempt(
  p_log_id uuid,
  p_status text,
  p_http_status int,
  p_response_body text,
  p_error_message text,
  p_duration_ms int,
  p_next_retry_at timestamptz,
  p_failed_permanently_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE seller_main.webhook_logs
  SET
    status = p_status,
    http_status = p_http_status,
    response_body = p_response_body,
    error_message = p_error_message,
    duration_ms = p_duration_ms,
    attempt_count = attempt_count + 1,
    next_retry_at = p_next_retry_at,
    failed_permanently_at = p_failed_permanently_at
  WHERE id = p_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION seller_main.increment_webhook_attempt(uuid, text, int, text, text, int, timestamptz, timestamptz) FROM anon, authenticated, PUBLIC;
-- service_role only — SECURITY DEFINER + no ownership check inside.
GRANT EXECUTE ON FUNCTION seller_main.increment_webhook_attempt(uuid, text, int, text, text, int, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE VIEW public.webhook_logs WITH (security_invoker = on) AS
  SELECT * FROM seller_main.webhook_logs;

COMMENT ON COLUMN seller_main.webhook_logs.attempt_count IS 'Number of delivery attempts so far (1 = first attempt completed)';
COMMENT ON COLUMN seller_main.webhook_logs.max_attempts IS 'Maximum delivery attempts before going to DLQ';
COMMENT ON COLUMN seller_main.webhook_logs.next_retry_at IS 'When the worker should attempt next delivery (also used as in-flight lease)';
COMMENT ON COLUMN seller_main.webhook_logs.failed_permanently_at IS 'Set when delivery enters DLQ (status=permanently_failed)';
COMMENT ON FUNCTION seller_main.pick_due_webhook_deliveries(int) IS 'Atomically claims due retries with FOR UPDATE SKIP LOCKED + 60s lease';
COMMENT ON FUNCTION seller_main.increment_webhook_attempt(uuid, text, int, text, text, int, timestamptz, timestamptz) IS 'Bumps attempt_count and updates result fields in a single statement';
