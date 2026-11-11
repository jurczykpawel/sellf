-- Sellf 2026.11.0: pricing.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261017083253_product_vat_default_units.sql =====
-- Shop defaults store fractional rates; product rates use percentage points.
CREATE OR REPLACE FUNCTION public.apply_shop_vat_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tax_rate numeric;
  v_vat_exempt boolean;
  v_exempt_note text;
BEGIN
  SELECT tax_rate, is_vat_exempt, vat_exempt_note
    INTO v_tax_rate, v_vat_exempt, v_exempt_note
    FROM public.shop_config
    ORDER BY created_at
    LIMIT 1;

  IF NEW.vat_rate IS NULL AND NEW.vat_exempt = false THEN
    IF v_vat_exempt THEN
      NEW.vat_exempt := true;
    ELSIF v_tax_rate IS NOT NULL THEN
      NEW.vat_rate := v_tax_rate * 100;
    END IF;
  END IF;

  IF NEW.vat_exempt = true AND NEW.vat_exempt_note IS NULL THEN
    NEW.vat_exempt_note := v_exempt_note;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_shop_vat_defaults() FROM anon, authenticated, PUBLIC;

-- ===== Source: 20261017173304_product_vat_rate_units_repair.sql =====
-- Product VAT rates are stored in percentage points (23.00 means 23%).
-- Between v2026.6.18 and 20261017083253 the new-product default copied the shop
-- rate as a fraction (0.23) into that column. This migration rescales those rows.
--
-- Rule: 0 < vat_rate < 1 becomes vat_rate * 100.
--   * No real VAT rate is below 1%, so a value in that interval can only be a
--     fraction. Rates of 0 (zero-rated), NULL, and anything >= 1 are untouched.
--   * The column is DECIMAL(5,2), so every candidate has at most two decimals and
--     the result is exact (0.05 -> 5.00, 0.08 -> 8.00, 0.23 -> 23.00) and below
--     100, so it always fits. The smallest candidate, 0.01, becomes 1.00, which
--     the rule no longer matches: running the migration again changes nothing.
--   * The shop default is itself stored at two decimals, so no precision is
--     lost between the shop rate and the product copy; nothing is recovered
--     from shop_config.
--   * Subscriptions priced before this release were saved without a gross/net
--     choice (the form hid it). Their prices are now treated as including VAT,
--     so a repaired subscription is also marked price_includes_vat = true.
--   * Products are not told apart by origin (no marker exists), exempt products
--     included: their stored rate is shown nowhere while exempt, and a later
--     switch back to taxable must not expose a fraction.
--
-- Records already written are kept exactly as recorded: completed payments, line
-- items, invoices and their tax snapshots, and product_price_history rows. They
-- describe what was charged at the time. The repair deliberately writes NO new
-- product_price_history row: the price did not change, and a new row would close
-- the current period and distort the "lowest price in the last 30 days" shown
-- for products on an active sale. The price/rate change trigger is therefore
-- switched off for the repair only (the table is locked for the statement, so no
-- concurrent write can slip past while it is off).
-- Open checkout sessions keep the rate they were created with; new sessions use
-- the corrected value. No audit_log row is written: the codebase records admin
-- actions through mutate_product_with_audit, and earlier data repairs do not log.

-- 1. The new-product default: shop rates are stored as fractions (0.23), product
--    rates in percentage points (23). Guard against a shop rate that was already
--    entered in percentage points, which would otherwise become 2300 and overflow
--    DECIMAL(5,2).
CREATE OR REPLACE FUNCTION public.apply_shop_vat_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tax_rate numeric;
  v_vat_exempt boolean;
  v_exempt_note text;
BEGIN
  SELECT tax_rate, is_vat_exempt, vat_exempt_note
    INTO v_tax_rate, v_vat_exempt, v_exempt_note
    FROM public.shop_config
    ORDER BY created_at
    LIMIT 1;

  IF NEW.vat_rate IS NULL AND NEW.vat_exempt = false THEN
    IF v_vat_exempt THEN
      NEW.vat_exempt := true;
    ELSIF v_tax_rate IS NOT NULL THEN
      NEW.vat_rate := CASE WHEN v_tax_rate < 1 THEN v_tax_rate * 100 ELSE v_tax_rate END;
    END IF;
  END IF;

  IF NEW.vat_exempt = true AND NEW.vat_exempt_note IS NULL THEN
    NEW.vat_exempt_note := v_exempt_note;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_shop_vat_defaults() FROM anon, authenticated, PUBLIC;

-- 2. Data repair.
ALTER TABLE public.products DISABLE TRIGGER product_price_change_trigger;

