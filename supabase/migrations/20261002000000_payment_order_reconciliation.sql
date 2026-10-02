-- Canonical order reconciliation and durable outbound delivery claims.

ALTER TABLE public.payment_transactions
  ADD COLUMN fulfillment_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public._process_stripe_payment_completion_with_bump_impl(
  session_id_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT,
  amount_total NUMERIC,
  currency_param TEXT,
  stripe_payment_intent_id TEXT DEFAULT NULL,
  user_id_param UUID DEFAULT NULL,
  bump_product_ids_param UUID[] DEFAULT NULL,
  coupon_id_param UUID DEFAULT NULL,
  amount_subtotal_param NUMERIC DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  pi_param TEXT := stripe_payment_intent_id;
  current_user_id UUID;
  product_record RECORD;
  existing_user_id UUID;
  access_expires_at TIMESTAMPTZ := NULL;
  transaction_id_var UUID;
  pending_transaction_id UUID;
  bump_rec RECORD;
  total_bump_price NUMERIC := 0;
  bump_count INTEGER := 0;
  bump_ids_found UUID[] := '{}';
  main_line_item_price NUMERIC := 0;
  effective_unit_price NUMERIC := 0;
  existing_transaction_id UUID;
  caller_email TEXT;
  charge_basis NUMERIC := 0;  -- net for net-priced products, else gross
BEGIN
  IF NOT public.check_rate_limit('process_stripe_payment_completion', 100, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded');
  END IF;

  IF session_id_param IS NULL OR length(session_id_param) = 0 OR length(session_id_param) > 255 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID');
  END IF;

  IF NOT (session_id_param ~* '^(cs_|pi_)[a-zA-Z0-9_]+$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID format');
  END IF;

  IF product_id_param IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product ID is required');
  END IF;

  IF NOT public.validate_email_format(customer_email_param) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid email address is required');
  END IF;

  IF amount_total IS NULL OR amount_total <= 0 OR amount_total > 99999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  IF user_id_param IS NOT NULL THEN
    IF (select auth.role()) = 'service_role' THEN
      current_user_id := user_id_param;
    ELSIF auth.uid() = user_id_param THEN
      current_user_id := user_id_param;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
  ELSE
    current_user_id := NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE session_id = session_id_param AND status != 'pending') THEN
    IF current_user_id IS NOT NULL THEN
      SELECT email INTO caller_email FROM auth.users WHERE id = current_user_id;
      IF caller_email IS NOT NULL AND lower(caller_email) = lower(customer_email_param) THEN
        SELECT id INTO existing_transaction_id
        FROM public.payment_transactions
        WHERE session_id = session_id_param
        LIMIT 1;

        IF EXISTS (
          SELECT 1 FROM public.guest_purchases
          WHERE session_id = session_id_param AND claimed_by_user_id IS NULL
        ) THEN
          -- Bundle-aware grant: this branch stamps guest_purchases.claimed_by_user_id and
          -- returns, so the later claim_guest_purchases_for_user (filters claimed_by_user_id
          -- IS NULL) is permanently skipped. Use the primitive so a logged-in user claiming a
          -- guest BUNDLE purchase here receives every component, not just the bundle product.
          PERFORM public.grant_product_and_bundle_components(current_user_id, product_id_param);

          FOR bump_rec IN
            SELECT pli.product_id, pli.access_duration_override
            FROM public.payment_line_items pli
            WHERE pli.transaction_id = existing_transaction_id
              AND pli.item_type = 'order_bump'
          LOOP
            PERFORM public.grant_product_access_service_role(
              current_user_id,
              bump_rec.product_id,
              override_duration_days_param => bump_rec.access_duration_override
            );
          END LOOP;

          UPDATE public.guest_purchases
          SET claimed_by_user_id = current_user_id,
              claimed_at = NOW()
          WHERE session_id = session_id_param;

          UPDATE public.payment_transactions
          SET user_id = current_user_id,
              updated_at = NOW()
          WHERE id = existing_transaction_id AND user_id IS NULL;

          RETURN jsonb_build_object(
            'success', true,
            'scenario', 'idempotent_claimed_for_logged_in_user',
            'access_granted', true,
            'is_guest_purchase', false,
            'send_magic_link', false,
            'requires_login', false,
            'customer_email', customer_email_param
          );
        END IF;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.guest_purchases WHERE session_id = session_id_param AND claimed_by_user_id IS NULL) THEN
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param,
        'message', 'Payment already processed (idempotent)'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'already_processed_idempotent',
        'access_granted', true,
        'already_had_access', true,
        'message', 'Payment already processed (idempotent)'
      );
    END IF;
  END IF;

  SELECT id, name, auto_grant_duration_days, price, currency, allow_custom_price, custom_price_min,
         sale_price, sale_price_until, sale_quantity_limit, sale_quantity_sold, price_includes_vat INTO product_record
  FROM public.products
  WHERE id = product_id_param AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  IF product_record.currency IS NOT NULL THEN
    IF upper(currency_param) != upper(product_record.currency) THEN
      RAISE EXCEPTION 'Currency mismatch: expected %, got %',
        product_record.currency, currency_param;
    END IF;
  END IF;

  -- Effective unit price = active sale price (Omnibus) when running, else regular.
  effective_unit_price := CASE
    WHEN public.is_sale_price_active(
           product_record.sale_price,
           product_record.sale_price_until,
           product_record.sale_quantity_limit,
           product_record.sale_quantity_sold)
    THEN product_record.sale_price
    ELSE product_record.price
  END;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many bump products (max 20)');
  END IF;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 0 THEN
    FOR bump_rec IN
      SELECT
        p.id,
        p.name,
        ob.id as order_bump_id,
        COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as auto_grant_duration_days,
        COALESCE(ob.bump_price, p.price) as price,
        p.currency
      FROM unnest(bump_product_ids_param) AS bid(id)
      JOIN public.products p ON p.id = bid.id
      JOIN public.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
      WHERE p.is_active = true
        AND ob.is_active = true
    LOOP
      total_bump_price := total_bump_price + bump_rec.price;
      bump_count := bump_count + 1;
      bump_ids_found := array_append(bump_ids_found, bump_rec.id);
    END LOOP;
  END IF;

  -- Validation basis: NET (amount_subtotal_param) for net-priced (exclusive) products,
  -- else GROSS (amount_total). Stripe charges net+VAT for exclusive pricing and the gross
  -- varies by jurisdiction/reverse-charge under Stripe Tax, so the invariant to validate is
  -- the NET subtotal; for inclusive (brutto) pricing the GROSS is the invariant. Callers pass
  -- amount_subtotal_param (Stripe session.amount_subtotal); NULL keeps the legacy gross check.
  charge_basis := CASE
    WHEN COALESCE(product_record.price_includes_vat, false) = false
         AND amount_subtotal_param IS NOT NULL
    THEN amount_subtotal_param
    ELSE amount_total
  END;

  IF product_record.price IS NOT NULL THEN
    DECLARE
      expected_total NUMERIC;   -- full price + bumps (upper bound)
      effective_total NUMERIC;  -- effective (sale-aware) price + bumps (lower bound)
    BEGIN
      expected_total := product_record.price + total_bump_price;
      effective_total := effective_unit_price + total_bump_price;

      IF product_record.allow_custom_price = true THEN
        IF charge_basis < ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * 100) THEN
          RAISE EXCEPTION 'Amount below minimum: got % cents, minimum is % cents',
            charge_basis, ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * 100);
        END IF;
      ELSIF coupon_id_param IS NULL THEN
        IF charge_basis < (effective_total * 100) OR charge_basis > (expected_total * 100) THEN
          RAISE EXCEPTION 'Amount mismatch: expected between % and % cents (effective % + bumps %), got % cents',
            (effective_total * 100),
            (expected_total * 100),
            (effective_unit_price * 100),
            (total_bump_price * 100),
            charge_basis;
        END IF;
      ELSE
        IF charge_basis <= 0 THEN
          RAISE EXCEPTION 'Invalid amount with coupon: amount cannot be zero or negative';
        END IF;

        IF charge_basis > (expected_total * 100) THEN
          RAISE EXCEPTION 'Amount too high with coupon: got % cents but max possible is % cents',
            charge_basis, (expected_total * 100);
        END IF;
      END IF;
    END;
  END IF;

  IF product_record.allow_custom_price = true THEN
    main_line_item_price := (charge_basis / 100) - total_bump_price;
    IF main_line_item_price < 0 THEN
      RAISE EXCEPTION 'Invalid PWYW line item amount: amount % cents is lower than bump total %',
        charge_basis, total_bump_price;
    END IF;
  ELSE
    main_line_item_price := effective_unit_price;
  END IF;

  SELECT id INTO existing_user_id FROM auth.users WHERE email = customer_email_param;

  IF product_record.auto_grant_duration_days IS NOT NULL THEN
    access_expires_at := NOW() + (product_record.auto_grant_duration_days || ' days')::INTERVAL;
  END IF;

  BEGIN
    IF current_user_id IS NULL AND existing_user_id IS NOT NULL THEN
      current_user_id := existing_user_id;
    END IF;

    SELECT pt.id INTO pending_transaction_id
    FROM public.payment_transactions pt
    WHERE (pt.stripe_payment_intent_id = pi_param OR pt.session_id = session_id_param)
      AND pt.status = 'pending'
    LIMIT 1;

    IF pending_transaction_id IS NOT NULL THEN
      UPDATE public.payment_transactions
      SET
        status = 'completed',
        user_id = current_user_id,
        customer_email = customer_email_param,
        metadata = metadata || jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param,
          'converted_from_pending', true
        ),
        updated_at = NOW()
      WHERE id = pending_transaction_id
      RETURNING id INTO transaction_id_var;
    ELSE
      INSERT INTO public.payment_transactions (
        session_id, user_id, product_id, customer_email, amount, currency,
        stripe_payment_intent_id, status, metadata
      ) VALUES (
        session_id_param, current_user_id, product_id_param, customer_email_param,
        amount_total, upper(currency_param), stripe_payment_intent_id, 'completed',
        jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param
        )
      ) RETURNING id INTO transaction_id_var;
    END IF;

    PERFORM public.increment_sale_quantity_sold(product_id_param);

    INSERT INTO public.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price,
      currency, product_name
    ) VALUES (
      transaction_id_var, product_id_param, 'main_product', 1,
      main_line_item_price, main_line_item_price,
      upper(currency_param), product_record.name
    );

    IF bump_count > 0 THEN
      FOR bump_rec IN
        SELECT
          p.id,
          p.name,
          ob.id as order_bump_id,
          ob.access_duration_days as access_duration_override,
          COALESCE(ob.bump_price, p.price) as price,
          p.currency
        FROM unnest(bump_ids_found) AS bid(id)
        JOIN public.products p ON p.id = bid.id
        JOIN public.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
        WHERE p.is_active = true AND ob.is_active = true
      LOOP
        INSERT INTO public.payment_line_items (
          transaction_id, product_id, item_type, quantity, unit_price, total_price,
          currency, product_name, order_bump_id, access_duration_override
        ) VALUES (
          transaction_id_var, bump_rec.id, 'order_bump', 1,
          bump_rec.price, bump_rec.price,
          upper(COALESCE(bump_rec.currency, currency_param)), bump_rec.name,
          bump_rec.order_bump_id, bump_rec.access_duration_override
        );
      END LOOP;
    END IF;

    IF coupon_id_param IS NOT NULL THEN
      DELETE FROM public.coupon_reservations
      WHERE coupon_id = coupon_id_param
        AND customer_email = customer_email_param
        AND expires_at > NOW();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No valid coupon reservation found. Coupon may have expired or reached limit.';
      END IF;

      UPDATE public.coupons
      SET current_usage_count = COALESCE(current_usage_count, 0) + 1
      WHERE id = coupon_id_param
        AND is_active = true
        AND (usage_limit_global IS NULL OR COALESCE(current_usage_count, 0) < usage_limit_global);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon limit reached despite reservation (system error)';
      END IF;

      INSERT INTO public.coupon_redemptions (
        coupon_id, user_id, customer_email, transaction_id, discount_amount
      ) VALUES (
        coupon_id_param,
        COALESCE(current_user_id, existing_user_id),
        customer_email_param,
        transaction_id_var,
        0
      );
    END IF;

    IF current_user_id IS NOT NULL THEN
      PERFORM public.grant_product_and_bundle_components(current_user_id, product_id_param);

      IF bump_count > 0 THEN
        FOR bump_rec IN
          SELECT u.bid AS product_id, ob.access_duration_days AS access_duration_override
          FROM unnest(bump_ids_found) AS u(bid)
          JOIN public.order_bumps ob
            ON ob.bump_product_id = u.bid AND ob.main_product_id = product_id_param
        LOOP
          PERFORM public.grant_product_access_service_role(
            current_user_id,
            bump_rec.product_id,
            override_duration_days_param => bump_rec.access_duration_override
          );
        END LOOP;
      END IF;

      IF user_id_param IS NULL AND existing_user_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'scenario', 'guest_purchase_user_exists_with_bump',
          'access_granted', true,
          'is_guest_purchase', false,
          'send_magic_link', true,
          'requires_login', true,
          'bump_access_granted', bump_count > 0,
          'bump_count', bump_count,
          'customer_email', customer_email_param
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'logged_in_user_with_bump',
        'access_granted', true,
        'bump_access_granted', bump_count > 0,
        'bump_count', bump_count,
        'customer_email', customer_email_param
      );
    ELSE
      INSERT INTO public.guest_purchases (customer_email, product_id, transaction_amount, session_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param);

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param
      );
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_process_stripe_payment_completion_with_bump_impl error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment processing failed. Please try again or contact support.',
      'code', SQLSTATE
    );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

