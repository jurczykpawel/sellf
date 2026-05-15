-- Stripe fires checkout.session.completed (session_id=cs_xxx) AND
-- payment_intent.succeeded (session_id=pi_xxx) for one purchase. The first
-- one records the row keyed by cs_xxx + pi_xxx; the second call hit the
-- session_id-only idempotency check and tried to INSERT a second row,
-- crashing on unique_stripe_payment_intent_id. Wrap the impl with a
-- pre-resolve step that rewrites session_id_param to the existing row's
-- cs_xxx when the pi_xxx already lives there.

SET client_min_messages = warning;

ALTER FUNCTION seller_main.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) RENAME TO _process_stripe_payment_completion_with_bump_impl;

CREATE OR REPLACE FUNCTION seller_main.process_stripe_payment_completion_with_bump(
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
BEGIN
  IF stripe_payment_intent_id IS NOT NULL THEN
    SELECT pt.session_id INTO resolved_sid
      FROM seller_main.payment_transactions pt
     WHERE pt.stripe_payment_intent_id = process_stripe_payment_completion_with_bump.stripe_payment_intent_id
       AND pt.status <> 'pending'
       AND pt.session_id <> session_id_param
     LIMIT 1;

    IF resolved_sid IS NOT NULL THEN
      session_id_param := resolved_sid;
    END IF;
  END IF;

  RETURN seller_main._process_stripe_payment_completion_with_bump_impl(
    session_id_param,
    product_id_param,
    customer_email_param,
    amount_total,
    currency_param,
    stripe_payment_intent_id,
    user_id_param,
    bump_product_ids_param,
    coupon_id_param
  );
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion_with_bump(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) TO service_role;

REVOKE EXECUTE ON FUNCTION seller_main._process_stripe_payment_completion_with_bump_impl(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION seller_main._process_stripe_payment_completion_with_bump_impl(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID
) TO service_role;
