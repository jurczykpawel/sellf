
REVOKE EXECUTE ON FUNCTION public.storefront_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_schema() TO service_role;
-- storefront-schema:end

CREATE OR REPLACE FUNCTION public.storefront_config_valid(config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF public.jsonschema_subset_matches(public.storefront_config_schema(), config) IS DISTINCT FROM true THEN RETURN false; END IF;
  IF EXISTS (
    WITH RECURSIVE nodes(value, depth) AS (
      SELECT config, 0 UNION ALL
      SELECT child.value, nodes.depth + 1 FROM nodes CROSS JOIN LATERAL (
        SELECT value FROM pg_catalog.jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)
        UNION ALL SELECT value FROM pg_catalog.jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END)
      ) child WHERE nodes.depth <= 12
    ) SELECT 1 FROM nodes WHERE depth > 12 OR
      (jsonb_typeof(value)='string' AND (value #>> '{}') ~ U&'[\FEFF\FFFD]') OR
      (jsonb_typeof(value)='object' AND value ?| ARRAY['__proto__','prototype','constructor'])
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(config->'content') slot CROSS JOIN LATERAL pg_catalog.jsonb_each(slot.value) locale
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(COALESCE(locale.value->'items','[]'::jsonb)) item
    WHERE locale.key IN ('en','pl') GROUP BY slot.key, locale.key
    HAVING count(*) <> count(DISTINCT CASE WHEN slot.key = 'home.paths' THEN lower(item->>'productId') WHEN (locale.value->>'kind' = 'comparison' OR slot.key = 'home.featured') THEN item->>'productId' ELSE item->>'id' END)
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(config->'settingsByTemplate') settings
    CROSS JOIN LATERAL pg_catalog.jsonb_each(settings.value) field
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(CASE WHEN jsonb_typeof(field.value)='array' THEN field.value ELSE '[]'::jsonb END) item
    GROUP BY settings.key, field.key HAVING count(*) <> count(DISTINCT item)
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(config#>'{content,home.search}') locale
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(COALESCE(locale.value->'items','[]'::jsonb)) item
    WHERE locale.key IN ('en','pl') GROUP BY locale.key HAVING count(*) <> count(DISTINCT item->>'categoryId')
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(config#>'{content,home.paths}') locale
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(COALESCE(locale.value->'items','[]'::jsonb)) item
    WHERE locale.key IN ('en','pl') GROUP BY locale.key HAVING count(*) <> count(DISTINCT item->>'id')
  ) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(config#>'{content,home.projects}') locale
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(COALESCE(locale.value->'items','[]'::jsonb)) item
    WHERE locale.key IN ('en','pl') AND item->>'url' ~ '^https://([^/]+\.)?(localhost|local|internal|home|lan|google\.internal)(:443)?(/|$)'
  ) THEN RETURN false; END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_valid(jsonb) TO service_role;

-- ===== Source: 20261104055000_template_credential_status_clock_skew.sql =====
-- W148-5: background template-key confirmations were rejected once the app clock ran ahead of
-- the database clock (checked_at > clock_timestamp()), so every refresh after the first one
-- failed and the panel showed "unknown". Accept a bounded skew and never store a future time.
-- Same signature, grants and safeguards as 20261016231510_template_credential_status.sql.
CREATE OR REPLACE FUNCTION public.record_template_credential_status(template_id text, expected_key text, expected_iv text,
  expected_tag text, verification_state text, checked_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' OR verification_state IS NULL OR
    verification_state NOT IN ('valid','expired','revoked','invalid','unknown') OR
    checked_at IS NULL OR checked_at > clock_timestamp() + interval '5 minutes' OR
    checked_at < clock_timestamp() - interval '60 seconds' THEN
    RETURN false;
  END IF;
  UPDATE public.template_credentials AS stored SET state=verification_state,
    verified_at=CASE WHEN verification_state='unknown' THEN NULL ELSE least(checked_at, clock_timestamp()) END
    WHERE stored.template_id=record_template_credential_status.template_id AND stored.encrypted_key=expected_key AND
      stored.encryption_iv=expected_iv AND stored.encryption_tag=expected_tag AND
      (stored.verified_at IS NULL OR stored.verified_at<=checked_at) AND
      (stored.state<>'revoked' OR verification_state='revoked');
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('template_credentials','UPDATE',
    jsonb_build_object('templateId',template_id,'state',verification_state,'source','background'));
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_template_credential_status(text,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_template_credential_status(text,text,text,text,text,timestamptz) TO service_role;

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

-- Sellf 2026.11.0: orders events.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261022090000_payment_order_details.sql =====
-- Buyer details are stored with the order before the payment can be confirmed.
--
-- payment_transactions.order_details holds a JSON object of order-level data
-- (first key: "buyer"). Readers are unchanged: the row owner (user_id), admins
-- and service_role, through the existing SELECT policy. No new grants for anon.

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS order_details jsonb;

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_order_details_check
  CHECK (
    order_details IS NULL
    OR (
      jsonb_typeof(order_details) = 'object'
      AND octet_length(order_details::text) <= 16384
    )
  );

COMMENT ON COLUMN public.payment_transactions.order_details IS
  'Order-level details as a JSON object (max 16384 bytes). Key "buyer": {v, first_name, last_name, full_name, needs_invoice, nip, company_name, address, city, postal_code, country, terms_accepted, source, saved_at}.';

-- Merge the buyer object into order_details (other keys are kept).
--   p_only_if_missing = false: overwrite "buyer" on the PENDING row of the session / payment intent.
--   p_only_if_missing = true : fill "buyer" on a row of any status, only when it has none yet.
-- Returns the number of rows changed (0 = nothing matched).
CREATE OR REPLACE FUNCTION public.set_payment_order_buyer(
  p_buyer jsonb,
  p_session_id text DEFAULT NULL,
  p_payment_intent_id text DEFAULT NULL,
  p_only_if_missing boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_buyer IS NULL OR jsonb_typeof(p_buyer) <> 'object' THEN
    RAISE EXCEPTION 'buyer must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_session_id IS NULL AND p_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'session or payment intent id is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.payment_transactions
  SET order_details = coalesce(order_details, '{}'::jsonb) || jsonb_build_object('buyer', p_buyer),
      updated_at = now()
  WHERE (session_id = p_session_id OR stripe_payment_intent_id = p_payment_intent_id)
    AND CASE
          WHEN p_only_if_missing THEN order_details -> 'buyer' IS NULL
          ELSE status = 'pending'
        END;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.set_payment_order_buyer(jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_order_buyer(jsonb, text, text, boolean) TO service_role;

-- ===== Source: 20261022191538_order_core_schema.sql =====
-- Provider-independent order references and saved pricing. Existing policies stay in force.
DO $order_numbers$
BEGIN
LOCK TABLE public.payment_transactions IN ACCESS EXCLUSIVE MODE;
CREATE SEQUENCE public.payment_order_number_seq START WITH 1001;
REVOKE ALL ON SEQUENCE public.payment_order_number_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.payment_order_number_seq TO service_role;

ALTER TABLE public.payment_transactions
  ADD COLUMN payment_provider text NOT NULL DEFAULT 'stripe' CHECK (payment_provider IN ('stripe', 'bank_transfer')),
  ADD COLUMN order_number bigint,
  ADD COLUMN pricing_snapshot_version integer CHECK (pricing_snapshot_version = 1),
  ADD COLUMN coupon_id uuid REFERENCES public.coupons(id) ON DELETE RESTRICT,
  ADD COLUMN livemode boolean NOT NULL DEFAULT false;
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) + 1000 AS number
  FROM public.payment_transactions
)
UPDATE public.payment_transactions p SET order_number = n.number FROM numbered n WHERE n.id = p.id;
PERFORM setval('public.payment_order_number_seq',
  greatest(1001, coalesce(max(order_number), 1001)), count(*) > 0) FROM public.payment_transactions;
ALTER SEQUENCE public.payment_order_number_seq OWNED BY public.payment_transactions.order_number;
ALTER TABLE public.payment_transactions
  ALTER COLUMN order_number SET NOT NULL,
  ALTER COLUMN order_number SET DEFAULT nextval('public.payment_order_number_seq'),
  ADD CONSTRAINT payment_transactions_order_number_key UNIQUE (order_number),
  ALTER COLUMN session_id DROP NOT NULL,
  DROP CONSTRAINT payment_transactions_session_id_check,
  ADD CONSTRAINT payment_transactions_provider_ref_chk CHECK (
    (payment_provider = 'stripe' AND session_id IS NOT NULL
      AND length(session_id) BETWEEN 1 AND 255 AND session_id ~* '^(cs_|pi_|in_)[a-zA-Z0-9_]+$')
    OR (payment_provider = 'bank_transfer' AND session_id IS NULL
      AND stripe_payment_intent_id IS NULL AND pricing_snapshot_version IS NOT NULL)
  ),
  DROP CONSTRAINT payment_transactions_status_check,
  ADD CONSTRAINT payment_transactions_status_check CHECK (status IN (
    'pending', 'completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned', 'awaiting_payment', 'cancelled'
  )),
  DROP CONSTRAINT payment_transactions_tax_snapshot_status_chk,
  ADD CONSTRAINT payment_transactions_tax_snapshot_status_chk
    CHECK (tax_snapshot_status IN ('none', 'captured', 'partial', 'unavailable', 'local'));
END;
$order_numbers$;
CREATE INDEX payment_transactions_coupon_idx ON public.payment_transactions(coupon_id) WHERE coupon_id IS NOT NULL;

ALTER TABLE public.payment_line_items ADD COLUMN discounted_total numeric
  CHECK (discounted_total >= 0 AND discounted_total <= 99999999);
COMMENT ON COLUMN public.payment_line_items.discounted_total IS 'MAJOR units after coupon; NULL for legacy lines.';
-- Keep the legacy session join unambiguous when guest rows gain transaction_id.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.claim_guest_purchases_for_user(uuid)'::regprocedure) INTO definition;
  IF position('SELECT gp.*, pt.id as transaction_id' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected guest purchase projection not found';
  END IF;
  EXECUTE replace(definition, 'SELECT gp.*, pt.id as transaction_id',
    'SELECT gp.id, gp.product_id, gp.session_id, pt.id as transaction_id');
END;
$migration$;
ALTER TABLE public.guest_purchases
  ADD COLUMN transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  ALTER COLUMN session_id DROP NOT NULL,
  DROP CONSTRAINT guest_purchases_session_id_check,
  ADD CONSTRAINT guest_purchases_order_ref_chk CHECK (
    (session_id IS NOT NULL OR transaction_id IS NOT NULL)
    AND (session_id IS NULL OR (length(session_id) BETWEEN 1 AND 255 AND session_id ~* '^(cs_|pi_)[a-zA-Z0-9_]+$'))
  );
UPDATE public.guest_purchases g SET transaction_id = p.id
FROM public.payment_transactions p WHERE p.session_id = g.session_id;
CREATE UNIQUE INDEX guest_purchases_transaction_idx ON public.guest_purchases(transaction_id) WHERE transaction_id IS NOT NULL;
ALTER TABLE public.products ADD COLUMN allow_repeat_purchase boolean NOT NULL DEFAULT false;

-- ===== Source: 20261022192147_order_placement.sql =====
-- Shared reservation consumption preserves the existing Stripe completion behavior.
CREATE FUNCTION public._redeem_coupon_for_order(
  coupon_id_param uuid, current_user_id uuid, existing_user_id uuid,
  customer_email_param text, transaction_id_var uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
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

END;
$$;
REVOKE ALL ON FUNCTION public._redeem_coupon_for_order(uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._redeem_coupon_for_order(uuid,uuid,uuid,text,uuid) TO service_role;

CREATE FUNCTION public.place_order(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  li public.payment_line_items%ROWTYPE;
  product public.products%ROWTYPE;
  entry jsonb;
  saved_lines jsonb := '[]'::jsonb;
  provider text := coalesce(p_order->>'payment_provider', 'stripe');
  main_id uuid := (p_order->>'product_id')::uuid;
  currency_code text := upper(p_order->>'currency');
  factor numeric := public.currency_minor_factor(currency_code);
  offline boolean := provider = 'bank_transfer';
  main_count integer := 0;
  charge numeric := 0;
  net_sum numeric := 0;
  tax_sum numeric := 0;
  basis numeric;
  tax numeric;
  existing_user uuid;
BEGIN
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
    OR octet_length(p_order::text) > 65536 OR octet_length(p_lines::text) > 131072 THEN
    RAISE EXCEPTION 'Invalid order payload' USING ERRCODE = '22023';
  END IF;
  IF provider NOT IN ('stripe','bank_transfer') OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 21 THEN
    RAISE EXCEPTION 'Invalid order provider or line count' USING ERRCODE = '22023';
  END IF;
  -- Validate all bindings and compute the payable amount before storing any rows.
  FOR entry IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid line'; END IF;
    li := jsonb_populate_record(NULL::public.payment_line_items, entry);
    SELECT * INTO product FROM public.products WHERE id = li.product_id AND is_active FOR SHARE;
    IF NOT FOUND OR upper(product.currency) IS DISTINCT FROM currency_code
      OR upper(li.currency) IS DISTINCT FROM currency_code THEN RAISE EXCEPTION 'Invalid line product or currency'; END IF;
    IF li.quantity IS NULL OR li.quantity NOT BETWEEN 1 AND 100
      OR li.unit_price IS NULL OR li.unit_price NOT BETWEEN 0 AND 99999999
      OR li.total_price IS DISTINCT FROM li.unit_price * li.quantity
      OR li.discounted_total IS NULL OR li.discounted_total NOT BETWEEN 0 AND 99999999
      OR li.discounted_total * factor <> round(li.discounted_total * factor)
      OR li.unit_price * factor <> round(li.unit_price * factor)
      OR (li.vat_rate IS NOT NULL AND li.vat_rate NOT BETWEEN 0 AND 100)
      OR (li.tax_behavior IS NOT NULL AND li.tax_behavior NOT IN ('inclusive','exclusive')) THEN
      RAISE EXCEPTION 'Invalid line pricing';
    END IF;
    IF li.item_type = 'main_product' AND li.product_id = main_id AND li.order_bump_id IS NULL THEN
      main_count := main_count + 1;
    ELSIF li.item_type = 'order_bump' AND li.quantity = 1 AND EXISTS (
      SELECT 1 FROM public.order_bumps ob WHERE ob.id = li.order_bump_id
        AND ob.main_product_id = main_id AND ob.bump_product_id = li.product_id AND ob.is_active
    ) THEN NULL;
    ELSE RAISE EXCEPTION 'Invalid order line binding'; END IF;
    basis := round(li.discounted_total * factor);
    tax := CASE WHEN coalesce(li.vat_exempt, false) OR coalesce(li.vat_rate, 0) = 0 OR li.tax_behavior IS NULL THEN 0
      WHEN li.tax_behavior = 'inclusive' THEN round(basis * li.vat_rate / (100 + li.vat_rate))
      ELSE round(basis * li.vat_rate / 100) END;
    charge := charge + basis + CASE WHEN li.tax_behavior = 'exclusive' THEN tax ELSE 0 END;
    net_sum := net_sum + basis - CASE WHEN li.tax_behavior = 'inclusive' THEN tax ELSE 0 END;
    tax_sum := tax_sum + tax;
    li.net_amount := basis - CASE WHEN li.tax_behavior = 'inclusive' THEN tax ELSE 0 END;
    li.tax_amount := tax;
    saved_lines := saved_lines || jsonb_build_array(to_jsonb(li));
  END LOOP;
  IF main_count <> 1 THEN RAISE EXCEPTION 'Exactly one main product is required'; END IF;
  INSERT INTO public.payment_transactions (
    payment_provider, pricing_snapshot_version, product_id, customer_email, user_id,
    session_id, stripe_payment_intent_id, coupon_id, livemode, status, amount, currency,
    order_details, metadata, custom_field_values, expires_at, tax_snapshot_status, net_total, tax_total
  ) VALUES (
    provider, 1, main_id, p_order->>'customer_email', (p_order->>'user_id')::uuid,
    p_order->>'session_id', p_order->>'stripe_payment_intent_id', (p_order->>'coupon_id')::uuid,
    coalesce((p_order->>'livemode')::boolean, false), CASE WHEN offline THEN 'awaiting_payment' ELSE 'pending' END,
    charge, currency_code, p_order->'order_details', coalesce(p_order->'metadata','{}'::jsonb),
    coalesce(p_order->'custom_field_values','{}'::jsonb), (p_order->>'expires_at')::timestamptz,
    CASE WHEN offline THEN 'local' ELSE 'none' END,
    CASE WHEN offline THEN net_sum END, CASE WHEN offline THEN tax_sum END
  ) RETURNING * INTO tx;
  FOR entry IN SELECT value FROM jsonb_array_elements(saved_lines) LOOP
    li := jsonb_populate_record(NULL::public.payment_line_items, entry);
    INSERT INTO public.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price, discounted_total,
      currency, product_name, order_bump_id, access_duration_override, vat_rate, tax_behavior, vat_exempt, net_amount, tax_amount
    ) VALUES (
      tx.id, li.product_id, li.item_type, li.quantity, li.unit_price, li.total_price, li.discounted_total,
      currency_code, li.product_name, li.order_bump_id, li.access_duration_override, li.vat_rate,
      li.tax_behavior, coalesce(li.vat_exempt, false),
      CASE WHEN offline THEN li.net_amount END, CASE WHEN offline THEN li.tax_amount END
    );
  END LOOP;
  IF offline AND tx.coupon_id IS NOT NULL THEN
    SELECT id INTO existing_user FROM auth.users WHERE lower(email) = lower(tx.customer_email) AND email_confirmed_at IS NOT NULL;
    PERFORM public._redeem_coupon_for_order(tx.coupon_id, tx.user_id, existing_user, tx.customer_email, tx.id);
  END IF;
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'order_number', tx.order_number, 'amount', tx.amount);
END;
$$;
REVOKE ALL ON FUNCTION public.place_order(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb,jsonb) TO service_role;

CREATE FUNCTION public.cancel_unpaid_order(p_transaction_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  redeemed uuid;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Cancellation reason required'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider <> 'bank_transfer' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  IF tx.status = 'cancelled' THEN RETURN jsonb_build_object('success', true, 'already_cancelled', true); END IF;
  IF tx.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id = tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count = greatest(0, current_usage_count - 1) WHERE id = redeemed;
  END LOOP;
  UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now() WHERE id = tx.id;
  PERFORM public.log_admin_action('cancel_unpaid_order', 'payment_transaction', tx.id::text,
    jsonb_build_object('reason', p_reason, 'coupon_id', tx.coupon_id, 'transaction_id', tx.id));
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_unpaid_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_order(uuid,text) TO service_role;

-- ===== Source: 20261022210000_order_completion_tail.sql =====
-- Shared completion uses the persisted order lines for access and counters.
CREATE FUNCTION public.increment_sale_quantity_sold(p_product_id uuid, p_quantity integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid sale quantity';
  END IF;
  UPDATE public.products SET sale_quantity_sold = coalesce(sale_quantity_sold, 0) + p_quantity
  WHERE id = p_product_id AND sale_price > 0;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.increment_sale_quantity_sold(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_sale_quantity_sold(uuid,integer) TO service_role;

CREATE FUNCTION public._order_grant_and_record(
  p_transaction_id uuid, p_user_id uuid, p_existing_user_id uuid,
  p_requested_user_id uuid, p_coupon_id uuid, p_coupon_mode text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  transaction_id_var uuid := p_transaction_id;
  current_user_id uuid := p_user_id;
  existing_user_id uuid := p_existing_user_id;
  user_id_param uuid := p_requested_user_id;
  product_id_param uuid;
  customer_email_param text;
  amount_total numeric;
  session_id_param text;
  bump_count integer;
  bump_rec record;
BEGIN
  SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id = p_transaction_id;
  product_id_param := tx.product_id;
  customer_email_param := tx.customer_email;
  amount_total := tx.amount;
  session_id_param := tx.session_id;
  SELECT count(*) INTO bump_count FROM public.payment_line_items
    WHERE transaction_id = tx.id AND item_type = 'order_bump';
  IF p_coupon_mode IS NULL OR p_coupon_mode NOT IN ('consume_reservation','already_redeemed','none')
    OR (p_coupon_mode = 'none' AND p_coupon_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid coupon mode';
  END IF;
  IF p_coupon_mode = 'consume_reservation' THEN
    PERFORM public._redeem_coupon_for_order(p_coupon_id, current_user_id, existing_user_id, customer_email_param, tx.id);
  ELSIF p_coupon_mode = 'already_redeemed' AND p_coupon_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.coupon_redemptions WHERE transaction_id = tx.id AND coupon_id = p_coupon_id
  ) THEN RAISE EXCEPTION 'Order coupon has not been redeemed';
  END IF;
  IF tx.pricing_snapshot_version IS NULL THEN
    PERFORM public.increment_sale_quantity_sold(product_id_param);
  ELSE
    FOR bump_rec IN SELECT product_id, quantity FROM public.payment_line_items WHERE transaction_id = tx.id LOOP
      PERFORM public.increment_sale_quantity_sold(bump_rec.product_id, bump_rec.quantity);
    END LOOP;
  END IF;
    IF current_user_id IS NOT NULL THEN
      PERFORM public.grant_product_and_bundle_components(current_user_id, product_id_param);

      FOR bump_rec IN
        SELECT product_id, access_duration_override FROM public.payment_line_items
        WHERE transaction_id = transaction_id_var AND item_type = 'order_bump'
      LOOP
        PERFORM public.grant_product_access_service_role(current_user_id, bump_rec.product_id,
          override_duration_days_param => bump_rec.access_duration_override);
      END LOOP;

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
      INSERT INTO public.guest_purchases (customer_email, product_id, transaction_amount, session_id, transaction_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param, transaction_id_var);

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param
      );
    END IF;

END;
$$;
REVOKE ALL ON FUNCTION public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text) TO service_role;

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
  saved_tx public.payment_transactions%ROWTYPE;
  saved_main public.payment_line_items%ROWTYPE;
  saved_total numeric;

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

  SELECT * INTO saved_tx FROM public.payment_transactions
  WHERE session_id = session_id_param OR (pi_param IS NOT NULL AND payment_transactions.stripe_payment_intent_id = pi_param)
  LIMIT 1 FOR UPDATE;
  IF saved_tx.pricing_snapshot_version IS NOT NULL THEN
    SELECT * INTO saved_main FROM public.payment_line_items
      WHERE transaction_id = saved_tx.id AND item_type = 'main_product';
    IF saved_tx.payment_provider <> 'stripe' OR saved_tx.product_id IS DISTINCT FROM product_id_param
      OR saved_main.product_id IS DISTINCT FROM product_id_param
      OR (SELECT count(*) FROM public.payment_line_items WHERE transaction_id = saved_tx.id AND item_type = 'main_product') <> 1
      OR saved_tx.coupon_id IS DISTINCT FROM coupon_id_param
      OR upper(saved_tx.currency) IS DISTINCT FROM upper(currency_param)
      OR EXISTS (SELECT 1 FROM unnest(bump_product_ids_param) bid WHERE NOT EXISTS (
        SELECT 1 FROM public.payment_line_items li WHERE li.transaction_id = saved_tx.id
          AND li.item_type = 'order_bump' AND li.product_id = bid))
      OR EXISTS (SELECT 1 FROM public.payment_line_items WHERE transaction_id = saved_tx.id
        AND (discounted_total IS NULL OR upper(currency) IS DISTINCT FROM upper(currency_param))) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Saved order details do not match', 'error_kind', 'data');
    END IF;
    SELECT round(sum(discounted_total) * minor_factor) INTO saved_total
      FROM public.payment_line_items WHERE transaction_id = saved_tx.id;
    charge_basis := CASE WHEN saved_main.tax_behavior = 'exclusive' THEN coalesce(amount_subtotal_param, amount_total) ELSE amount_total END;
    IF charge_basis IS DISTINCT FROM saved_total THEN
      RETURN jsonb_build_object('success', false, 'error', 'Saved order amount does not match', 'error_kind', 'data');
    END IF;
    IF saved_tx.status = 'pending' THEN
      SELECT id INTO existing_user_id FROM auth.users
        WHERE email = customer_email_param AND email_confirmed_at IS NOT NULL;
      current_user_id := coalesce(current_user_id, existing_user_id);
      UPDATE public.payment_transactions SET status = 'completed', fulfillment_pending = true,
        user_id = current_user_id, customer_email = customer_email_param, updated_at = now()
        WHERE id = saved_tx.id;
      RETURN public._order_grant_and_record(saved_tx.id, current_user_id, existing_user_id,
        user_id_param, coupon_id_param, 'consume_reservation') || jsonb_build_object('pricing_source', 'snapshot');
    END IF;
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

    RETURN public._order_grant_and_record(transaction_id_var, current_user_id, existing_user_id,
      user_id_param, coupon_id_param, 'consume_reservation');

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
    IF tx.payment_provider <> 'stripe'
       OR tx.product_id IS DISTINCT FROM product_id_param
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
    'bump_product_ids', coalesce(bump_product_ids_param, '{}'::uuid[]),
    'pricing_source', CASE WHEN tx.pricing_snapshot_version IS NULL THEN 'legacy' ELSE 'snapshot' END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric) TO service_role;

-- ===== Source: 20261022211000_offline_order_completion.sql =====
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

-- ===== Source: 20261023001721_checkout_profiles.sql =====
-- Per-product checkout profiles and pending order module details.
ALTER TABLE public.payment_transactions DROP CONSTRAINT payment_transactions_order_details_check;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_order_details_check CHECK (
  order_details IS NULL OR (jsonb_typeof(order_details) = 'object' AND octet_length(order_details::text) <= 65536)
);
COMMENT ON COLUMN public.payment_transactions.order_details IS 'Versioned order module details (max 65536 bytes).';
ALTER TABLE public.products ADD COLUMN checkout_profile jsonb;
ALTER TABLE public.products ADD CONSTRAINT products_checkout_profile_check CHECK (
  checkout_profile IS NULL OR (jsonb_typeof(checkout_profile) = 'object' AND octet_length(checkout_profile::text) <= 8192)
);
GRANT SELECT (checkout_profile) ON public.products TO anon, authenticated;

CREATE FUNCTION public.audit_checkout_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.checkout_profile IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND OLD.checkout_profile IS DISTINCT FROM NEW.checkout_profile) THEN
    INSERT INTO public.audit_log(table_name, operation, new_values, user_id, performed_by)
    VALUES ('products', 'UPDATE', jsonb_build_object('action', 'product.checkout_profile.update', 'product_id', NEW.id,
      'enabled', NEW.checkout_profile IS NOT NULL), (select auth.uid()), (select auth.uid()));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_checkout_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER products_checkout_profile_audit AFTER INSERT OR UPDATE OF checkout_profile ON public.products
FOR EACH ROW EXECUTE FUNCTION public.audit_checkout_profile();

CREATE FUNCTION public.set_payment_order_details(
  p_details jsonb, p_product_id uuid, p_quantity integer,
  p_session_id text DEFAULT NULL, p_payment_intent_id text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; v_quantity integer;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object' OR octet_length(p_details::text) > 65536
     OR p_product_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100
     OR (p_session_id IS NULL) = (p_payment_intent_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid order details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tx FROM public.payment_transactions
    WHERE (session_id = p_session_id OR stripe_payment_intent_id = p_payment_intent_id)
      AND product_id = p_product_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT quantity INTO v_quantity FROM public.payment_line_items
    WHERE transaction_id = tx.id AND product_id = p_product_id AND item_type = 'main_product';
  IF v_quantity IS DISTINCT FROM p_quantity THEN RETURN -1; END IF;
  UPDATE public.payment_transactions SET order_details = coalesce(order_details, '{}'::jsonb) || p_details, updated_at = now() WHERE id = tx.id;
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION public.set_payment_order_details(jsonb,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_order_details(jsonb,uuid,integer,text,text) TO service_role;

-- ===== Source: 20261023013712_checkout_profile_completion.sql =====
-- Preserve completion while recording missing required checkout modules.
-- @see admin-panel/src/lib/checkout-modules/registry.ts
CREATE FUNCTION public.mark_checkout_details_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  profile jsonb;
  module jsonb;
  details jsonb := coalesce(NEW.order_details, '{}'::jsonb);
  missing boolean := false;
BEGIN
  SELECT checkout_profile INTO profile FROM public.products WHERE id = NEW.product_id;
  IF profile IS NULL THEN RETURN NEW; END IF;
  FOR module IN SELECT value FROM jsonb_array_elements(profile->'modules') LOOP
    CASE module->>'id'
      WHEN 'buyer' THEN
        missing := missing OR coalesce(jsonb_typeof(details->'buyer') <> 'object'
          OR details->'buyer'->>'type' NOT IN ('person', 'organization'), true);
      WHEN 'recipient' THEN
        IF details->'buyer'->>'type' = 'organization' THEN
          missing := missing OR coalesce(jsonb_typeof(details->'recipient'->'differs') <> 'boolean', true);
        END IF;
      WHEN 'quantity' THEN
        missing := missing OR coalesce(jsonb_typeof(details->'quantity'->'value') <> 'number', true);
      WHEN 'phone' THEN
        IF (module->>'required')::boolean THEN
          missing := missing OR coalesce(length(details->'phone'->>'value'), 0) = 0;
        END IF;
      WHEN 'participants' THEN
        IF (module->>'required')::boolean THEN
          missing := missing OR coalesce(jsonb_typeof(details->'participants'->'people') <> 'array', true);
          IF jsonb_typeof(details->'participants'->'people') = 'array' THEN
            missing := missing OR jsonb_array_length(details->'participants'->'people') = 0;
          END IF;
        END IF;
      ELSE NULL;
    END CASE;
  END LOOP;
  IF missing THEN
    NEW.order_details := details || '{"details_missing":true}'::jsonb;
    RAISE LOG '[checkout] Required order details missing for transaction %', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_checkout_details_missing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_checkout_details_missing() TO service_role;
CREATE TRIGGER checkout_details_on_completion
  BEFORE INSERT OR UPDATE OF status ON public.payment_transactions
  FOR EACH ROW WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.mark_checkout_details_missing();

-- ===== Source: 20261023080000_event_reservations.sql =====
-- Event schedules, authoritative availability and atomic order reservations.
ALTER TABLE public.products ADD COLUMN event_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD CONSTRAINT products_event_mode_check
  CHECK (NOT event_mode OR (product_type = 'one_time' AND NOT is_bundle AND NOT allow_custom_price));
GRANT SELECT (event_mode) ON public.products TO anon, authenticated;
CREATE FUNCTION public.enable_event_repeat_purchase() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.event_mode AND (TG_OP = 'INSERT' OR NOT OLD.event_mode) THEN NEW.allow_repeat_purchase := true; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enable_event_repeat_purchase() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER products_event_repeat BEFORE INSERT OR UPDATE OF event_mode ON public.products
FOR EACH ROW EXECUTE FUNCTION public.enable_event_repeat_purchase();

CREATE TABLE public.product_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL, ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'Europe/Warsaw', title text, venue text,
  online_url text CHECK (online_url IS NULL OR online_url ~ '^https://[^[:space:]]+$'), extra_days text,
  capacity integer CHECK (capacity > 0), sales_open boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE TRIGGER product_sessions_updated_at BEFORE UPDATE ON public.product_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX product_sessions_product_idx ON public.product_sessions(product_id);
CREATE TABLE public.product_price_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.product_sessions(id) ON DELETE CASCADE,
  label text, price numeric NOT NULL CHECK (price >= 0), seats integer CHECK (seats > 0),
  sale_ends_at timestamptz, sort integer NOT NULL, UNIQUE(session_id, sort), UNIQUE(id, session_id)
);
CREATE TABLE public.seat_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.product_sessions(id),
  tier_id uuid NOT NULL,
  transaction_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('held','confirmed','released')),
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz, released_at timestamptz,
  FOREIGN KEY (tier_id, session_id) REFERENCES public.product_price_tiers(id, session_id),
  CHECK (status <> 'held' OR expires_at IS NOT NULL)
);
CREATE INDEX seat_reservations_session_status_idx ON public.seat_reservations(session_id, status);
CREATE INDEX seat_reservations_tier_status_idx ON public.seat_reservations(tier_id, status);
CREATE INDEX seat_reservations_expiry_idx ON public.seat_reservations(status, expires_at);
ALTER TABLE public.payment_line_items ADD COLUMN session_id uuid, ADD COLUMN tier_id uuid,
  ADD COLUMN session_label text, ADD COLUMN session_starts_at timestamptz;
ALTER TABLE public.product_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seat_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.product_price_tiers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seat_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_sessions TO service_role;
GRANT ALL ON public.product_price_tiers TO service_role;
GRANT ALL ON public.seat_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_price_tiers TO authenticated;
GRANT SELECT ON public.seat_reservations TO authenticated;
CREATE POLICY event_sessions_admin ON public.product_sessions TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));
CREATE POLICY event_tiers_admin ON public.product_price_tiers TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));
CREATE POLICY event_reservations_admin ON public.seat_reservations FOR SELECT TO authenticated USING ((select public.is_admin()));

CREATE FUNCTION public.event_availability(p_product_id uuid, p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
WITH sessions AS (
  SELECT s.*, greatest(0, s.capacity - coalesce((SELECT sum(r.quantity) FROM public.seat_reservations r
    WHERE r.session_id = s.id AND (r.status = 'confirmed' OR (r.status = 'held' AND r.expires_at > p_at))),0)) remaining_count
  FROM public.product_sessions s WHERE s.product_id = p_product_id
), tiers AS (
  SELECT t.*, CASE WHEN t.seats IS NULL THEN NULL ELSE greatest(0, t.seats - coalesce((SELECT sum(r.quantity)
    FROM public.seat_reservations r WHERE r.tier_id = t.id
    AND (r.status = 'confirmed' OR (r.status = 'held' AND r.expires_at > p_at))),0)) END tier_remaining
  FROM public.product_price_tiers t JOIN sessions s ON s.id = t.session_id
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'timezone', s.timezone,
  'title', s.title, 'venue', s.venue, 'extra_days', s.extra_days,
  'remaining', CASE WHEN s.capacity IS NULL THEN NULL ELSE s.remaining_count END,
  'sold_out', (s.capacity IS NOT NULL AND s.remaining_count = 0) OR
    (EXISTS (SELECT 1 FROM tiers t WHERE t.session_id=s.id) AND NOT EXISTS (
      SELECT 1 FROM tiers t WHERE t.session_id=s.id AND (t.tier_remaining IS NULL OR t.tier_remaining > 0))),
  'current_tier', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'label', c.label,
    'price', c.price, 'seats_left', c.tier_remaining, 'ends_at', c.sale_ends_at) END,
  'current_tier_seats_left', c.tier_remaining, 'current_tier_ends_at', c.sale_ends_at,
  'cheaper_sold_out', EXISTS (SELECT 1 FROM tiers t WHERE t.session_id=s.id AND t.price < c.price
    AND (t.tier_remaining = 0 OR t.sale_ends_at <= p_at)),
  'next_tier_price', (SELECT t.price FROM tiers t WHERE t.session_id=s.id
    AND (t.price, t.sort) > (c.price, c.sort) ORDER BY t.price, t.sort LIMIT 1)
) ORDER BY s.sort, s.starts_at, s.id), '[]'::jsonb)
FROM sessions s LEFT JOIN LATERAL (
  SELECT t.* FROM tiers t WHERE t.session_id=s.id AND s.sales_open AND s.starts_at > p_at
    AND (s.capacity IS NULL OR s.remaining_count > 0) AND (t.tier_remaining IS NULL OR t.tier_remaining > 0)
    AND (t.sale_ends_at IS NULL OR t.sale_ends_at > p_at) ORDER BY t.price, t.sort LIMIT 1
) c ON true;
$$;
REVOKE ALL ON FUNCTION public.event_availability(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_availability(uuid,timestamptz) TO service_role;

-- This projection contains public presentation only; HTTP callers apply their visitor limit.
CREATE FUNCTION public.public_event_availability(p_product_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.products WHERE id=p_product_id AND event_mode AND is_active AND is_listed)
  THEN public.event_availability(p_product_id) ELSE '[]'::jsonb END;
$$;
REVOKE ALL ON FUNCTION public.public_event_availability(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_event_availability(uuid) TO service_role;

CREATE FUNCTION public.event_hold_limits(p_session_id uuid, p_email text, p_ip text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT count(*) FILTER (WHERE lower(t.customer_email)=lower(p_email)) < 3
  AND count(*) FILTER (WHERE t.metadata->>'event_ip'=p_ip) < 5
FROM public.seat_reservations r JOIN public.payment_transactions t ON t.id=r.transaction_id
WHERE r.session_id=p_session_id AND r.status='held' AND r.expires_at > now();
$$;
REVOKE ALL ON FUNCTION public.event_hold_limits(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_hold_limits(uuid,text,text) TO service_role;

-- Keep the existing order validation and coupon accounting in the same transaction.
ALTER FUNCTION public.place_order(jsonb,jsonb) RENAME TO _place_order_without_event;
REVOKE ALL ON FUNCTION public._place_order_without_event(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.place_order(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  event boolean; sid uuid; selected jsonb; tier jsonb; main jsonb; result jsonb;
  deadline timestamptz; q integer; txid uuid;
BEGIN
  SELECT event_mode INTO event FROM public.products WHERE id=(p_order->>'product_id')::uuid FOR SHARE;
  IF NOT coalesce(event,false) THEN RETURN public._place_order_without_event(p_order,p_lines); END IF;
  SELECT value INTO main FROM jsonb_array_elements(p_lines) WHERE value->>'item_type'='main_product';
  sid := (main->>'session_id')::uuid; q := (main->>'quantity')::integer;
  IF sid IS NULL OR q IS NULL OR q NOT BETWEEN 1 AND 100 OR coalesce(p_order->>'customer_email','')='' THEN
    RAISE EXCEPTION 'Invalid event order' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(sid::text, 0));
  IF NOT public.event_hold_limits(sid,p_order->>'customer_email',p_order->'metadata'->>'event_ip') THEN
    RAISE EXCEPTION 'event_hold_limit' USING ERRCODE='P0429';
  END IF;
  SELECT value INTO selected FROM jsonb_array_elements(public.event_availability((p_order->>'product_id')::uuid))
    WHERE value->>'id'=sid::text;
  tier := selected->'current_tier';
  IF tier IS NULL OR tier='null'::jsonb OR (selected->>'remaining')::integer < q
    OR (tier->>'seats_left')::integer < q THEN RAISE EXCEPTION 'sold_out' USING ERRCODE='P0409'; END IF;
  IF (main->>'unit_price')::numeric IS DISTINCT FROM (tier->>'price')::numeric THEN
    RAISE EXCEPTION 'event_price_changed' USING ERRCODE='P0409';
  END IF;
  deadline := coalesce((p_order->>'expires_at')::timestamptz, now()+interval '30 minutes');
  IF deadline <= now() OR deadline > now()+interval '31 minutes' THEN RAISE EXCEPTION 'Invalid event expiry'; END IF;
  p_order := jsonb_set(p_order,'{expires_at}',to_jsonb(deadline));
  result := public._place_order_without_event(p_order,p_lines); txid := (result->>'transaction_id')::uuid;
  UPDATE public.payment_line_items SET session_id=sid, tier_id=(tier->>'id')::uuid,
    session_label=selected->>'title', session_starts_at=(selected->>'starts_at')::timestamptz
    WHERE transaction_id=txid AND item_type='main_product';
  INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,expires_at)
    VALUES (sid,(tier->>'id')::uuid,txid,q,'held',deadline);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.place_order(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb,jsonb) TO service_role;

CREATE FUNCTION public.release_event_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('abandoned','cancelled','refunded','failed','expired') THEN
    UPDATE public.seat_reservations SET status='released', released_at=now()
      WHERE transaction_id=NEW.id AND status IN ('held','confirmed');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_event_order() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER event_order_release AFTER UPDATE OF status ON public.payment_transactions
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.release_event_order();

CREATE FUNCTION public.expire_seat_reservations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  UPDATE public.seat_reservations SET status='released',released_at=now() WHERE status='held' AND expires_at<=now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.expire_seat_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_seat_reservations() TO service_role;

CREATE FUNCTION public.confirm_event_order(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE li public.payment_line_items%ROWTYPE; r public.seat_reservations%ROWTYPE;
  available integer; tier_available integer; s public.product_sessions%ROWTYPE; tier public.product_price_tiers%ROWTYPE;
BEGIN
  FOR li IN SELECT * FROM public.payment_line_items WHERE transaction_id=p_transaction_id AND session_id IS NOT NULL ORDER BY session_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(li.session_id::text,0));
    SELECT * INTO r FROM public.seat_reservations WHERE transaction_id=p_transaction_id FOR UPDATE;
    IF r.status='confirmed' THEN CONTINUE; END IF;
    IF r.status='held' AND r.expires_at>now() THEN
      UPDATE public.seat_reservations SET status='confirmed',confirmed_at=now() WHERE id=r.id;
      CONTINUE;
    END IF;
    SELECT * INTO s FROM public.product_sessions WHERE id=li.session_id;
    SELECT * INTO tier FROM public.product_price_tiers WHERE id=li.tier_id;
    SELECT s.capacity-coalesce(sum(quantity),0) INTO available FROM public.seat_reservations
      WHERE session_id=li.session_id AND transaction_id<>p_transaction_id
        AND (status='confirmed' OR (status='held' AND expires_at>now()));
    SELECT tier.seats-coalesce(sum(quantity),0) INTO tier_available FROM public.seat_reservations
      WHERE tier_id=li.tier_id AND transaction_id<>p_transaction_id
        AND (status='confirmed' OR (status='held' AND expires_at>now()));
    IF (s.capacity IS NOT NULL AND available<li.quantity) OR (tier.seats IS NOT NULL AND tier_available<li.quantity) THEN
      UPDATE public.payment_transactions SET metadata=coalesce(metadata,'{}'::jsonb)||'{"oversold":true}'::jsonb WHERE id=p_transaction_id;
      UPDATE public.seat_reservations SET status='released',released_at=now() WHERE id=r.id;
      INSERT INTO public.audit_log(table_name,operation,new_values) VALUES ('payment_transactions','UPDATE',
        jsonb_build_object('action','event.oversold','transaction_id',p_transaction_id,'session_id',li.session_id));
      RAISE LOG 'event.oversold transaction=% session=%',p_transaction_id,li.session_id;
    ELSE
      INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,confirmed_at)
        VALUES (li.session_id,li.tier_id,p_transaction_id,li.quantity,'confirmed',now())
        ON CONFLICT (transaction_id) DO UPDATE SET status='confirmed',confirmed_at=now(),released_at=NULL;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.confirm_event_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_event_order(uuid) TO service_role;