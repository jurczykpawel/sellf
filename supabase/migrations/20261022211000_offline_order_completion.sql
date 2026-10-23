-- Transfers complete under a row lock and reuse the saved order's completion tail.
CREATE FUNCTION public.complete_offline_order(p_transaction_id uuid, p_paid_minor numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  buyer uuid;
  existing_buyer uuid;
  result jsonb;
BEGIN
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF tx.id IS NULL OR tx.payment_provider = 'stripe' OR tx.pricing_snapshot_version IS NULL
    OR tx.status NOT IN ('awaiting_payment','completed') OR p_paid_minor IS DISTINCT FROM tx.amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order details do not match', 'error_kind', 'data');
  END IF;
  IF tx.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'already_had_access', true,
      'pricing_source', 'snapshot', 'message', 'Payment already processed (idempotent)');
  END IF;
  SELECT id INTO existing_buyer FROM auth.users
    WHERE email = tx.customer_email AND email_confirmed_at IS NOT NULL;
  SELECT id INTO buyer FROM auth.users WHERE id = tx.user_id AND email_confirmed_at IS NOT NULL;
  buyer := coalesce(buyer, existing_buyer);
  UPDATE public.payment_transactions SET status = 'completed', fulfillment_pending = true,
    user_id = buyer, updated_at = now() WHERE id = tx.id;
  result := public._order_grant_and_record(tx.id, buyer, existing_buyer, tx.user_id,
    tx.coupon_id, 'already_redeemed');
  RETURN result || jsonb_build_object('transaction_id', tx.id, 'pricing_source', 'snapshot');
END;
$$;
REVOKE ALL ON FUNCTION public.complete_offline_order(uuid,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_offline_order(uuid,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_guest_purchases_for_user(
  p_user_id UUID
) RETURNS json AS $$
DECLARE
  user_email_var TEXT;
  claimed_count INTEGER := 0;
  guest_purchase_record RECORD;
  line_item_rec RECORD;
BEGIN
  IF NOT public.check_rate_limit('claim_guest_purchases_for_user', 10, 3600) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Rate limit exceeded. Please wait before trying again.'
    );
  END IF;

  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User ID is required');
  END IF;

  SELECT email INTO user_email_var FROM auth.users WHERE id = p_user_id AND email_confirmed_at IS NOT NULL;

  IF user_email_var IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  IF NOT public.validate_email_format(user_email_var) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email format');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(user_email_var));

  FOR guest_purchase_record IN
    SELECT gp.id, gp.product_id, gp.session_id, pt.id as transaction_id
    FROM public.guest_purchases gp
    LEFT JOIN public.payment_transactions pt ON pt.id = gp.transaction_id
      OR (gp.transaction_id IS NULL AND pt.session_id = gp.session_id)
    WHERE gp.customer_email = user_email_var
      AND gp.claimed_by_user_id IS NULL
    FOR UPDATE OF gp SKIP LOCKED
  LOOP
    UPDATE public.guest_purchases
    SET claimed_by_user_id = p_user_id, claimed_at = NOW()
    WHERE id = guest_purchase_record.id;

    BEGIN
      DECLARE
        grant_result JSONB;
      BEGIN
        SELECT public.grant_product_and_bundle_components(p_user_id, guest_purchase_record.product_id) INTO grant_result;

        IF (grant_result->>'success')::boolean = true THEN
          claimed_count := claimed_count + 1;

          UPDATE public.payment_transactions
          SET user_id = p_user_id,
              updated_at = NOW()
          WHERE id = guest_purchase_record.transaction_id
            AND user_id IS NULL;
        ELSE
          IF (grant_result->>'retry_exceeded')::boolean = true THEN
            PERFORM public.log_admin_action(
              'guest_claim_concurrency_failure', 'guest_purchases',
              guest_purchase_record.id::TEXT,
              jsonb_build_object(
                'severity', 'WARNING', 'error_type', 'optimistic_lock_retry_exceeded',
                'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
                'guest_purchase_id', guest_purchase_record.id, 'grant_result', grant_result,
                'function_name', 'claim_guest_purchases_for_user'
              )
            );
          ELSE
            PERFORM public.log_admin_action(
              'guest_claim_grant_failure', 'guest_purchases',
              guest_purchase_record.id::TEXT,
              jsonb_build_object(
                'severity', 'ERROR', 'error_type', 'access_grant_failure',
                'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
                'guest_purchase_id', guest_purchase_record.id, 'grant_result', grant_result,
                'function_name', 'claim_guest_purchases_for_user'
              )
            );
          END IF;

          UPDATE public.guest_purchases
          SET claimed_by_user_id = NULL, claimed_at = NULL
          WHERE id = guest_purchase_record.id;
        END IF;
      END;
    EXCEPTION
      WHEN OTHERS THEN
        PERFORM public.log_admin_action(
          'critical_guest_claim_failure', 'guest_purchases',
          guest_purchase_record.id::TEXT,
          jsonb_build_object(
            'severity', 'CRITICAL', 'error_type', 'guest_claim_exception',
            'error_code', SQLSTATE, 'error_message', SQLERRM,
            'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
            'guest_purchase_id', guest_purchase_record.id,
            'function_name', 'claim_guest_purchases_for_user'
          )
        );
        UPDATE public.guest_purchases
        SET claimed_by_user_id = NULL, claimed_at = NULL
        WHERE id = guest_purchase_record.id;
        NULL;
    END;

    IF guest_purchase_record.transaction_id IS NOT NULL THEN
      FOR line_item_rec IN
        SELECT pli.product_id, pli.access_duration_override
        FROM public.payment_line_items pli
        WHERE pli.transaction_id = guest_purchase_record.transaction_id
          AND pli.item_type = 'order_bump'
      LOOP
        BEGIN
          PERFORM public.grant_product_access_service_role(
            p_user_id,
            line_item_rec.product_id,
            override_duration_days_param => line_item_rec.access_duration_override
          );
          claimed_count := claimed_count + 1;
        EXCEPTION WHEN OTHERS THEN
          PERFORM public.log_admin_action(
            'guest_claim_bump_failure', 'payment_line_items',
            guest_purchase_record.transaction_id::TEXT,
            jsonb_build_object(
              'severity', 'ERROR', 'error_type', 'bump_access_grant_failure',
              'user_id', p_user_id, 'product_id', line_item_rec.product_id,
              'transaction_id', guest_purchase_record.transaction_id,
              'function_name', 'claim_guest_purchases_for_user'
            )
          );
          NULL;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'claimed_count', claimed_count,
    'user_email', user_email_var
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

REVOKE ALL ON FUNCTION public.claim_guest_purchases_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(uuid) TO service_role;
