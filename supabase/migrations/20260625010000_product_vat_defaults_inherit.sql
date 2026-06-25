-- New products inherit the shop's VAT stance (default rate + "zwolniony / zw."
-- exemption) regardless of how they are created — admin UI, public v1 API, or
-- direct SQL. The server is the single source of truth for the default; the
-- wizard's client-side seeding is no longer the only mechanism (UI + API parity).
--
-- This implements the intent already documented in 20260621000000:
--   "Default for new products inherits shop_config.is_vat_exempt."

CREATE OR REPLACE FUNCTION public.apply_shop_vat_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tax_rate   numeric;
  v_vat_exempt boolean;
BEGIN
  -- Only fill when the caller expressed no VAT stance. "Unspecified" == the
  -- column defaults: vat_rate IS NULL AND vat_exempt = false. An explicit rate
  -- or an explicit exemption is therefore never overridden.
  IF NEW.vat_rate IS NULL AND NEW.vat_exempt = false THEN
    SELECT tax_rate, is_vat_exempt
      INTO v_tax_rate, v_vat_exempt
      FROM public.shop_config
      ORDER BY created_at
      LIMIT 1;

    IF v_vat_exempt THEN
      NEW.vat_exempt := true;        -- shop is VAT-exempt → product is "zw." by default
    ELSIF v_tax_rate IS NOT NULL THEN
      NEW.vat_rate := v_tax_rate;    -- otherwise copy the shop's default rate
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger functions are fired by the DML itself, not called directly, so the
-- triggering role needs no EXECUTE privilege — lock it down (security rule #7).
REVOKE EXECUTE ON FUNCTION public.apply_shop_vat_defaults() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS products_apply_shop_vat_defaults ON public.products;
CREATE TRIGGER products_apply_shop_vat_defaults
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_shop_vat_defaults();

-- ===== Post-v2026.6.17: OTO skips when OTO product already owned via order bump =====
-- generate_oto_coupon suppressed the funnel when the buyer already owned the OTO
-- product, but only via Check 1 (user_product_access, by auth.users.email) and
-- Check 2 (guest_purchases, by customer_email). When a GUEST buys the OTO product
-- as an ORDER BUMP, the completion RPC writes only the MAIN product into
-- guest_purchases; the bump lands solely in payment_line_items
-- (item_type='order_bump'). So Check 2 missed it and the OTO was re-offered for a
-- product the guest just bought. (Logged-in buyers are fine — their bump is
-- granted into user_product_access, caught by Check 1.)
--
-- Fix (Option B): add Check 3 right after Check 2, reading payment_line_items by
-- email, returning the same 'already_owns_oto_product' skip shape. Everything else
-- is a VERBATIM copy of the definition in 20260515110000_funnel_downsell_and_attribution.sql.

CREATE OR REPLACE FUNCTION public.generate_oto_coupon(
  source_product_id_param UUID,
  customer_email_param TEXT,
  transaction_id_param UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  oto_config RECORD;
  downsell_product RECORD;

  upsell_existing RECORD;
  downsell_existing RECORD;

  upsell_code TEXT;
  upsell_id UUID;
  upsell_expires TIMESTAMPTZ;

  downsell_code TEXT;
  downsell_id UUID;
  downsell_expires TIMESTAMPTZ;
  -- Scalar copies for JSONB return: avoid the "record not assigned yet" trap
  -- when the downsell branch is unconfigured. (PL/pgSQL CASE evaluates every
  -- arm before the predicate, so reading downsell_product.<field> in an
  -- unmatched arm still raises.)
  downsell_product_slug TEXT;
  downsell_product_name TEXT;
  downsell_product_price NUMERIC;
  downsell_product_currency TEXT;

  email_array JSONB;
BEGIN
  email_array := jsonb_build_array(customer_email_param);

  -- ---------------------------------------------------------------------------
  -- IDEMPOTENCY: locate any existing upsell/downsell coupon for this caller.
  -- Strategy mirrors 20260305 (transaction → source_transaction_id; free →
  -- offer+email+role).
  -- ---------------------------------------------------------------------------
  IF transaction_id_param IS NOT NULL THEN
    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           c.is_active, c.current_usage_count, c.usage_limit_global,
           o.oto_product_id, o.duration_minutes, o.downsell_product_id,
           o.downsell_discount_type, o.downsell_discount_value, o.downsell_duration_minutes,
           p.slug AS oto_product_slug, p.name AS oto_product_name,
           p.price AS oto_product_price, p.currency AS oto_product_currency
      INTO upsell_existing
      FROM public.coupons c
      INNER JOIN public.oto_offers o ON c.oto_offer_id = o.id
      INNER JOIN public.products p ON o.oto_product_id = p.id
     WHERE c.source_transaction_id = transaction_id_param
       AND c.is_oto_coupon = true
       AND c.coupon_role = 'upsell'
     LIMIT 1;

    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           c.is_active, c.current_usage_count, c.usage_limit_global,
           dp.id AS downsell_product_id, dp.slug AS downsell_product_slug,
           dp.name AS downsell_product_name, dp.price AS downsell_product_price,
           dp.currency AS downsell_product_currency,
           o.downsell_duration_minutes
      INTO downsell_existing
      FROM public.coupons c
      INNER JOIN public.oto_offers o ON c.oto_offer_id = o.id
      INNER JOIN public.products dp ON o.downsell_product_id = dp.id
     WHERE c.source_transaction_id = transaction_id_param
       AND c.is_oto_coupon = true
       AND c.coupon_role = 'downsell'
     LIMIT 1;
  ELSE
    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           c.is_active, c.current_usage_count, c.usage_limit_global,
           o.oto_product_id, o.duration_minutes, o.downsell_product_id,
           o.downsell_discount_type, o.downsell_discount_value, o.downsell_duration_minutes,
           p.slug AS oto_product_slug, p.name AS oto_product_name,
           p.price AS oto_product_price, p.currency AS oto_product_currency
      INTO upsell_existing
      FROM public.coupons c
      INNER JOIN public.oto_offers o ON c.oto_offer_id = o.id
      INNER JOIN public.products p ON o.oto_product_id = p.id
     WHERE o.source_product_id = source_product_id_param
       AND c.is_oto_coupon = true
       AND c.source_transaction_id IS NULL
       AND c.allowed_emails = email_array
       AND c.coupon_role = 'upsell'
       AND o.is_active = true
     LIMIT 1;

    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           c.is_active, c.current_usage_count, c.usage_limit_global,
           dp.id AS downsell_product_id, dp.slug AS downsell_product_slug,
           dp.name AS downsell_product_name, dp.price AS downsell_product_price,
           dp.currency AS downsell_product_currency,
           o.downsell_duration_minutes
      INTO downsell_existing
      FROM public.coupons c
      INNER JOIN public.oto_offers o ON c.oto_offer_id = o.id
      INNER JOIN public.products dp ON o.downsell_product_id = dp.id
     WHERE o.source_product_id = source_product_id_param
       AND c.is_oto_coupon = true
       AND c.source_transaction_id IS NULL
       AND c.allowed_emails = email_array
       AND c.coupon_role = 'downsell'
       AND o.is_active = true
     LIMIT 1;
  END IF;

  -- PL/pgSQL gotcha: `record IS NOT NULL` is FALSE when ANY column is NULL.
  -- Since our SELECT pulls nullable downsell_* cols from oto_offers, we can't
  -- use that idiom — fall back to the primary key, which is non-null iff a
  -- row was actually found.
  IF upsell_existing.id IS NOT NULL THEN
    -- Already generated. If the coupon is no longer usable, surface that.
    IF upsell_existing.is_active IS DISTINCT FROM true
      OR upsell_existing.expires_at <= NOW()
      OR upsell_existing.current_usage_count >= COALESCE(upsell_existing.usage_limit_global, 999999)
    THEN
      RETURN jsonb_build_object(
        'has_oto', false,
        'reason', 'existing_oto_coupon_unavailable',
        'coupon_code', upsell_existing.code,
        'coupon_id', upsell_existing.id
      );
    END IF;

    RETURN jsonb_build_object(
      'has_oto', true,
      'coupon_code', upsell_existing.code,
      'coupon_id', upsell_existing.id,
      'upsell_code', upsell_existing.code,
      'upsell_coupon_id', upsell_existing.id,
      'oto_product_id', upsell_existing.oto_product_id,
      'oto_product_slug', upsell_existing.oto_product_slug,
      'oto_product_name', upsell_existing.oto_product_name,
      'oto_product_price', upsell_existing.oto_product_price,
      'oto_product_currency', upsell_existing.oto_product_currency,
      'discount_type', upsell_existing.discount_type,
      'discount_value', upsell_existing.discount_value,
      'expires_at', upsell_existing.expires_at,
      'duration_minutes', upsell_existing.duration_minutes,
      'downsell_code', downsell_existing.code,
      'downsell_coupon_id', downsell_existing.id,
      'downsell_product_id', downsell_existing.downsell_product_id,
      'downsell_product_slug', downsell_existing.downsell_product_slug,
      'downsell_product_name', downsell_existing.downsell_product_name,
      'downsell_product_price', downsell_existing.downsell_product_price,
      'downsell_product_currency', downsell_existing.downsell_product_currency,
      'downsell_discount_type', downsell_existing.discount_type,
      'downsell_discount_value', downsell_existing.discount_value,
      'downsell_expires_at', downsell_existing.expires_at,
      'downsell_duration_minutes', downsell_existing.downsell_duration_minutes
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- Resolve active OTO offer (no existing coupon yet)
  -- ---------------------------------------------------------------------------
  SELECT o.*, p.slug AS oto_product_slug, p.name AS oto_product_name,
         p.price AS oto_product_price, p.currency AS oto_product_currency
    INTO oto_config
    FROM public.oto_offers o
    INNER JOIN public.products p ON p.id = o.oto_product_id AND p.is_active = true
   WHERE o.source_product_id = source_product_id_param
     AND o.is_active = true
   ORDER BY o.display_order ASC, o.created_at ASC
   LIMIT 1;

  IF oto_config IS NULL THEN
    RETURN jsonb_build_object('has_oto', false);
  END IF;

  -- Customer already owns the upsell product → suppress entire funnel
  IF EXISTS (
    SELECT 1
      FROM public.user_product_access upa
      INNER JOIN auth.users au ON au.id = upa.user_id
     WHERE au.email = customer_email_param
       AND upa.product_id = oto_config.oto_product_id
       AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW())
  ) OR EXISTS (
    SELECT 1
      FROM public.guest_purchases gp
     WHERE gp.customer_email = customer_email_param
       AND gp.product_id = oto_config.oto_product_id
  ) THEN
    RETURN jsonb_build_object(
      'has_oto', false,
      'reason', 'already_owns_oto_product',
      'skipped_oto_product_id', oto_config.oto_product_id,
      'skipped_oto_product_slug', oto_config.oto_product_slug
    );
  END IF;

  -- Check 3: customer bought the OTO product as an order bump (covers guests; line_items by email)
  IF EXISTS (
    SELECT 1
    FROM public.payment_line_items pli
    INNER JOIN public.payment_transactions pt ON pt.id = pli.transaction_id
    WHERE pt.customer_email = customer_email_param
      AND pt.status = 'completed'
      AND pli.item_type = 'order_bump'
      AND pli.product_id = oto_config.oto_product_id
  ) THEN
    RETURN jsonb_build_object(
      'has_oto', false,
      'reason', 'already_owns_oto_product',
      'skipped_oto_product_id', oto_config.oto_product_id,
      'skipped_oto_product_slug', oto_config.oto_product_slug
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- Generate UPSELL coupon
  -- ---------------------------------------------------------------------------
  upsell_code := 'OTO-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8));
  upsell_expires := NOW() + (oto_config.duration_minutes || ' minutes')::INTERVAL;

  BEGIN
    INSERT INTO public.coupons (
      code, name, discount_type, discount_value, currency,
      allowed_emails, allowed_product_ids,
      usage_limit_global, usage_limit_per_user,
      expires_at, is_active,
      is_oto_coupon, oto_offer_id, source_transaction_id, coupon_role
    ) VALUES (
      upsell_code,
      'OTO upsell: ' || customer_email_param,
      oto_config.discount_type, oto_config.discount_value,
      CASE WHEN oto_config.discount_type = 'fixed' THEN oto_config.oto_product_currency ELSE NULL END,
      email_array,
      jsonb_build_array(oto_config.oto_product_id),
      1, 1,
      upsell_expires, true,
      true, oto_config.id, transaction_id_param, 'upsell'
    )
    RETURNING id INTO upsell_id;
  EXCEPTION
    WHEN unique_violation THEN
      IF transaction_id_param IS NOT NULL THEN
        SELECT id, code, expires_at INTO upsell_id, upsell_code, upsell_expires
          FROM public.coupons
         WHERE source_transaction_id = transaction_id_param
           AND is_oto_coupon = true
           AND coupon_role = 'upsell'
         LIMIT 1;
      ELSE
        SELECT id, code, expires_at INTO upsell_id, upsell_code, upsell_expires
          FROM public.coupons
         WHERE oto_offer_id = oto_config.id
           AND allowed_emails = email_array
           AND is_oto_coupon = true
           AND source_transaction_id IS NULL
           AND coupon_role = 'upsell'
         LIMIT 1;
      END IF;
  END;

  -- ---------------------------------------------------------------------------
  -- Generate DOWNSELL coupon if configured. We DO NOT short-circuit on the
  -- customer already owning the downsell product — that's handled at decline
  -- time. Here we just pre-mint the coupon for the decline URL.
  -- ---------------------------------------------------------------------------
  IF oto_config.downsell_product_id IS NOT NULL THEN
    SELECT id, slug, name, price, currency, is_active
      INTO downsell_product
      FROM public.products
     WHERE id = oto_config.downsell_product_id;

    IF downsell_product IS NOT NULL AND downsell_product.is_active THEN
      downsell_product_slug := downsell_product.slug;
      downsell_product_name := downsell_product.name;
      downsell_product_price := downsell_product.price;
      downsell_product_currency := downsell_product.currency;

      downsell_code := 'OTO-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8));
      downsell_expires := NOW() + (oto_config.downsell_duration_minutes || ' minutes')::INTERVAL;

      BEGIN
        INSERT INTO public.coupons (
          code, name, discount_type, discount_value, currency,
          allowed_emails, allowed_product_ids,
          usage_limit_global, usage_limit_per_user,
          expires_at, is_active,
          is_oto_coupon, oto_offer_id, source_transaction_id, coupon_role
        ) VALUES (
          downsell_code,
          'OTO downsell: ' || customer_email_param,
          oto_config.downsell_discount_type, oto_config.downsell_discount_value,
          CASE WHEN oto_config.downsell_discount_type = 'fixed' THEN downsell_product.currency ELSE NULL END,
          email_array,
          jsonb_build_array(oto_config.downsell_product_id),
          1, 1,
          downsell_expires, true,
          true, oto_config.id, transaction_id_param, 'downsell'
        )
        RETURNING id INTO downsell_id;
      EXCEPTION
        WHEN unique_violation THEN
          IF transaction_id_param IS NOT NULL THEN
            SELECT id, code, expires_at INTO downsell_id, downsell_code, downsell_expires
              FROM public.coupons
             WHERE source_transaction_id = transaction_id_param
               AND is_oto_coupon = true
               AND coupon_role = 'downsell'
             LIMIT 1;
          ELSE
            SELECT id, code, expires_at INTO downsell_id, downsell_code, downsell_expires
              FROM public.coupons
             WHERE oto_offer_id = oto_config.id
               AND allowed_emails = email_array
               AND is_oto_coupon = true
               AND source_transaction_id IS NULL
               AND coupon_role = 'downsell'
             LIMIT 1;
          END IF;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'has_oto', true,
    'coupon_code', upsell_code,
    'coupon_id', upsell_id,
    'upsell_code', upsell_code,
    'upsell_coupon_id', upsell_id,
    'oto_product_id', oto_config.oto_product_id,
    'oto_product_slug', oto_config.oto_product_slug,
    'oto_product_name', oto_config.oto_product_name,
    'oto_product_price', oto_config.oto_product_price,
    'oto_product_currency', oto_config.oto_product_currency,
    'discount_type', oto_config.discount_type,
    'discount_value', oto_config.discount_value,
    'expires_at', upsell_expires,
    'duration_minutes', oto_config.duration_minutes,
    'downsell_code', downsell_code,
    'downsell_coupon_id', downsell_id,
    'downsell_product_id', CASE WHEN downsell_id IS NOT NULL THEN oto_config.downsell_product_id END,
    'downsell_product_slug', downsell_product_slug,
    'downsell_product_name', downsell_product_name,
    'downsell_product_price', downsell_product_price,
    'downsell_product_currency', downsell_product_currency,
    'downsell_discount_type', CASE WHEN downsell_id IS NOT NULL THEN oto_config.downsell_discount_type END,
    'downsell_discount_value', CASE WHEN downsell_id IS NOT NULL THEN oto_config.downsell_discount_value END,
    'downsell_expires_at', downsell_expires,
    'downsell_duration_minutes', CASE WHEN downsell_id IS NOT NULL THEN oto_config.downsell_duration_minutes END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_oto_coupon TO service_role;
