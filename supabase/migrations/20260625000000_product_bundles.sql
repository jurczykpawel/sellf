-- Product bundles: a bundle is a product (is_bundle=true) linked to component products via
-- bundle_items (many-to-many). Single migration file per project rule (last release = v2026.6.16).
-- Components are granted on purchase via grant_product_and_bundle_components (shared by the
-- completion RPC and guest-claim; also future-proofs a cart).

SET client_min_messages = warning;

-- 1) Bundle flag on products ---------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT false;

-- 2) Components join table ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bundle_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  display_order        INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bundle_product_id, component_product_id),
  CHECK (bundle_product_id <> component_product_id)
);
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON public.bundle_items (bundle_product_id, display_order);
CREATE INDEX IF NOT EXISTS idx_bundle_items_component ON public.bundle_items (component_product_id);

-- 3) Validation trigger: parent is a bundle, component is a non-bundle one_time product -----------
CREATE OR REPLACE FUNCTION public.validate_bundle_item()
RETURNS TRIGGER AS $$
DECLARE
  parent_is_bundle BOOLEAN;
  child_is_bundle  BOOLEAN;
  child_type       TEXT;
BEGIN
  SELECT is_bundle INTO parent_is_bundle FROM public.products WHERE id = NEW.bundle_product_id;
  SELECT is_bundle, product_type INTO child_is_bundle, child_type FROM public.products WHERE id = NEW.component_product_id;

  IF parent_is_bundle IS NOT TRUE THEN
    RAISE EXCEPTION 'bundle_product_id % is not a bundle (is_bundle=true required)', NEW.bundle_product_id;
  END IF;
  IF child_is_bundle IS TRUE THEN
    RAISE EXCEPTION 'nested bundles are not allowed: component % is itself a bundle', NEW.component_product_id;
  END IF;
  IF COALESCE(child_type, 'one_time') <> 'one_time' THEN
    RAISE EXCEPTION 'subscription products cannot be bundle components (component %)', NEW.component_product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS validate_bundle_item_trigger ON public.bundle_items;
CREATE TRIGGER validate_bundle_item_trigger
  BEFORE INSERT OR UPDATE ON public.bundle_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_bundle_item();

-- 4) RLS: service-role writes; public read of a bundle's components (for the offer page) ----------
ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bundle_items service role" ON public.bundle_items;
CREATE POLICY "bundle_items service role" ON public.bundle_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- A01 (defense-in-depth): scope the public read to EXACTLY when anon can read the bundle product
-- itself. USING (true) leaked every bundle->component mapping, including for DRAFT/inactive bundles
-- (pre-announcement BI: a hidden bundle grouped with existing products reveals an unlaunched bundle).
-- The EXISTS predicate mirrors, verbatim, the public branch of the products anon SELECT policy
-- ("SELECT policy for products" in 20260521000000_products_temporal_rls_and_config_grants.sql:
-- is_active=true within the availability window, OR a waitlist-enabled inactive product) so a row is
-- visible iff its bundle product is — no edge where one is readable but not the other. Admins keep
-- full visibility for draft-editing in the admin panel (authenticated browser client).
DROP POLICY IF EXISTS "bundle_items public read" ON public.bundle_items;
CREATE POLICY "bundle_items public read" ON public.bundle_items
  FOR SELECT TO anon, authenticated
  USING (
    (select public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = bundle_product_id
        AND (
          (
            p.is_active = true
            AND (p.available_from IS NULL OR p.available_from <= now())
            AND (p.available_until IS NULL OR p.available_until >= now())
          )
          OR (p.is_active = false AND p.enable_waitlist = true)
        )
    )
  );
REVOKE ALL ON public.bundle_items FROM anon, authenticated;
GRANT SELECT ON public.bundle_items TO anon, authenticated;
GRANT ALL ON public.bundle_items TO service_role;

-- 5) Component grant helper: idempotent grant of a bundle COMPONENT, regardless of is_active ------
-- A buyer who paid for a bundle must receive every component. is_active governs whether a product
-- can be sold STANDALONE — it does not govern bundle membership. The shared
-- grant_product_access_service_role filters on is_active = true (correct for its callers: the payment
-- completion RPC and order bumps), so it would silently skip an inactive component. This helper
-- mirrors that function's upsert + version/expiry semantics WITHOUT the is_active gate, so it is used
-- ONLY on the component path. Components inherit only auto_grant_duration_days (no override).
CREATE OR REPLACE FUNCTION public.grant_bundle_component_access(
  user_id_param UUID,
  product_id_param UUID,
  max_retries INTEGER DEFAULT 3
) RETURNS JSONB AS $$
DECLARE
  effective_duration INTEGER;
  existing_record RECORD;
  new_expires_at TIMESTAMPTZ := NULL;
  final_duration INTEGER := NULL;
  retry_count INTEGER := 0;
  rows_affected INTEGER;