REVOKE EXECUTE ON FUNCTION public._process_stripe_payment_completion_with_bump_impl(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID, NUMERIC
) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public._process_stripe_payment_completion_with_bump_impl(
  TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID, NUMERIC
) TO service_role;


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
       OR tx.status NOT IN ('pending', 'completed')
       OR (tx.status <> 'pending' AND (tx.amount IS DISTINCT FROM amount_total OR lower(tx.customer_email) IS DISTINCT FROM lower(trim(customer_email_param))))
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

  -- Keep the pending attachment and downstream completion in one savepoint.
  BEGIN
    IF tx.id IS NOT NULL THEN
      UPDATE public.payment_transactions SET
        stripe_payment_intent_id = coalesce(pi_param, tx.stripe_payment_intent_id),
        session_id = session_id_param,
        amount = CASE WHEN status = 'pending' THEN amount_total ELSE amount END,
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

CREATE OR REPLACE FUNCTION public.claim_webhook_delivery(p_id uuid)
RETURNS SETOF public.webhook_logs
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.webhook_logs SET next_retry_at = now() + interval '60 seconds'
  WHERE id = p_id AND status = 'pending_retry' AND next_retry_at <= now()
  RETURNING *;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_webhook_delivery(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_delivery(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_webhook_delivery(
  p_id uuid, p_endpoint_id uuid, p_event_type text, p_payload jsonb,
  p_delivery_key text, p_max_attempts integer DEFAULT 5
) RETURNS SETOF public.webhook_logs
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.webhook_logs(
    id, endpoint_id, event_type, payload, delivery_key, status,
    attempt_count, max_attempts, next_retry_at
  ) VALUES (
    p_id, p_endpoint_id, p_event_type, p_payload || jsonb_build_object('id', p_id),
    p_delivery_key, 'pending_retry', 0, p_max_attempts, now() + interval '60 seconds'
  ) ON CONFLICT DO NOTHING
  RETURNING *;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_webhook_delivery(uuid,uuid,text,jsonb,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_webhook_delivery(uuid,uuid,text,jsonb,text,integer) TO service_role;
