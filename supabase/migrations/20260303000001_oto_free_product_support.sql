-- =============================================================================
-- OTO SUPPORT FOR FREE ($0) PRODUCTS
-- =============================================================================
-- Free products never create a payment_transactions record, so generate_oto_coupon
-- could not be called for them (transaction_id_param was required).
--
-- This migration:
-- 1. Adds a partial unique index for idempotency when transaction_id is NULL
--    (keyed on oto_offer_id + allowed_emails so each email gets at most one
--    free-product OTO coupon per offer).
-- 2. Replaces generate_oto_coupon with a version that accepts
--    transaction_id_param UUID DEFAULT NULL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. UNIQUE INDEX: prevent duplicate OTO coupons for free-product grants
-- -----------------------------------------------------------------------------
-- Complements idx_coupons_oto_transaction_unique (which only covers IS NOT NULL rows).
-- When source_transaction_id IS NULL, the idempotency key becomes
-- (oto_offer_id, allowed_emails) — one coupon per offer per email.

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_oto_free_unique
  ON public.coupons(oto_offer_id, allowed_emails)
  WHERE source_transaction_id IS NULL AND is_oto_coupon = true;

-- -----------------------------------------------------------------------------
-- 2. UPDATED generate_oto_coupon — accepts optional transaction_id
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_oto_coupon(
  source_product_id_param UUID,
  customer_email_param TEXT,
  transaction_id_param UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  oto_config RECORD;
  oto_product RECORD;
  existing_coupon RECORD;
  new_coupon_code TEXT;
  new_coupon_id UUID;
  coupon_expires_at TIMESTAMPTZ;
  email_array JSONB;
BEGIN
  email_array := jsonb_build_array(customer_email_param);

  -- IDEMPOTENCY CHECK: strategy depends on whether we have a transaction_id
  IF transaction_id_param IS NOT NULL THEN
    -- Paid product: transaction is the idempotency key
    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           o.oto_product_id, p.slug AS oto_product_slug, p.name AS oto_product_name,
           p.price AS oto_product_price, p.currency AS oto_product_currency,
           o.duration_minutes
    INTO existing_coupon
    FROM public.coupons c
    INNER JOIN public.oto_offers o ON c.oto_offer_id = o.id
    INNER JOIN public.products p ON o.oto_product_id = p.id
    WHERE c.source_transaction_id = transaction_id_param
      AND c.is_oto_coupon = true
    LIMIT 1;
  ELSE
    -- Free product: (oto_offer_id, allowed_emails) is the idempotency key
    SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
           o.oto_product_id, p.slug AS oto_product_slug, p.name AS oto_product_name,
           p.price AS oto_product_price, p.currency AS oto_product_currency,
           o.duration_minutes
    INTO existing_coupon
    FROM public.coupons c
    INNER JOIN public.oto_offers o ON c.oto_offer_id = o.id
    INNER JOIN public.products p ON o.oto_product_id = p.id
    WHERE o.source_product_id = source_product_id_param
      AND c.is_oto_coupon = true
      AND c.source_transaction_id IS NULL
      AND c.allowed_emails = email_array
      AND o.is_active = true
    LIMIT 1;
  END IF;

  -- Return existing coupon if already generated (idempotent)
  IF existing_coupon IS NOT NULL THEN
    RETURN jsonb_build_object(
      'has_oto', true,
      'coupon_code', existing_coupon.code,
      'coupon_id', existing_coupon.id,
      'oto_product_id', existing_coupon.oto_product_id,
      'oto_product_slug', existing_coupon.oto_product_slug,
      'oto_product_name', existing_coupon.oto_product_name,
      'oto_product_price', existing_coupon.oto_product_price,
      'oto_product_currency', existing_coupon.oto_product_currency,
      'discount_type', existing_coupon.discount_type,
      'discount_value', existing_coupon.discount_value,
      'expires_at', existing_coupon.expires_at,
      'duration_minutes', existing_coupon.duration_minutes
    );
  END IF;

  -- Find active OTO offer for this product
  SELECT o.*, p.slug AS oto_product_slug, p.name AS oto_product_name,
         p.price AS oto_product_price, p.currency AS oto_product_currency
  INTO oto_config
  FROM public.oto_offers o
  INNER JOIN public.products p ON p.id = o.oto_product_id AND p.is_active = true
  WHERE o.source_product_id = source_product_id_param
    AND o.is_active = true
  ORDER BY o.display_order ASC, o.created_at ASC
  LIMIT 1;

  -- No OTO configured
  IF oto_config IS NULL THEN
    RETURN jsonb_build_object('has_oto', false);
  END IF;

  -- CHECK: Does customer already own the OTO product?
  -- Check 1: user_product_access (logged-in users, by email via auth.users)
  IF EXISTS (
    SELECT 1
    FROM public.user_product_access upa
    INNER JOIN auth.users au ON au.id = upa.user_id
    WHERE au.email = customer_email_param
      AND upa.product_id = oto_config.oto_product_id
      AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW())
  ) THEN
    RETURN jsonb_build_object(
      'has_oto', false,
      'reason', 'already_owns_oto_product',
      'skipped_oto_product_id', oto_config.oto_product_id,
      'skipped_oto_product_slug', oto_config.oto_product_slug
    );
  END IF;

  -- Check 2: guest_purchases (guest users, by email directly)
  IF EXISTS (
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

  -- Generate unique coupon code (OTO-XXXXXXXX format)
  new_coupon_code := 'OTO-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8));
  coupon_expires_at := NOW() + (oto_config.duration_minutes || ' minutes')::INTERVAL;

  -- Create the OTO coupon with race condition protection
  BEGIN
    INSERT INTO public.coupons (
      code,
      name,
      discount_type,
      discount_value,
      currency,
      allowed_emails,
      allowed_product_ids,
      usage_limit_global,
      usage_limit_per_user,
      expires_at,
      is_active,
      is_oto_coupon,
      oto_offer_id,
      source_transaction_id
    ) VALUES (
      new_coupon_code,
      'OTO: ' || customer_email_param,
      oto_config.discount_type,
      oto_config.discount_value,
      CASE WHEN oto_config.discount_type = 'fixed' THEN oto_config.oto_product_currency ELSE NULL END,
      email_array,
      jsonb_build_array(oto_config.oto_product_id),
      1,
      1,
      coupon_expires_at,
      true,
      true,
      oto_config.id,
      transaction_id_param   -- NULL for free products, UUID for paid products
    )
    RETURNING id INTO new_coupon_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Race condition: another process already created the coupon.
      -- Re-query to return the winner.
      IF transaction_id_param IS NOT NULL THEN
        SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
               o.oto_product_id, p.slug AS oto_product_slug, p.name AS oto_product_name,
               p.price AS oto_product_price, p.currency AS oto_product_currency,
               o.duration_minutes
        INTO existing_coupon
        FROM public.coupons c
        INNER JOIN public.oto_offers o ON c.oto_offer_id = o.id
        INNER JOIN public.products p ON o.oto_product_id = p.id
        WHERE c.source_transaction_id = transaction_id_param
          AND c.is_oto_coupon = true
        LIMIT 1;
      ELSE
        SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
               o.oto_product_id, p.slug AS oto_product_slug, p.name AS oto_product_name,
               p.price AS oto_product_price, p.currency AS oto_product_currency,
               o.duration_minutes
        INTO existing_coupon
        FROM public.coupons c
        INNER JOIN public.oto_offers o ON c.oto_offer_id = o.id
        INNER JOIN public.products p ON o.oto_product_id = p.id
        WHERE o.source_product_id = source_product_id_param
          AND c.is_oto_coupon = true
          AND c.source_transaction_id IS NULL
          AND c.allowed_emails = email_array
          AND o.is_active = true
        LIMIT 1;
      END IF;

      IF existing_coupon IS NOT NULL THEN
        RETURN jsonb_build_object(
          'has_oto', true,
          'coupon_code', existing_coupon.code,
          'coupon_id', existing_coupon.id,
          'oto_product_id', existing_coupon.oto_product_id,
          'oto_product_slug', existing_coupon.oto_product_slug,
          'oto_product_name', existing_coupon.oto_product_name,
          'oto_product_price', existing_coupon.oto_product_price,
          'oto_product_currency', existing_coupon.oto_product_currency,
          'discount_type', existing_coupon.discount_type,
          'discount_value', existing_coupon.discount_value,
          'expires_at', existing_coupon.expires_at,
          'duration_minutes', existing_coupon.duration_minutes
        );
      END IF;
  END;

  -- Return OTO info for redirect
  RETURN jsonb_build_object(
    'has_oto', true,
    'coupon_code', new_coupon_code,
    'coupon_id', new_coupon_id,
    'oto_product_id', oto_config.oto_product_id,
    'oto_product_slug', oto_config.oto_product_slug,
    'oto_product_name', oto_config.oto_product_name,
    'oto_product_price', oto_config.oto_product_price,
    'oto_product_currency', oto_config.oto_product_currency,
    'discount_type', oto_config.discount_type,
    'discount_value', oto_config.discount_value,
    'expires_at', coupon_expires_at,
    'duration_minutes', oto_config.duration_minutes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.generate_oto_coupon TO service_role;