BEGIN
  IF user_id_param IS NULL OR product_id_param IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User ID and Product ID are required');
  END IF;

  -- Resolve the component's auto-grant duration WITHOUT requiring is_active (unlike
  -- grant_product_access_service_role). A missing component product is a real failure.
  SELECT auto_grant_duration_days INTO effective_duration
  FROM public.products WHERE id = product_id_param;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Component product not found');
  END IF;

  -- Optimistic-locking upsert (mirrors grant_product_access_service_role; never downgrades a
  -- permanent grant, extends active limited grants, re-grants from now on expired ones).
  WHILE retry_count < max_retries LOOP
    SELECT
      access_expires_at,
      version,
      (access_expires_at IS NULL) AS has_permanent_access,
      (access_expires_at IS NOT NULL AND access_expires_at > NOW()) AS has_active_access
    INTO existing_record
    FROM public.user_product_access
    WHERE user_id = user_id_param AND product_id = product_id_param;

    IF FOUND THEN
      IF existing_record.has_permanent_access THEN
        new_expires_at := NULL;
        final_duration := NULL;
      ELSIF existing_record.has_active_access THEN
        IF effective_duration IS NOT NULL THEN
          new_expires_at := existing_record.access_expires_at + (effective_duration || ' days')::INTERVAL;
          final_duration := effective_duration;
        ELSE
          new_expires_at := NULL;
          final_duration := NULL;
        END IF;
      ELSE
        IF effective_duration IS NOT NULL THEN
          new_expires_at := NOW() + (effective_duration || ' days')::INTERVAL;
          final_duration := effective_duration;
        ELSE
          new_expires_at := NULL;
          final_duration := NULL;
        END IF;
      END IF;

      UPDATE public.user_product_access
      SET
        access_granted_at = NOW(),
        access_duration_days = final_duration,
        access_expires_at = CASE WHEN access_expires_at IS NULL THEN NULL ELSE new_expires_at END,
        version = version + 1
      WHERE user_id = user_id_param AND product_id = product_id_param
        AND version = existing_record.version;

      GET DIAGNOSTICS rows_affected = ROW_COUNT;
      IF rows_affected = 1 THEN
        RETURN jsonb_build_object('success', true, 'operation', 'updated_existing');
      END IF;
      retry_count := retry_count + 1;
      IF retry_count < max_retries THEN PERFORM pg_sleep(0.01 * (2 ^ retry_count)); END IF;
      CONTINUE;
    ELSE
      IF effective_duration IS NOT NULL THEN
        new_expires_at := NOW() + (effective_duration || ' days')::INTERVAL;
        final_duration := effective_duration;
      ELSE
        new_expires_at := NULL;
        final_duration := NULL;
      END IF;

      BEGIN
        INSERT INTO public.user_product_access (
          user_id, product_id, access_duration_days, access_expires_at, access_granted_at, version
        ) VALUES (
          user_id_param, product_id_param, final_duration, new_expires_at, NOW(), 1
        );
        RETURN jsonb_build_object('success', true, 'operation', 'created_new');
      EXCEPTION WHEN unique_violation THEN
        retry_count := retry_count + 1;
        IF retry_count < max_retries THEN PERFORM pg_sleep(0.01 * (2 ^ retry_count)); END IF;
        CONTINUE;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', false, 'error', 'Concurrency conflict after retries');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s';

REVOKE EXECUTE ON FUNCTION public.grant_bundle_component_access(UUID, UUID, INTEGER) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_bundle_component_access(UUID, UUID, INTEGER) TO service_role;