UPDATE public.products
   SET vat_rate = vat_rate * 100,
       price_includes_vat = CASE WHEN product_type = 'subscription' THEN true ELSE price_includes_vat END
 WHERE vat_rate > 0
   AND vat_rate < 1;

ALTER TABLE public.products ENABLE TRIGGER product_price_change_trigger;

-- ===== Source: 20261017190000_order_bumps_return_vat.sql =====
-- The checkout page needs each bump product's own VAT settings to show a total that
-- matches the charge (net bumps get VAT added on top, exempt bumps do not).
-- Return type changes, so the function is dropped and recreated with the same
-- security attributes and grants as 20260310175058_multi_order_bumps.sql.
DROP FUNCTION IF EXISTS public.get_product_order_bumps(UUID);

CREATE OR REPLACE FUNCTION public.get_product_order_bumps(
  product_id_param UUID
) RETURNS TABLE (
  bump_id UUID,
  bump_product_id UUID,
  bump_product_name TEXT,
  bump_product_description TEXT,
  bump_product_icon TEXT,
  bump_price NUMERIC,
  original_price NUMERIC,
  bump_access_duration INTEGER,
  bump_currency TEXT,
  bump_title TEXT,
  bump_description TEXT,
  display_order INTEGER,
  urgency_duration_minutes INTEGER,
  vat_rate NUMERIC,
  price_includes_vat BOOLEAN,
  vat_exempt BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ob.id as bump_id,
    ob.bump_product_id,
    p.name as bump_product_name,
    p.description as bump_product_description,
    p.icon as bump_product_icon,
    COALESCE(ob.bump_price, p.price) as bump_price,
    p.price as original_price,
    COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as bump_access_duration,
    p.currency as bump_currency,
    ob.bump_title,
    ob.bump_description,
    ob.display_order,
    ob.urgency_duration_minutes,
    p.vat_rate,
    p.price_includes_vat,
    p.vat_exempt
  FROM public.order_bumps ob
  INNER JOIN public.products p ON p.id = ob.bump_product_id
  WHERE ob.main_product_id = product_id_param
    AND ob.is_active = true
    AND p.is_active = true
  ORDER BY ob.display_order ASC, ob.created_at ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.get_product_order_bumps FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_order_bumps TO anon, authenticated, service_role;

-- ===== Source: 20261017203003_zero_decimal_currency_amounts.sql =====
-- Stripe minor-unit factor per currency: zero-decimal currencies (JPY, KRW, VND, ...) are
-- charged in whole units, everything else in hundredths. Twin of lib/currency/minor-units.ts.
CREATE OR REPLACE FUNCTION public.currency_minor_factor(currency_code TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT CASE WHEN upper(currency_code) IN
    ('BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','VND','VUV','XAF','XOF','XPF')
    THEN 1::numeric ELSE 100::numeric END;
$$;

-- Payment completion validates the amount Stripe reports (minor units) against product prices
-- (major units) using the currency's minor-unit factor instead of a fixed 100.
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
  minor_factor NUMERIC := public.currency_minor_factor(currency_param);  -- 100, or 1 for zero-decimal currencies
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
        IF charge_basis < ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * minor_factor) THEN
          RAISE EXCEPTION 'Amount below minimum: got % (minor units), minimum is % (minor units)',
            charge_basis, ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * minor_factor);
        END IF;
      ELSIF coupon_id_param IS NULL THEN
        IF charge_basis < (effective_total * minor_factor) OR charge_basis > (expected_total * minor_factor) THEN
          RAISE EXCEPTION 'Amount mismatch: expected between % and % (minor units) (effective % + bumps %), got % (minor units)',
            (effective_total * minor_factor),
            (expected_total * minor_factor),
            (effective_unit_price * minor_factor),
            (total_bump_price * minor_factor),
            charge_basis;
        END IF;
      ELSE
        IF charge_basis <= 0 THEN
          RAISE EXCEPTION 'Invalid amount with coupon: amount cannot be zero or negative';
        END IF;

        IF charge_basis > (expected_total * minor_factor) THEN
          RAISE EXCEPTION 'Amount too high with coupon: got % (minor units) but max possible is % (minor units)',
            charge_basis, (expected_total * minor_factor);
        END IF;
      END IF;
    END;
  END IF;

  IF product_record.allow_custom_price = true THEN
    main_line_item_price := (charge_basis / minor_factor) - total_bump_price;
    IF main_line_item_price < 0 THEN
      RAISE EXCEPTION 'Invalid PWYW line item amount: amount % (minor units) is lower than bump total %',
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


