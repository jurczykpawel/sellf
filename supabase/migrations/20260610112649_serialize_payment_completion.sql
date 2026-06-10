-- Serialize concurrent completion of the same purchase and make the proxy's
-- result consistent for idempotent re-entries. The public proxy is the single
-- entry point for every caller (Stripe webhook + payment verification): an
-- xact-scoped advisory lock on the stable payment-intent key makes the
-- downstream idempotency check authoritative, and we stamp already_had_access
-- onto idempotent re-entries that omit it so callers can rely on it to avoid
-- repeating side-effects. _process_stripe_payment_completion_with_bump_impl is
-- NOT modified.
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