-- 6) Shared grant primitive: grant the product + (if bundle) each component ------------------------
CREATE OR REPLACE FUNCTION public.grant_product_and_bundle_components(
  user_id_param UUID,
  product_id_param UUID,
  override_duration_days_param INTEGER DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  is_bundle_var BOOLEAN;
  comp_rec RECORD;
  comp_result JSONB;
  granted INTEGER := 0;
BEGIN
  PERFORM public.grant_product_access_service_role(
    user_id_param, product_id_param, override_duration_days_param => override_duration_days_param
  );
  granted := granted + 1;

  SELECT is_bundle INTO is_bundle_var FROM public.products WHERE id = product_id_param;
  IF is_bundle_var IS TRUE THEN
    FOR comp_rec IN
      SELECT component_product_id FROM public.bundle_items
      WHERE bundle_product_id = product_id_param
      ORDER BY display_order
    LOOP
      BEGIN
        -- Grants the component regardless of is_active (an inactive component is a SUCCESS).
        comp_result := public.grant_bundle_component_access(user_id_param, comp_rec.component_product_id);
        IF COALESCE((comp_result->>'success')::BOOLEAN, false) THEN
          granted := granted + 1;
        ELSE
          -- Helper returned a real failure (e.g. concurrency conflict, missing product) without
          -- raising. Surface it; the safe-log is wrapped so logging can never escape this loop.
          BEGIN
            PERFORM public.log_admin_action(
              'bundle_component_grant_failure', 'bundle_items', product_id_param::TEXT,
              jsonb_build_object('severity', 'ERROR', 'user_id', user_id_param,
                'component_product_id', comp_rec.component_product_id,
                'error', comp_result->>'error',
                'function_name', 'grant_product_and_bundle_components')
            );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Unexpected raise from the component grant. Isolate it (one bad component must not block
        -- the rest of the bundle) and log safely.
        BEGIN
          PERFORM public.log_admin_action(
            'bundle_component_grant_failure', 'bundle_items', product_id_param::TEXT,
            jsonb_build_object('severity', 'ERROR', 'user_id', user_id_param,
              'component_product_id', comp_rec.component_product_id,
              'error_code', SQLSTATE, 'error_message', SQLERRM,
              'function_name', 'grant_product_and_bundle_components')
          );
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'granted', granted);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.grant_product_and_bundle_components(UUID, UUID, INTEGER) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_product_and_bundle_components(UUID, UUID, INTEGER) TO service_role;

-- 7) Explode bundle access in the payment-completion RPC --------------------------------------------
-- CREATE OR REPLACE the impl by copying its current body verbatim from
-- 20260621000000_legal_docs_vat_tax_and_payment_rpc.sql (the 10-arg version). The ONLY change vs the
-- original is the main-product grant call: grant_product_access_service_role -> grant_product_and_bundle_components,
-- so a bundle purchase grants the bundle AND every component. VAT/line-items stay mode 1a: the bundle
-- remains ONE 'main_product' line; components are NOT itemized. Everything else (params, charge_basis/net
-- logic, the bump loop, ALL payment_line_items inserts, the idempotent re-entry branches) is identical.
-- Postgres replaces functions wholesale, hence the full body. The wrapper
-- process_stripe_payment_completion_with_bump is unchanged (it calls this impl).
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
    WHERE pt.stripe_payment_intent_id = pi_param
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

-- 8) Explode bundle access on guest-claim ----------------------------------------------------------
-- CREATE OR REPLACE claim_guest_purchases_for_user by copying its CURRENT body verbatim from the
-- latest definition (20260521010000_idempotent_completion_and_claim_locking.sql — which itself
-- superseded the 20260310175058 version and added FOR UPDATE OF gp SKIP LOCKED + the
-- payment_transactions user_id backfill). The ONLY change vs that current body is the main grant
-- call: grant_product_access_service_role -> grant_product_and_bundle_components, so a guest who
-- bought a bundle receives the components after registering. The existing item_type='order_bump'
-- line-item loop is UNCHANGED (real bumps still handled there; the primitive handles the bundle's
-- components). Grants/security settings re-issued exactly as the original.
CREATE OR REPLACE FUNCTION public.claim_guest_purchases_for_user(
  p_user_id UUID
) RETURNS json AS $$
DECLARE
  user_email_var TEXT;
  claimed_count INTEGER := 0;
  guest_purchase_record RECORD;
  line_item_rec RECORD;
BEGIN
  -- Rate limiting: 10 calls per hour for claiming purchases
  IF NOT public.check_rate_limit('claim_guest_purchases_for_user', 10, 3600) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Rate limit exceeded. Please wait before trying again.'
    );
  END IF;

  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User ID is required');
  END IF;

  SELECT email INTO user_email_var FROM auth.users WHERE id = p_user_id;

  IF user_email_var IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  IF NOT public.validate_email_format(user_email_var) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email format');
  END IF;

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

    -- Grant access to the main product
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

    -- Grant access for bump products from payment_line_items.
    -- Use the snapshotted access_duration_override per line item so the claim
    -- path resolves the bump's UI override without re-querying order_bumps
    -- (the bump row may have been edited or deleted since the purchase).
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

REVOKE EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(UUID) TO service_role;
