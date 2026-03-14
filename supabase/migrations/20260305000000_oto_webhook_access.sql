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
  ON seller_main.coupons(oto_offer_id, allowed_emails)
  WHERE source_transaction_id IS NULL AND is_oto_coupon = true;

-- -----------------------------------------------------------------------------
-- 2. UPDATED generate_oto_coupon — accepts optional transaction_id
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_main.generate_oto_coupon(
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
    FROM seller_main.coupons c
    INNER JOIN seller_main.oto_offers o ON c.oto_offer_id = o.id
    INNER JOIN seller_main.products p ON o.oto_product_id = p.id
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
    FROM seller_main.coupons c
    INNER JOIN seller_main.oto_offers o ON c.oto_offer_id = o.id
    INNER JOIN seller_main.products p ON o.oto_product_id = p.id
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
  FROM seller_main.oto_offers o
  INNER JOIN seller_main.products p ON p.id = o.oto_product_id AND p.is_active = true
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
    FROM seller_main.user_product_access upa
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
    FROM seller_main.guest_purchases gp
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
    INSERT INTO seller_main.coupons (
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
        FROM seller_main.coupons c
        INNER JOIN seller_main.oto_offers o ON c.oto_offer_id = o.id
        INNER JOIN seller_main.products p ON o.oto_product_id = p.id
        WHERE c.source_transaction_id = transaction_id_param
          AND c.is_oto_coupon = true
        LIMIT 1;
      ELSE
        SELECT c.id, c.code, c.discount_type, c.discount_value, c.expires_at,
               o.oto_product_id, p.slug AS oto_product_slug, p.name AS oto_product_name,
               p.price AS oto_product_price, p.currency AS oto_product_currency,
               o.duration_minutes
        INTO existing_coupon
        FROM seller_main.coupons c
        INNER JOIN seller_main.oto_offers o ON c.oto_offer_id = o.id
        INNER JOIN seller_main.products p ON o.oto_product_id = p.id
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION seller_main.generate_oto_coupon TO service_role;

-- Drop legacy color columns from shop_config.
-- These were never exposed in the settings UI and are superseded
-- by the JSON-based theme system in BrandingSettings.
-- NOTE: Must DROP proxy view first because SELECT * binds to column list at creation time.
DROP VIEW IF EXISTS public.shop_config CASCADE;

ALTER TABLE seller_main.shop_config
  DROP COLUMN IF EXISTS primary_color,
  DROP COLUMN IF EXISTS secondary_color,
  DROP COLUMN IF EXISTS accent_color;

-- Recreate proxy view after DROP COLUMN
CREATE OR REPLACE VIEW public.shop_config WITH (security_invoker = on) AS SELECT * FROM seller_main.shop_config;

-- Add expiry_notified_at to user_product_access
-- Used by the /api/cron?job=access-expired endpoint to prevent duplicate webhook dispatch.
-- When the cron fires, it queries: access_expires_at < NOW() AND expiry_notified_at IS NULL
-- After dispatching the access.expired webhook, it sets expiry_notified_at = NOW().

ALTER TABLE seller_main.user_product_access
  ADD COLUMN IF NOT EXISTS expiry_notified_at TIMESTAMPTZ;

-- Refresh proxy view to include new column
CREATE OR REPLACE VIEW public.user_product_access WITH (security_invoker = on) AS SELECT * FROM seller_main.user_product_access;

-- Index: cron job queries this column frequently
CREATE INDEX IF NOT EXISTS idx_user_product_access_expiry_notified
  ON seller_main.user_product_access (expiry_notified_at)
  WHERE expiry_notified_at IS NULL;

-- ── Stripe webhook endpoint registration ─────────────────────────────────
-- Stores the Stripe-generated webhook endpoint ID and its signing secret
-- (AES-256-GCM encrypted, same pattern as the API key).
-- Enables DB-based Stripe config to be fully self-contained —
-- no STRIPE_WEBHOOK_SECRET env var required when using DB config.

ALTER TABLE seller_main.stripe_configurations
  ADD COLUMN IF NOT EXISTS webhook_endpoint_id TEXT,
  ADD COLUMN IF NOT EXISTS webhook_signing_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS webhook_signing_iv TEXT,
  ADD COLUMN IF NOT EXISTS webhook_signing_tag TEXT;

-- Refresh proxy view to include new columns
CREATE OR REPLACE VIEW public.stripe_configurations WITH (security_invoker = on) AS SELECT * FROM seller_main.stripe_configurations;

COMMENT ON COLUMN seller_main.stripe_configurations.webhook_endpoint_id
  IS 'Stripe webhook endpoint ID (we_xxx). NULL = not registered via Sellf.';
COMMENT ON COLUMN seller_main.stripe_configurations.webhook_signing_secret_enc
  IS 'AES-256-GCM encrypted webhook signing secret (whsec_xxx). Base64 encoded.';
COMMENT ON COLUMN seller_main.stripe_configurations.webhook_signing_iv
  IS 'AES-256-GCM IV for webhook signing secret. Base64 encoded.';
COMMENT ON COLUMN seller_main.stripe_configurations.webhook_signing_tag
  IS 'AES-256-GCM auth tag for webhook signing secret. Base64 encoded.';

-- ── Product preview video ──────────────────────────────────────────────
-- Optional video URL shown on checkout/product pages (YouTube, Vimeo, etc.).
-- Parsed client-side by videoUtils.parseVideoUrl() and rendered by VideoPlayer.

ALTER TABLE seller_main.products
  ADD COLUMN IF NOT EXISTS preview_video_url TEXT;

-- Refresh proxy view to include new column
CREATE OR REPLACE VIEW public.products WITH (security_invoker = on) AS SELECT * FROM seller_main.products;
