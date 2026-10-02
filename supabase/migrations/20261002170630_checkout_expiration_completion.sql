-- Verified payment completion can resume an abandoned checkout transaction.

CREATE OR REPLACE FUNCTION public.process_stripe_payment_completion_with_bump(
  session_id_param text, product_id_param uuid, customer_email_param text,
  amount_total numeric, currency_param text,
  stripe_payment_intent_id text DEFAULT NULL, user_id_param uuid DEFAULT NULL,
  bump_product_ids_param uuid[] DEFAULT NULL, coupon_id_param uuid DEFAULT NULL,
  amount_subtotal_param numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  pi_param text := stripe_payment_intent_id;
  tx public.payment_transactions%ROWTYPE;
  result jsonb;
  full_bumps uuid[];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(coalesce(pi_param, session_id_param)));
  SELECT pt.* INTO tx FROM public.payment_transactions pt
    WHERE pt.session_id = session_id_param OR (pi_param IS NOT NULL AND pt.stripe_payment_intent_id = pi_param)
    ORDER BY (pt.session_id = session_id_param) DESC LIMIT 1 FOR UPDATE;

  IF tx.id IS NOT NULL THEN
    IF tx.product_id IS DISTINCT FROM product_id_param
       OR upper(tx.currency) IS DISTINCT FROM upper(currency_param)
       OR (tx.stripe_payment_intent_id IS NOT NULL AND tx.stripe_payment_intent_id IS DISTINCT FROM pi_param)
       OR (tx.session_id LIKE 'cs_%' AND session_id_param LIKE 'cs_%' AND tx.session_id <> session_id_param)
       OR tx.status NOT IN ('pending', 'abandoned', 'completed')
       OR (tx.status = 'completed' AND (tx.amount IS DISTINCT FROM amount_total OR lower(tx.customer_email) IS DISTINCT FROM lower(trim(customer_email_param))))
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'Order details do not match', 'error_kind', 'data');
    END IF;
    IF EXISTS (SELECT 1 FROM public.payment_transactions pt
      WHERE pt.id <> tx.id AND (pt.session_id = session_id_param OR pt.stripe_payment_intent_id = pi_param)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Order records need review', 'error_kind', 'data');
    END IF;
    IF tx.session_id LIKE 'cs_%' THEN session_id_param := tx.session_id; END IF;
    IF jsonb_typeof(tx.metadata->'bump_product_ids_full') = 'array' THEN
      SELECT array_agg(value::uuid) INTO full_bumps
        FROM jsonb_array_elements_text(tx.metadata->'bump_product_ids_full');
      IF coalesce(cardinality(full_bumps), 0) > coalesce(cardinality(bump_product_ids_param), 0) THEN
        bump_product_ids_param := full_bumps;
      END IF;
    END IF;
  END IF;

  -- Attach the order and complete it within one savepoint.
  BEGIN
    IF tx.id IS NOT NULL THEN
      UPDATE public.payment_transactions SET
        stripe_payment_intent_id = coalesce(pi_param, tx.stripe_payment_intent_id),
        session_id = session_id_param,
        status = CASE WHEN status = 'abandoned' THEN 'pending' ELSE status END,
        amount = CASE WHEN status IN ('pending', 'abandoned') THEN amount_total ELSE amount END,
        currency = upper(currency_param)
      WHERE id = tx.id;
      IF tx.session_id <> session_id_param THEN
        UPDATE public.guest_purchases SET session_id = session_id_param
        WHERE session_id = tx.session_id AND product_id = tx.product_id;
      END IF;
    END IF;
    result := public._process_stripe_payment_completion_with_bump_impl(
      session_id_param, product_id_param, lower(trim(customer_email_param)), amount_total,
      currency_param, pi_param, user_id_param, bump_product_ids_param, coupon_id_param, amount_subtotal_param
    );
    IF NOT coalesce((result->>'success')::boolean, false) THEN
      RAISE EXCEPTION USING MESSAGE = 'Completion not accepted', DETAIL = result::text;
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Completion not accepted' THEN
      GET STACKED DIAGNOSTICS result = PG_EXCEPTION_DETAIL;
      RETURN result::jsonb || jsonb_build_object('error_kind', CASE WHEN result->>'error' = 'Rate limit exceeded' OR result->>'code' IN ('40001','40P01','57014') THEN 'transient' ELSE 'data' END);
    END IF;
    RAISE;
  END;

  SELECT pt.* INTO tx FROM public.payment_transactions pt WHERE pt.session_id = session_id_param;
  IF result->>'message' = 'Payment already processed (idempotent)'
     OR result->>'scenario' = 'idempotent_claimed_for_logged_in_user' THEN
    result := result || jsonb_build_object('already_had_access', true);
  END IF;
  RETURN result || jsonb_build_object('transaction_id', tx.id, 'session_id', tx.session_id,
    'bump_product_ids', coalesce(bump_product_ids_param, '{}'::uuid[]));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric) TO service_role;
