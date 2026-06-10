-- Webhook payload customization (Pro) + purchase-completion single writer.
-- Consolidated migration for the whole feature:
--   1. Single-writer + idempotent-result normalization on the payment proxy.
--   2. webhook_endpoints customization columns (headers / fields / selection).
--   3. webhook_logs delivery key (dedup safeguard).

-- ============================================================================
-- 1. Single writer: serialize concurrent completion of the same purchase and
--    make the proxy's result consistent for idempotent re-entries.
--    The public proxy is the single entry point for every caller (Stripe
--    webhook + payment verification): an xact-scoped advisory lock on the
--    stable payment-intent key makes the downstream idempotency check
--    authoritative, and we stamp already_had_access onto idempotent re-entries
--    that omit it so callers can rely on it to avoid repeating side-effects.
--    _process_stripe_payment_completion_with_bump_impl is NOT modified.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_stripe_payment_completion_with_bump(
  session_id_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT,
  amount_total NUMERIC,
  currency_param TEXT,
  stripe_payment_intent_id TEXT DEFAULT NULL,
  user_id_param UUID DEFAULT NULL,
  bump_product_ids_param UUID[] DEFAULT NULL,
  coupon_id_param UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  resolved_sid TEXT;
  pi_param TEXT := stripe_payment_intent_id;
  result JSONB;
BEGIN
  -- One writer per purchase: serialize on the payment-intent (shared by the
  -- cs_/pi_ events and verification); fall back to session id when absent.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(coalesce(pi_param, session_id_param))
  );

  IF pi_param IS NOT NULL THEN
    SELECT pt.session_id INTO resolved_sid
      FROM public.payment_transactions pt
     WHERE pt.stripe_payment_intent_id = pi_param
       AND pt.status <> 'pending'
       AND pt.session_id <> session_id_param
     LIMIT 1;

    IF resolved_sid IS NOT NULL THEN
      session_id_param := resolved_sid;
    END IF;
  END IF;

  result := public._process_stripe_payment_completion_with_bump_impl(
    session_id_param, product_id_param, customer_email_param, amount_total,
    currency_param, stripe_payment_intent_id, user_id_param,
    bump_product_ids_param, coupon_id_param
  );

  -- Some idempotent re-entry branches in the impl omit already_had_access
  -- (guest re-entry carries the idempotent message; the claimed-logged-in
  -- branch carries only its scenario). Stamp it so callers consistently skip
  -- duplicate side-effects on a second completion of the same purchase.
  IF (result->>'message') = 'Payment already processed (idempotent)'
     OR (result->>'scenario') = 'idempotent_claimed_for_logged_in_user' THEN
    result := result || jsonb_build_object('already_had_access', true);
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) TO service_role;
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) FROM anon, authenticated, PUBLIC;

-- ============================================================================
-- 2. Webhook endpoint payload customization columns.
--    Optional per-endpoint payload shaping. NULL on every existing row
--    preserves today's exact webhook behavior. Columns inherit the table's
--    existing RLS.
-- ============================================================================
ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS custom_headers_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS custom_payload_fields    JSONB,
  ADD COLUMN IF NOT EXISTS payload_field_selection  JSONB;

COMMENT ON COLUMN public.webhook_endpoints.custom_headers_encrypted IS
  'Encrypted JSON map of extra request headers (e.g. Authorization). Decrypted service-role only at send time.';
COMMENT ON COLUMN public.webhook_endpoints.custom_payload_fields IS
  'Extra top-level body fields; string leaves may contain {{placeholder}} tokens.';
COMMENT ON COLUMN public.webhook_endpoints.payload_field_selection IS
  'Whitelist (string[]) of standard data.* keys to include; NULL = all.';

-- ============================================================================
-- 3. Webhook delivery key (defense-in-depth dedup safeguard).
--    One first-attempt row per logical delivery; retries update in place, and
--    the legacy manual retry leaves delivery_key NULL, so a partial unique
--    index is safe.
-- ============================================================================
ALTER TABLE public.webhook_logs ADD COLUMN IF NOT EXISTS delivery_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS webhook_logs_delivery_key_uniq
  ON public.webhook_logs (delivery_key) WHERE delivery_key IS NOT NULL;