-- Payment history shows amounts in display units: divide by the currency's minor-unit factor.
-- Same signature, security settings and grants as before.
CREATE OR REPLACE FUNCTION public.get_user_payment_history(user_id_param uuid)
RETURNS TABLE(transaction_id uuid, product_name text, product_slug text, amount numeric, currency text, payment_date timestamp with time zone, status text, refunded_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '5s'
AS $function$
BEGIN
    -- Rate limiting: 30 calls per hour for payment history (SECURITY)
    IF NOT public.check_rate_limit('get_user_payment_history', 30, 3600) THEN
        RAISE EXCEPTION 'Rate limit exceeded. Please wait before requesting payment history again.';
    END IF;

    -- Input validation
    IF user_id_param IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    -- Security check: users can only view their own payment history (unless admin)
    IF user_id_param != auth.uid() THEN
        IF NOT ( select public.is_admin() ) THEN
            RAISE EXCEPTION 'Unauthorized: Can only view your own payment history';
        END IF;
    END IF;

    RETURN QUERY
    SELECT 
        pt.id,
        p.name,
        p.slug,
        pt.amount / public.currency_minor_factor(pt.currency),
        pt.currency,
        pt.created_at,
        pt.status,
        pt.refunded_amount / public.currency_minor_factor(pt.currency)
    FROM public.payment_transactions pt
    JOIN public.products p ON pt.product_id = p.id
    WHERE pt.user_id = user_id_param
    ORDER BY pt.created_at DESC
    LIMIT 100; -- Prevent excessive data retrieval
END;
$function$;

-- Guard against fractional prices in zero-decimal currencies (Stripe has no minor unit there,
-- so 1000.5 JPY would be charged as 1001 and then fail the completion check). Triggers rather
-- than CHECK constraints: existing rows are never revalidated, only new or changed values.
CREATE OR REPLACE FUNCTION public.enforce_whole_amounts_product()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF public.currency_minor_factor(NEW.currency) <> 1 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.price IS DISTINCT FROM OLD.price OR NEW.sale_price IS DISTINCT FROM OLD.sale_price
     OR NEW.recurring_price IS DISTINCT FROM OLD.recurring_price
     OR NEW.custom_price_min IS DISTINCT FROM OLD.custom_price_min THEN
    IF NEW.price <> trunc(NEW.price) OR NEW.sale_price <> trunc(NEW.sale_price)
       OR NEW.recurring_price <> trunc(NEW.recurring_price) OR NEW.custom_price_min <> trunc(NEW.custom_price_min) THEN
      RAISE EXCEPTION 'Prices in % must be whole numbers (no minor unit)', NEW.currency
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.currency IS DISTINCT FROM OLD.currency AND EXISTS (
      SELECT 1 FROM public.order_bumps ob WHERE ob.bump_product_id = NEW.id AND ob.bump_price <> trunc(ob.bump_price)
    ) THEN
      RAISE EXCEPTION 'Order bump prices for this product must be whole numbers in %', NEW.currency
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER products_whole_amounts BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enforce_whole_amounts_product();

CREATE OR REPLACE FUNCTION public.enforce_whole_amounts_order_bump()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.bump_price IS NOT NULL AND NEW.bump_price <> trunc(NEW.bump_price)
     AND (TG_OP = 'INSERT' OR NEW.bump_price IS DISTINCT FROM OLD.bump_price OR NEW.bump_product_id IS DISTINCT FROM OLD.bump_product_id)
     AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.bump_product_id AND public.currency_minor_factor(p.currency) = 1) THEN
    RAISE EXCEPTION 'Order bump price must be a whole number in this product''s currency (no minor unit)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_bumps_whole_amounts BEFORE INSERT OR UPDATE ON public.order_bumps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_whole_amounts_order_bump();

CREATE OR REPLACE FUNCTION public.enforce_whole_amounts_coupon()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.discount_type = 'fixed' AND NEW.currency IS NOT NULL AND public.currency_minor_factor(NEW.currency) = 1
     AND NEW.discount_value <> trunc(NEW.discount_value)
     AND (TG_OP = 'INSERT' OR NEW.discount_value IS DISTINCT FROM OLD.discount_value OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
    RAISE EXCEPTION 'Fixed discounts in % must be whole numbers (no minor unit)', NEW.currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER coupons_whole_amounts BEFORE INSERT OR UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.enforce_whole_amounts_coupon();

REVOKE EXECUTE ON FUNCTION public.enforce_whole_amounts_product() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_whole_amounts_order_bump() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_whole_amounts_coupon() FROM PUBLIC, anon, authenticated;
