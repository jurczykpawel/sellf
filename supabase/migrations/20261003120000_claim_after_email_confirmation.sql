-- Guest purchases follow e-mail confirmation.

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
    SELECT gp.*, pt.id as transaction_id
    FROM public.guest_purchases gp
    LEFT JOIN public.payment_transactions pt ON pt.session_id = gp.session_id
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
          WHERE session_id = guest_purchase_record.session_id
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

CREATE OR REPLACE FUNCTION public.migrate_guest_payment_data_to_profile(
  p_user_id UUID
) RETURNS json AS $$
DECLARE
  user_email_var TEXT;
  latest_payment RECORD;
  rows_updated INTEGER := 0;
  profile_updated BOOLEAN := FALSE;
BEGIN
  SELECT email INTO user_email_var
  FROM auth.users
  WHERE id = p_user_id AND email_confirmed_at IS NOT NULL;

  IF user_email_var IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  SELECT metadata, created_at
  INTO latest_payment
  FROM public.payment_transactions
  WHERE customer_email = user_email_var
    AND user_id IS NULL  -- Guest purchases only
    AND status = 'completed'
    AND metadata IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF latest_payment IS NOT NULL THEN
    UPDATE public.profiles
    SET
      full_name = CASE
        WHEN latest_payment.metadata->>'full_name' IS NOT NULL
          AND latest_payment.metadata->>'full_name' != ''
        THEN latest_payment.metadata->>'full_name'
        ELSE full_name
      END,
      first_name = CASE
        WHEN latest_payment.metadata->>'first_name' IS NOT NULL
          AND latest_payment.metadata->>'first_name' != ''
        THEN latest_payment.metadata->>'first_name'
        ELSE first_name
      END,
      last_name = CASE
        WHEN latest_payment.metadata->>'last_name' IS NOT NULL
          AND latest_payment.metadata->>'last_name' != ''
        THEN latest_payment.metadata->>'last_name'
        ELSE last_name
      END,

      tax_id = CASE
        WHEN latest_payment.metadata->>'needs_invoice' = 'true'
          AND latest_payment.metadata->>'nip' IS NOT NULL
          AND latest_payment.metadata->>'nip' != ''
        THEN latest_payment.metadata->>'nip'
        ELSE tax_id
      END,
      company_name = CASE
        WHEN latest_payment.metadata->>'needs_invoice' = 'true'
          AND latest_payment.metadata->>'company_name' IS NOT NULL
          AND latest_payment.metadata->>'company_name' != ''
        THEN latest_payment.metadata->>'company_name'
        ELSE company_name
      END,
      address_line1 = CASE
        WHEN latest_payment.metadata->>'needs_invoice' = 'true'
          AND latest_payment.metadata->>'address' IS NOT NULL
          AND latest_payment.metadata->>'address' != ''
        THEN latest_payment.metadata->>'address'
        ELSE address_line1
      END,
      city = CASE
        WHEN latest_payment.metadata->>'needs_invoice' = 'true'
          AND latest_payment.metadata->>'city' IS NOT NULL
          AND latest_payment.metadata->>'city' != ''
        THEN latest_payment.metadata->>'city'
        ELSE city
      END,
      zip_code = CASE
        WHEN latest_payment.metadata->>'needs_invoice' = 'true'
          AND latest_payment.metadata->>'postal_code' IS NOT NULL
          AND latest_payment.metadata->>'postal_code' != ''
        THEN latest_payment.metadata->>'postal_code'
        ELSE zip_code
      END,
      country = CASE
        WHEN latest_payment.metadata->>'needs_invoice' = 'true'
          AND latest_payment.metadata->>'country' IS NOT NULL
          AND latest_payment.metadata->>'country' != ''
        THEN latest_payment.metadata->>'country'
        ELSE country
      END,

      updated_at = NOW()
    WHERE id = p_user_id;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    profile_updated := rows_updated > 0;
  END IF;

  RETURN json_build_object(
    'success', true,
    'data_migrated', profile_updated,
    'payment_date', latest_payment.created_at,
    'email', user_email_var
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.migrate_guest_purchases(p_user_id UUID, p_email TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claim_result JSON;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only service_role can call migrate_guest_purchases';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_user_id
      AND email = p_email AND email_confirmed_at IS NOT NULL
  ) THEN
    RETURN 0;
  END IF;
  PERFORM public.migrate_guest_payment_data_to_profile(p_user_id);
  SELECT public.claim_guest_purchases_for_user(p_user_id) INTO claim_result;
  RETURN COALESCE((claim_result->>'claimed_count')::integer, 0);
END;
$$;

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

  IF current_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = current_user_id AND email_confirmed_at IS NOT NULL
  ) THEN
    current_user_id := NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE session_id = session_id_param AND status != 'pending') THEN
    IF current_user_id IS NOT NULL THEN
      SELECT email INTO caller_email FROM auth.users WHERE id = current_user_id AND email_confirmed_at IS NOT NULL;
      IF caller_email IS NOT NULL AND lower(caller_email) = lower(customer_email_param) THEN
        SELECT id INTO existing_transaction_id
        FROM public.payment_transactions
        WHERE session_id = session_id_param
        LIMIT 1;

        IF EXISTS (
          SELECT 1 FROM public.guest_purchases
          WHERE session_id = session_id_param AND claimed_by_user_id IS NULL
        ) THEN
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

  SELECT id INTO existing_user_id FROM auth.users WHERE email = customer_email_param AND email_confirmed_at IS NOT NULL;

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
        fulfillment_pending = true,
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
        stripe_payment_intent_id, status, fulfillment_pending, metadata
      ) VALUES (
        session_id_param, current_user_id, product_id_param, customer_email_param,
        amount_total, upper(currency_param), stripe_payment_intent_id, 'completed', true,
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

CREATE OR REPLACE FUNCTION public.handle_new_user_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('handle_new_user_registration'));

  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.admin_users (user_id)
  SELECT NEW.id WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id <> NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  IF NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM public.migrate_guest_payment_data_to_profile(NEW.id);
    PERFORM public.claim_guest_purchases_for_user(NEW.id);
  END IF;

  PERFORM public.log_audit_entry('auth.users', 'INSERT', NULL, jsonb_build_object('email', NEW.email), NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_email_confirmation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('handle_new_user_registration'));
  PERFORM public.migrate_guest_payment_data_to_profile(NEW.id);
  PERFORM public.claim_guest_purchases_for_user(NEW.id);
  INSERT INTO public.user_product_access(user_id, product_id, subscription_id, access_granted_at)
  SELECT DISTINCT ON (s.product_id) NEW.id, s.product_id, s.id, now()
  FROM public.subscriptions s
  WHERE s.user_id = NEW.id AND s.status IN ('active', 'trialing')
  ORDER BY s.product_id, s.created_at DESC, s.id DESC
  ON CONFLICT (user_id, product_id) DO UPDATE
    SET subscription_id = EXCLUDED.subscription_id,
        access_granted_at = EXCLUDED.access_granted_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.handle_user_email_confirmation();

REVOKE EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.migrate_guest_payment_data_to_profile(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_guest_payment_data_to_profile(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.migrate_guest_purchases(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_guest_purchases(UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public._process_stripe_payment_completion_with_bump_impl(TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._process_stripe_payment_completion_with_bump_impl(TEXT, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID[], UUID, NUMERIC) TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user_registration() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user_registration() TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_user_email_confirmation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_user_email_confirmation() TO service_role;

-- Subscription rows retain pending purchases until the e-mail is confirmed.
CREATE OR REPLACE FUNCTION public.defer_subscription_access_until_confirmation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = NEW.user_id AND email_confirmed_at IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.defer_subscription_access_until_confirmation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_subscription_access_until_confirmation() TO service_role;
CREATE TRIGGER defer_subscription_access_until_confirmation
BEFORE INSERT OR UPDATE ON public.user_product_access
FOR EACH ROW EXECUTE FUNCTION public.defer_subscription_access_until_confirmation();
