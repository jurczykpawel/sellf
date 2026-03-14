-- =====================================================
-- Sellf - Features & Extensions
-- =====================================================
-- Description: Advanced features including video tracking, order bumps,
--              coupons, webhooks, analytics, revenue goals, and configurations
-- Created: 2025-01-03
-- Refactored: Professional structure with best practices
--
-- Merged from:
--   - 20251128141050_video_views_tracking.sql
--   - 20251128150000_order_bumps.sql
--   - 20251128151000_order_bumps_payment_processing.sql
--   - 20251128170000_smart_coupons.sql
--   - 20251219120000_webhooks_system.sql
--   - 20251223100000_integrations_settings.sql
--   - 20251223200000_realtime_analytics_dashboard.sql
--   - 20251224120000_revenue_goals.sql
--   - 20251227000000_stripe_rak_configuration.sql
--   - 20251227100000_shop_config.sql
-- =====================================================

-- Suppress NOTICE messages during migration (e.g., "relation already exists, skipping")
SET client_min_messages = warning;

-- =============================================================================
-- TABLES
-- =============================================================================
-- Organized by functional domain for better maintainability

-- -----------------------------------------------------------------------------
-- VIDEO TRACKING DOMAIN
-- -----------------------------------------------------------------------------

-- Tracks individual user progress for each video/product
CREATE TABLE IF NOT EXISTS seller_main.video_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,
  video_id TEXT NOT NULL,

  -- Progress tracking
  last_position_seconds INTEGER DEFAULT 0 NOT NULL,
  max_position_seconds INTEGER DEFAULT 0 NOT NULL,
  video_duration_seconds INTEGER,
  is_completed BOOLEAN DEFAULT false NOT NULL,
  view_count INTEGER DEFAULT 1 NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  CONSTRAINT unique_user_video_progress UNIQUE (user_id, product_id, video_id)
);

-- Stores raw interaction events for deep analytics (heatmaps, drop-off points)
CREATE TABLE IF NOT EXISTS seller_main.video_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  progress_id UUID REFERENCES seller_main.video_progress(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('play', 'pause', 'seek', 'heartbeat', 'complete')),
  position_seconds INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- -----------------------------------------------------------------------------
-- E-COMMERCE DOMAIN: Order Bumps (Upsells)
-- -----------------------------------------------------------------------------

-- Order bumps: complementary products offered during checkout
CREATE TABLE IF NOT EXISTS seller_main.order_bumps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  main_product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,
  bump_product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,

  -- Pricing
  bump_price NUMERIC CHECK (bump_price IS NULL OR bump_price >= 0),
  -- NULL = use product's default price, non-NULL = special discounted price

  -- Presentation
  bump_title TEXT NOT NULL CHECK (length(bump_title) BETWEEN 1 AND 255),
  bump_description TEXT CHECK (bump_description IS NULL OR length(bump_description) <= 1000),
  display_order INTEGER NOT NULL DEFAULT 0,

  -- Access control
  access_duration_days INTEGER CHECK (access_duration_days IS NULL OR access_duration_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT no_self_bump CHECK (main_product_id != bump_product_id),
  CONSTRAINT unique_bump_pair UNIQUE (main_product_id, bump_product_id)
);

-- -----------------------------------------------------------------------------
-- E-COMMERCE DOMAIN: Coupons & Discounts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seller_main.coupons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL CHECK (length(code) >= 3),
  name TEXT, -- Internal name for admin

  -- Discount configuration
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC NOT NULL CHECK (discount_value > 0),
  currency TEXT CHECK (
    (discount_type = 'fixed' AND (currency IS NULL OR length(currency) = 3)) OR
    (discount_type = 'percentage' AND currency IS NULL)
  ),

  -- Targeting
  allowed_emails JSONB DEFAULT '[]'::JSONB NOT NULL,
  allowed_product_ids JSONB DEFAULT '[]'::JSONB NOT NULL,
  exclude_order_bumps BOOLEAN DEFAULT false NOT NULL,

  -- Usage limits
  usage_limit_global INTEGER,
  usage_limit_per_user INTEGER DEFAULT 1,
  current_usage_count INTEGER DEFAULT 0 NOT NULL,

  -- Validity
  starts_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true NOT NULL,

  -- Omnibus tracking (future use)
  is_public BOOLEAN DEFAULT false NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT unique_coupon_code UNIQUE (code),
  CONSTRAINT valid_percentage CHECK (
    discount_type != 'percentage' OR (discount_value <= 100)
  )
);

CREATE TABLE IF NOT EXISTS seller_main.coupon_redemptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coupon_id UUID REFERENCES seller_main.coupons(id) ON DELETE RESTRICT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  transaction_id UUID REFERENCES seller_main.payment_transactions(id) ON DELETE CASCADE,
  discount_amount NUMERIC NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Coupon reservations - prevent race conditions by reserving slots
CREATE TABLE IF NOT EXISTS seller_main.coupon_reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coupon_id UUID REFERENCES seller_main.coupons(id) ON DELETE CASCADE NOT NULL,
  customer_email TEXT NOT NULL,
  reserved_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  session_id TEXT,
  -- One active reservation per email per coupon
  UNIQUE(coupon_id, customer_email)
);

-- -----------------------------------------------------------------------------
-- WEBHOOKS DOMAIN
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seller_main.webhook_endpoints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  secret TEXT NOT NULL DEFAULT replace(cast(gen_random_uuid() as text), '-', ''),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_main.webhook_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint_id UUID REFERENCES seller_main.webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'retried', 'archived')),
  http_status INT,
  response_body TEXT,
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Check waitlist configuration for admin warnings
-- Returns whether any webhook has waitlist.signup event and count of products with waitlist enabled
CREATE OR REPLACE FUNCTION seller_main.check_waitlist_config()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT json_build_object(
    'has_webhook', EXISTS(
      SELECT 1 FROM seller_main.webhook_endpoints
      WHERE 'waitlist.signup' = ANY(events)
        AND is_active = true
    ),
    'products_count', (
      SELECT COUNT(*)::integer
      FROM seller_main.products
      WHERE enable_waitlist = true
    )
  );
$$;

COMMENT ON FUNCTION seller_main.check_waitlist_config IS 'Check if waitlist.signup webhook exists and count products with waitlist enabled. Used for admin warnings.';

-- -----------------------------------------------------------------------------
-- INTEGRATIONS DOMAIN
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seller_main.integrations_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Singleton

  -- Analytics integrations
  gtm_container_id TEXT,
  gtm_server_container_url TEXT, -- GTM Server-Side URL (e.g. https://gtm.yourdomain.com)
  facebook_pixel_id TEXT,
  facebook_capi_token TEXT,
  facebook_test_event_code TEXT,
  fb_capi_enabled BOOLEAN DEFAULT false, -- Enable Facebook Conversions API server-side tracking
  send_conversions_without_consent BOOLEAN DEFAULT false, -- Send Purchase/Lead events server-side even without cookie consent (uses legitimate interest basis)
  google_ads_conversion_id TEXT,
  google_ads_conversion_label TEXT,
  umami_website_id TEXT,
  umami_script_url TEXT DEFAULT 'https://cloud.umami.is/script.js',

  -- Currency Exchange API integration
  currency_api_provider TEXT CHECK (currency_api_provider IN ('exchangerate-api', 'fixer', 'ecb')) DEFAULT 'ecb',
  currency_api_key_encrypted TEXT,
  currency_api_key_iv TEXT,
  currency_api_key_tag TEXT,
  currency_api_enabled BOOLEAN DEFAULT true NOT NULL,

  -- Settings
  cookie_consent_enabled BOOLEAN DEFAULT true,
  consent_logging_enabled BOOLEAN DEFAULT false,

  -- Sellf License (removes watermark from GateKeeper script)
  sellf_license TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_main.custom_scripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  script_location TEXT NOT NULL CHECK (script_location IN ('head', 'body')),
  script_content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('essential', 'analytics', 'marketing')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_main.consent_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  anonymous_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  consent_version TEXT,
  consents JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for consent_logs lookups
CREATE INDEX IF NOT EXISTS idx_consent_logs_user_id ON seller_main.consent_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_logs_anonymous_id ON seller_main.consent_logs(anonymous_id) WHERE anonymous_id IS NOT NULL;

-- Comments for integrations_config
COMMENT ON COLUMN seller_main.integrations_config.currency_api_provider IS 'Currency exchange rate provider: ecb (free EU, default), exchangerate-api (free 1500/mo), or fixer (paid)';
COMMENT ON COLUMN seller_main.integrations_config.currency_api_key_encrypted IS 'AES-256-GCM encrypted Currency API key (base64 encoded) - for ExchangeRate-API or Fixer.io';
COMMENT ON COLUMN seller_main.integrations_config.currency_api_key_iv IS 'Initialization vector for Currency API key decryption (base64 encoded)';
COMMENT ON COLUMN seller_main.integrations_config.currency_api_key_tag IS 'Authentication tag for Currency API key decryption (base64 encoded)';
COMMENT ON COLUMN seller_main.integrations_config.currency_api_enabled IS 'Whether Currency API integration is enabled for exchange rate fetching';

-- Index for currency API queries
CREATE INDEX IF NOT EXISTS idx_integrations_config_currency_api_enabled
  ON seller_main.integrations_config (currency_api_enabled)
  WHERE currency_api_enabled = true;

-- -----------------------------------------------------------------------------
-- USER PROFILES DOMAIN
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seller_main.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  display_name TEXT,
  avatar_url TEXT,
  company_name TEXT,
  tax_id TEXT,

  -- Address
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  country TEXT,

  -- Preferences
  preferred_language TEXT DEFAULT 'en',
  timezone TEXT DEFAULT 'UTC',

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- -----------------------------------------------------------------------------
-- ANALYTICS DOMAIN
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seller_main.revenue_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE,
  goal_amount BIGINT NOT NULL, -- in cents
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- CONFIGURATION DOMAIN
-- -----------------------------------------------------------------------------

-- Stripe API Keys (encrypted storage)
CREATE TABLE IF NOT EXISTS seller_main.stripe_configurations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),

  -- AES-256-GCM encrypted key
  encrypted_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_tag TEXT NOT NULL,

  -- Metadata (non-sensitive)
  key_last_4 TEXT NOT NULL CHECK (length(key_last_4) = 4),
  key_prefix TEXT NOT NULL CHECK (key_prefix IN ('rk_test_', 'rk_live_', 'sk_test_', 'sk_live_')),
  permissions_verified BOOLEAN DEFAULT false NOT NULL,
  last_validated_at TIMESTAMPTZ,
  account_id TEXT,

  -- Rotation management
  expires_at TIMESTAMPTZ,
  rotation_reminder_sent BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Global shop configuration (singleton)
CREATE TABLE IF NOT EXISTS seller_main.shop_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_name TEXT NOT NULL DEFAULT 'My Shop',
  contact_email TEXT,
  default_currency TEXT NOT NULL DEFAULT 'USD',
  tax_rate DECIMAL(5,2) DEFAULT 0,

  -- Branding & Whitelabel
  logo_url TEXT,
  primary_color TEXT DEFAULT '#9333ea', -- purple-600
  secondary_color TEXT DEFAULT '#ec4899', -- pink-600
  accent_color TEXT DEFAULT '#8b5cf6', -- violet-500
  font_family TEXT DEFAULT 'system' CHECK (font_family IN ('system', 'inter', 'roboto', 'montserrat', 'poppins', 'playfair')),

  -- Checkout appearance
  checkout_theme TEXT DEFAULT 'system' CHECK (checkout_theme IN ('system', 'light', 'dark')),

  -- Stripe Tax toggles (NULL = use env var)
  automatic_tax_enabled BOOLEAN DEFAULT NULL,
  tax_id_collection_enabled BOOLEAN DEFAULT NULL,

  -- Checkout session settings (NULL = use env var)
  checkout_billing_address TEXT DEFAULT NULL CHECK (checkout_billing_address IN ('auto', 'required')),
  checkout_expires_hours INTEGER DEFAULT NULL CHECK (checkout_expires_hours BETWEEN 1 AND 168),
  checkout_collect_terms BOOLEAN DEFAULT NULL,

  -- Legal Documents
  terms_of_service_url TEXT,
  privacy_policy_url TEXT,

  custom_settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =============================================================================
-- INDEXES
-- =============================================================================
-- Grouped by table for maintainability

-- Video tracking
CREATE INDEX IF NOT EXISTS idx_video_progress_user ON seller_main.video_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_video_progress_product ON seller_main.video_progress(product_id);
CREATE INDEX IF NOT EXISTS idx_video_events_progress ON seller_main.video_events(progress_id);

-- Order bumps
CREATE INDEX IF NOT EXISTS idx_order_bumps_main_product ON seller_main.order_bumps(main_product_id, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_order_bumps_bump_product ON seller_main.order_bumps(bump_product_id);
CREATE INDEX IF NOT EXISTS idx_order_bumps_created_at ON seller_main.order_bumps USING BRIN (created_at);

-- Coupons
CREATE INDEX IF NOT EXISTS idx_coupons_code ON seller_main.coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON seller_main.coupons(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON seller_main.coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_email ON seller_main.coupon_redemptions(customer_email);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON seller_main.coupon_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_transaction ON seller_main.coupon_redemptions(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coupon_reservations_expires ON seller_main.coupon_reservations(expires_at);
CREATE INDEX IF NOT EXISTS idx_coupon_reservations_email ON seller_main.coupon_reservations(customer_email);
CREATE INDEX IF NOT EXISTS idx_coupon_reservations_coupon ON seller_main.coupon_reservations(coupon_id);

-- Webhooks
CREATE INDEX IF NOT EXISTS idx_webhook_logs_endpoint_id ON seller_main.webhook_logs(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON seller_main.webhook_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON seller_main.webhook_logs(status);

-- Revenue goals
CREATE UNIQUE INDEX IF NOT EXISTS revenue_goals_global_idx ON seller_main.revenue_goals ((1)) WHERE product_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS revenue_goals_product_idx ON seller_main.revenue_goals (product_id) WHERE product_id IS NOT NULL;

-- Stripe configurations
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_mode_per_stripe_config
  ON seller_main.stripe_configurations (mode, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_stripe_config_mode ON seller_main.stripe_configurations(mode);
CREATE INDEX IF NOT EXISTS idx_stripe_config_active ON seller_main.stripe_configurations(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_stripe_config_expires_at ON seller_main.stripe_configurations(expires_at)
  WHERE is_active = true AND expires_at IS NOT NULL;

-- Shop config (singleton constraint)
CREATE UNIQUE INDEX IF NOT EXISTS shop_config_singleton_idx ON seller_main.shop_config ((true));

-- =============================================================================
-- FUNCTIONS
-- =============================================================================
-- Organized: Shared utilities first, then domain-specific functions

-- -----------------------------------------------------------------------------
-- VIDEO TRACKING FUNCTIONS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_main.update_video_progress(
  product_id_param UUID,
  video_id_param TEXT,
  position_param INTEGER,
  duration_param INTEGER DEFAULT NULL,
  completed_param BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  current_user_id UUID := auth.uid();
  progress_record RECORD;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO seller_main.video_progress (
    user_id, product_id, video_id, last_position_seconds,
    max_position_seconds, video_duration_seconds, is_completed
  ) VALUES (
    current_user_id, product_id_param, video_id_param, position_param,
    position_param, duration_param, completed_param
  )
  ON CONFLICT (user_id, product_id, video_id) DO UPDATE SET
    last_position_seconds = position_param,
    max_position_seconds = GREATEST(video_progress.max_position_seconds, position_param),
    video_duration_seconds = COALESCE(duration_param, video_progress.video_duration_seconds),
    is_completed = video_progress.is_completed OR completed_param,
    view_count = video_progress.view_count + CASE WHEN position_param = 0 THEN 1 ELSE 0 END,
    updated_at = NOW()
  RETURNING * INTO progress_record;

  RETURN jsonb_build_object(
    'success', true,
    'id', progress_record.id,
    'last_position', progress_record.last_position_seconds,
    'is_completed', progress_record.is_completed
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- -----------------------------------------------------------------------------
-- ORDER BUMPS FUNCTIONS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_main.get_product_order_bumps(
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
  display_order INTEGER
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
    ob.display_order
  FROM seller_main.order_bumps ob
  INNER JOIN seller_main.products p ON p.id = ob.bump_product_id
  WHERE ob.main_product_id = product_id_param
    AND ob.is_active = true
    AND p.is_active = true
  ORDER BY ob.display_order ASC, ob.created_at ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION seller_main.get_product_order_bumps TO authenticated, anon;

CREATE OR REPLACE FUNCTION seller_main.admin_get_product_order_bumps(
  product_id_param UUID
) RETURNS TABLE (
  bump_id UUID,
  bump_product_id UUID,
  bump_product_name TEXT,
  bump_price NUMERIC,
  bump_title TEXT,
  bump_description TEXT,
  is_active BOOLEAN,
  display_order INTEGER,
  access_duration_days INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT (SELECT public.is_admin()) THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;

  RETURN QUERY
  SELECT
    ob.id as bump_id,
    ob.bump_product_id,
    p.name as bump_product_name,
    ob.bump_price,
    ob.bump_title,
    ob.bump_description,
    ob.is_active,
    ob.display_order,
    ob.access_duration_days,
    ob.created_at,
    ob.updated_at
  FROM seller_main.order_bumps ob
  INNER JOIN seller_main.products p ON p.id = ob.bump_product_id
  WHERE ob.main_product_id = product_id_param
  ORDER BY ob.display_order ASC, ob.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION seller_main.admin_get_product_order_bumps TO authenticated;

-- -----------------------------------------------------------------------------
-- PAYMENT PROCESSING WITH ORDER BUMPS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_main.process_stripe_payment_completion_with_bump(
  session_id_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT,
  amount_total NUMERIC,
  currency_param TEXT,
  stripe_payment_intent_id TEXT DEFAULT NULL,
  user_id_param UUID DEFAULT NULL,
  bump_product_id_param UUID DEFAULT NULL,
  coupon_id_param UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  current_user_id UUID;
  product_record RECORD;
  bump_product_record RECORD;
  existing_user_id UUID;
  access_expires_at TIMESTAMPTZ := NULL;
  bump_access_expires_at TIMESTAMPTZ := NULL;
  bump_found BOOLEAN := false;
  transaction_id_var UUID;
  pending_transaction_id UUID;
BEGIN
  bump_product_record := NULL;
  bump_found := false;

  -- Rate limiting
  IF NOT public.check_rate_limit('process_stripe_payment_completion', 100, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded');
  END IF;

  -- Input validation
  IF session_id_param IS NULL OR length(session_id_param) = 0 OR length(session_id_param) > 255 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID');
  END IF;

  -- Accept both Checkout Session (cs_) and Payment Intent (pi_) formats
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

  -- Authorization
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

  -- Idempotency check (skip pending transactions — they need to be completed)
  IF EXISTS (SELECT 1 FROM seller_main.payment_transactions WHERE session_id = session_id_param AND status != 'pending') THEN
    -- Check if this was a guest purchase to return consistent values
    IF EXISTS (SELECT 1 FROM seller_main.guest_purchases WHERE session_id = session_id_param) THEN
      -- Guest purchase - return same values as original guest purchase scenario
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
      -- Logged-in user purchase
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'already_processed_idempotent',
        'access_granted', true,
        'already_had_access', true,
        'message', 'Payment already processed (idempotent)'
      );
    END IF;
  END IF;

  -- Get product with price and currency for validation
  SELECT id, auto_grant_duration_days, price, currency INTO product_record
  FROM seller_main.products
  WHERE id = product_id_param AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  -- SECURITY: Validate currency matches product currency
  IF product_record.currency IS NOT NULL THEN
    IF upper(currency_param) != upper(product_record.currency) THEN
      RAISE EXCEPTION 'Currency mismatch: expected %, got %',
        product_record.currency, currency_param;
    END IF;
  END IF;

  -- Get bump product if provided (with price for validation)
  IF bump_product_id_param IS NOT NULL THEN
    SELECT
      p.id,
      COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as auto_grant_duration_days,
      COALESCE(ob.bump_price, p.price) as price,
      p.currency
    INTO bump_product_record
    FROM seller_main.products p
    JOIN seller_main.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
    WHERE p.id = bump_product_id_param AND p.is_active = true;

    IF FOUND THEN
      bump_found := true;
    END IF;
  END IF;

  -- SECURITY: Validate amount matches product price (prevent price manipulation)
  -- Check total: main product + bump (if present), accounting for coupons
  -- Skip validation if product has no fixed price (PWYW - Pay What You Want)
  -- NOTE: When coupon_id_param IS NOT NULL, only a lenient check is performed
  --       (amount > 0 AND amount <= full price). The exact discounted amount is NOT
  --       re-validated here — we trust calculatePricing() in admin-panel/src/hooks/usePricing.ts
  --       to have produced the correct amount that was set in the Stripe PaymentIntent.
  --
  --       REFACTOR WARNING: If you change calculatePricing() (new discount type, rounding,
  --       STRIPE_MINIMUM_AMOUNT floor, PWYW interaction with coupons), verify that the
  --       assumptions below still hold. To add exact validation: fetch the coupon's
  --       discount_type/discount_value/exclude_order_bumps here by joining coupons WHERE
  --       id = coupon_id_param, replicate the calculatePricing formula in SQL using ROUND(),
  --       and compare against amount_total. Watch out for floating-point edge cases (±1 cent).
  --       See: admin-panel/src/hooks/usePricing.ts → calculatePricing()
  IF product_record.price IS NOT NULL THEN
    DECLARE
      bump_price NUMERIC := NULL;
    BEGIN
      -- Extract bump price if bump was found
      IF bump_found THEN
        bump_price := bump_product_record.price;
      END IF;

      IF coupon_id_param IS NULL THEN
        -- No coupon: validate exact amount
        IF bump_price IS NOT NULL THEN
          -- Validate: amount = main product + bump product
          IF amount_total != ((product_record.price + bump_price) * 100) THEN
            RAISE EXCEPTION 'Amount mismatch with bump: expected % cents (product % + bump %), got % cents',
              ((product_record.price + bump_price) * 100),
              (product_record.price * 100),
              (bump_price * 100),
              amount_total;
          END IF;
        ELSE
          -- Validate: amount = main product only (no bump or bump has no price)
          IF amount_total != (product_record.price * 100) THEN
            RAISE EXCEPTION 'Amount mismatch: expected % cents, got % cents',
              (product_record.price * 100), amount_total;
          END IF;
        END IF;
      ELSE
        -- Coupon applied: only validate amount is reasonable (not zero/negative/too high)
        -- Cannot validate exact amount without fetching coupon details
        IF amount_total <= 0 THEN
          RAISE EXCEPTION 'Invalid amount with coupon: amount cannot be zero or negative';
        END IF;

        IF bump_price IS NOT NULL THEN
          IF amount_total > ((product_record.price + bump_price) * 100) THEN
            RAISE EXCEPTION 'Amount too high with coupon: got % cents but max possible is % cents',
              amount_total, ((product_record.price + bump_price) * 100);
          END IF;
        ELSE
          IF amount_total > (product_record.price * 100) THEN
            RAISE EXCEPTION 'Amount too high with coupon: got % cents but max possible is % cents',
              amount_total, (product_record.price * 100);
          END IF;
        END IF;
      END IF;
    END;
  END IF;

  -- Find existing user
  SELECT id INTO existing_user_id FROM auth.users WHERE email = customer_email_param;

  -- Calculate expiration
  IF product_record.auto_grant_duration_days IS NOT NULL THEN
    access_expires_at := NOW() + (product_record.auto_grant_duration_days || ' days')::INTERVAL;
  END IF;

  IF bump_found THEN
    IF bump_product_record.auto_grant_duration_days IS NOT NULL AND bump_product_record.auto_grant_duration_days > 0 THEN
      bump_access_expires_at := NOW() + (bump_product_record.auto_grant_duration_days || ' days')::INTERVAL;
    ELSE
      bump_access_expires_at := NULL;
    END IF;
  END IF;

  BEGIN
    -- Check for existing pending transaction and update it (abandoned cart recovery)
    SELECT pt.id INTO pending_transaction_id
    FROM seller_main.payment_transactions pt
    WHERE pt.stripe_payment_intent_id = process_stripe_payment_completion_with_bump.stripe_payment_intent_id
      AND pt.status = 'pending'
    LIMIT 1;

    IF pending_transaction_id IS NOT NULL THEN
      -- Update existing pending transaction to completed
      UPDATE seller_main.payment_transactions
      SET
        status = 'completed',
        user_id = current_user_id,
        customer_email = customer_email_param,
        metadata = metadata || jsonb_build_object(
          'has_bump', bump_found,
          'bump_product_id', bump_product_id_param,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param,
          'converted_from_pending', true
        ),
        updated_at = NOW()
      WHERE id = pending_transaction_id
      RETURNING id INTO transaction_id_var;
    ELSE
      -- No pending transaction found - insert new record
      INSERT INTO seller_main.payment_transactions (
      session_id, user_id, product_id, customer_email, amount, currency,
      stripe_payment_intent_id, status, metadata
    ) VALUES (
      session_id_param, current_user_id, product_id_param, customer_email_param,
      amount_total, upper(currency_param), stripe_payment_intent_id, 'completed',
      jsonb_build_object(
        'has_bump', bump_found,
        'bump_product_id', bump_product_id_param,
        'has_coupon', coupon_id_param IS NOT NULL,
        'coupon_id', coupon_id_param
      )
    ) RETURNING id INTO transaction_id_var;
    END IF;

    -- Increment sale quantity sold if sale price is active
    -- This is done atomically to prevent race conditions
    PERFORM seller_main.increment_sale_quantity_sold(product_id_param);

    -- SECURITY FIX: Handle coupon redemption with reservation system
    IF coupon_id_param IS NOT NULL THEN
      -- STEP 1: Verify and consume reservation
      DELETE FROM seller_main.coupon_reservations
      WHERE coupon_id = coupon_id_param
        AND customer_email = customer_email_param
        AND expires_at > NOW();

      IF NOT FOUND THEN
        -- No valid reservation - this should not happen if frontend uses verify_coupon first
        -- But we handle it gracefully: reject the payment
        RAISE EXCEPTION 'No valid coupon reservation found. Coupon may have expired or reached limit.';
      END IF;

      -- STEP 2: Atomic increment (reservation guarantees this will succeed)
      -- We still do atomic check as defense-in-depth
      UPDATE seller_main.coupons
      SET current_usage_count = COALESCE(current_usage_count, 0) + 1
      WHERE id = coupon_id_param
        AND is_active = true
        AND (usage_limit_global IS NULL OR COALESCE(current_usage_count, 0) < usage_limit_global);

      IF NOT FOUND THEN
        -- This should never happen if reservation system works correctly
        -- But if it does, we handle it gracefully
        RAISE EXCEPTION 'Coupon limit reached despite reservation (system error)';
      END IF;

      -- STEP 3: Record redemption
      INSERT INTO seller_main.coupon_redemptions (
        coupon_id, user_id, customer_email, transaction_id, discount_amount
      ) VALUES (
        coupon_id_param,
        COALESCE(current_user_id, existing_user_id),
        customer_email_param,
        transaction_id_var,
        0
      );
    END IF;

    -- SCENARIO 1: Logged-in user
    IF current_user_id IS NOT NULL THEN
      PERFORM seller_main.grant_product_access_service_role(current_user_id, product_id_param);
      IF bump_found THEN
        PERFORM seller_main.grant_product_access_service_role(current_user_id, bump_product_id_param);
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'logged_in_user_with_bump',
        'access_granted', true,
        'bump_access_granted', bump_found,
        'customer_email', customer_email_param
      );

    -- SCENARIO 2: Guest purchase, user exists
    ELSIF existing_user_id IS NOT NULL THEN
      INSERT INTO seller_main.guest_purchases (customer_email, product_id, transaction_amount, session_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param);

      IF bump_found THEN
        INSERT INTO seller_main.guest_purchases (customer_email, product_id, transaction_amount, session_id)
        VALUES (customer_email_param, bump_product_id_param, 0, session_id_param || '_bump');
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_user_exists_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param
      );

    -- SCENARIO 3: Guest purchase, new user
    ELSE
      INSERT INTO seller_main.guest_purchases (customer_email, product_id, transaction_amount, session_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param);

      IF bump_found THEN
        INSERT INTO seller_main.guest_purchases (customer_email, product_id, transaction_amount, session_id)
        VALUES (customer_email_param, bump_product_id_param, 0, session_id_param || '_bump');
      END IF;

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
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Database Error: ' || SQLERRM,
      'code', SQLSTATE
    );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

GRANT EXECUTE ON FUNCTION seller_main.process_stripe_payment_completion_with_bump TO service_role, authenticated;

-- -----------------------------------------------------------------------------
-- COUPON FUNCTIONS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_main.verify_coupon(
  code_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT DEFAULT NULL,
  currency_param TEXT DEFAULT 'USD'
) RETURNS JSONB AS $$
DECLARE
  coupon_record RECORD;
  user_usage_count INTEGER;
  reserved_count INTEGER;
  available_slots INTEGER;
  existing_reservation_id UUID;
BEGIN
  -- STEP 1: Self-cleaning - remove expired reservations
  -- This happens automatically on every verify call (no cron needed!)
  DELETE FROM seller_main.coupon_reservations WHERE expires_at < NOW();

  -- STEP 2: Lock coupon row (must use FOR UPDATE to ensure atomicity)
  SELECT * INTO coupon_record
  FROM seller_main.coupons
  WHERE code = code_param AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid code');
  END IF;

  IF coupon_record.expires_at IS NOT NULL AND coupon_record.expires_at < NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code expired');
  END IF;

  IF coupon_record.starts_at > NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code not active yet');
  END IF;

  IF coupon_record.discount_type = 'fixed' AND coupon_record.currency IS NOT NULL AND coupon_record.currency != currency_param THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code invalid for this currency');
  END IF;

  IF jsonb_array_length(coupon_record.allowed_product_ids) > 0 THEN
    IF NOT (coupon_record.allowed_product_ids @> to_jsonb(product_id_param)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code not valid for this product');
    END IF;
  END IF;

  IF jsonb_array_length(coupon_record.allowed_emails) > 0 THEN
    IF customer_email_param IS NULL OR NOT (coupon_record.allowed_emails @> to_jsonb(customer_email_param)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code not authorized for this email');
    END IF;
  END IF;

  -- STEP 3: Check per-user limit (actual redemptions)
  IF customer_email_param IS NOT NULL THEN
    SELECT COUNT(*) INTO user_usage_count
    FROM seller_main.coupon_redemptions
    WHERE coupon_id = coupon_record.id AND customer_email = customer_email_param;

    IF user_usage_count >= coupon_record.usage_limit_per_user THEN
      RETURN jsonb_build_object('valid', false, 'error', 'You have already used this code');
    END IF;
  END IF;

  -- STEP 4: Check if user already has an active reservation
  IF customer_email_param IS NOT NULL THEN
    SELECT id INTO existing_reservation_id
    FROM seller_main.coupon_reservations
    WHERE coupon_id = coupon_record.id
      AND customer_email = customer_email_param
      AND expires_at > NOW();

    IF existing_reservation_id IS NOT NULL THEN
      -- User already reserved - return success with existing reservation
      RETURN jsonb_build_object(
        'valid', true,
        'id', coupon_record.id,
        'code', coupon_record.code,
        'discount_type', coupon_record.discount_type,
        'discount_value', coupon_record.discount_value,
        'exclude_order_bumps', coupon_record.exclude_order_bumps,
        'already_reserved', true,
        'reservation_id', existing_reservation_id
      );
    END IF;
  END IF;

  -- STEP 5: Calculate available slots (global limit with reservations)
  IF coupon_record.usage_limit_global IS NOT NULL THEN
    -- Count active reservations
    SELECT COUNT(*) INTO reserved_count
    FROM seller_main.coupon_reservations
    WHERE coupon_id = coupon_record.id AND expires_at > NOW();

    -- Available = limit - redemptions - reservations
    available_slots := coupon_record.usage_limit_global
                     - coupon_record.current_usage_count
                     - reserved_count;

    IF available_slots <= 0 THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code usage limit reached');
    END IF;
  END IF;

  -- STEP 6: CREATE RESERVATION (15 minute expiry)
  IF customer_email_param IS NOT NULL THEN
    INSERT INTO seller_main.coupon_reservations (
      coupon_id,
      customer_email,
      expires_at
    ) VALUES (
      coupon_record.id,
      customer_email_param,
      NOW() + INTERVAL '15 minutes'
    )
    ON CONFLICT (coupon_id, customer_email) DO UPDATE
    SET expires_at = NOW() + INTERVAL '15 minutes',
        reserved_at = NOW();
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'id', coupon_record.id,
    'code', coupon_record.code,
    'discount_type', coupon_record.discount_type,
    'discount_value', coupon_record.discount_value,
    'exclude_order_bumps', coupon_record.exclude_order_bumps,
    'reserved', true,
    'expires_in_minutes', 15
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION seller_main.find_auto_apply_coupon(
  customer_email_param TEXT,
  product_id_param UUID
) RETURNS JSONB AS $$
DECLARE
  coupon_record RECORD;
BEGIN
  -- SECURITY FIX: Add FOR UPDATE SKIP LOCKED to prevent race conditions
  SELECT * INTO coupon_record
  FROM seller_main.coupons
  WHERE is_active = true
    AND (allowed_emails @> to_jsonb(customer_email_param))
    AND (
      jsonb_array_length(allowed_product_ids) = 0 OR
      allowed_product_ids @> to_jsonb(product_id_param)
    )
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (starts_at <= NOW())
    AND (usage_limit_global IS NULL OR current_usage_count < usage_limit_global)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'code', coupon_record.code,
    'discount_type', coupon_record.discount_type,
    'discount_value', coupon_record.discount_value,
    'exclude_order_bumps', coupon_record.exclude_order_bumps
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION seller_main.find_auto_apply_coupon TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- INTEGRATIONS FUNCTIONS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_main.get_public_integrations_config()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  config_record RECORD;
  scripts_json JSONB;
BEGIN
  SELECT * INTO config_record FROM seller_main.integrations_config WHERE id = 1;

  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'location', script_location,
    'content', script_content, 'category', category
  )) INTO scripts_json
  FROM seller_main.custom_scripts WHERE is_active = true;

  RETURN jsonb_build_object(
    'gtm_container_id', config_record.gtm_container_id,
    'gtm_server_container_url', config_record.gtm_server_container_url,
    'facebook_pixel_id', config_record.facebook_pixel_id,
    'fb_capi_enabled', COALESCE(config_record.fb_capi_enabled, false),
    'send_conversions_without_consent', COALESCE(config_record.send_conversions_without_consent, false),
    'umami_website_id', config_record.umami_website_id,
    'umami_script_url', config_record.umami_script_url,
    'cookie_consent_enabled', config_record.cookie_consent_enabled,
    'consent_logging_enabled', config_record.consent_logging_enabled,
    'scripts', COALESCE(scripts_json, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.get_public_integrations_config() TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- GUEST PAYMENT DATA MIGRATION
-- -----------------------------------------------------------------------------

/**
 * Migrates payment data from guest purchases to user profile on registration.
 *
 * ALWAYS migrates (if available in latest payment):
 * - Customer name: full_name, first_name, last_name
 *
 * ONLY if invoice was requested:
 * - Company data: tax_id, company_name, address, city, zip_code, country
 *
 * This function is called automatically by handle_new_user_registration() trigger
 * when a user registers/signs in for the first time.
 */
CREATE OR REPLACE FUNCTION seller_main.migrate_guest_payment_data_to_profile(
  p_user_id UUID
) RETURNS json AS $$
DECLARE
  user_email_var TEXT;
  latest_payment RECORD;
  rows_updated INTEGER := 0;
  profile_updated BOOLEAN := FALSE;
BEGIN
  -- Get user email
  SELECT email INTO user_email_var
  FROM auth.users
  WHERE id = p_user_id;

  IF user_email_var IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;

  -- Find LATEST guest payment (completed, with metadata)
  SELECT metadata, created_at
  INTO latest_payment
  FROM seller_main.payment_transactions
  WHERE customer_email = user_email_var
    AND user_id IS NULL  -- Guest purchases only
    AND status = 'completed'
    AND metadata IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  -- If found, update profile with latest payment data
  IF latest_payment IS NOT NULL THEN
    UPDATE seller_main.profiles
    SET
      -- ALWAYS update customer name (if provided in payment)
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

      -- Company data ONLY if invoice was requested
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION seller_main.migrate_guest_payment_data_to_profile(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- USER REGISTRATION HANDLER
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user_registration()
RETURNS TRIGGER AS $$
DECLARE
  claim_result JSON;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('handle_new_user_registration'));

  INSERT INTO seller_main.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.admin_users (user_id)
  SELECT NEW.id WHERE NOT EXISTS (SELECT 1 FROM public.admin_users LIMIT 1)
  ON CONFLICT (user_id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_guest_purchases_for_user' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'seller_main')) THEN
    SELECT seller_main.claim_guest_purchases_for_user(NEW.id) INTO claim_result;
  END IF;

  -- Migrate payment data from guest purchases to profile
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'migrate_guest_payment_data_to_profile' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'seller_main')) THEN
    PERFORM seller_main.migrate_guest_payment_data_to_profile(NEW.id);
  END IF;

  PERFORM public.log_audit_entry('auth.users', 'INSERT', NULL, jsonb_build_object('email', NEW.email), NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- ANALYTICS & DASHBOARD FUNCTIONS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_main.get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_users INTEGER;
  total_products INTEGER;
  total_revenue NUMERIC;
  active_users_7d INTEGER;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO total_users FROM auth.users;
  SELECT COUNT(*) INTO total_products FROM seller_main.products WHERE is_active = true;
  SELECT COALESCE(SUM(amount), 0) INTO total_revenue
  FROM seller_main.payment_transactions WHERE status = 'completed';

  SELECT COUNT(DISTINCT user_id) INTO active_users_7d
  FROM seller_main.user_product_access
  WHERE created_at > NOW() - INTERVAL '7 days';

  RETURN jsonb_build_object(
    'totalProducts', total_products,
    'totalUsers', total_users,
    'totalAccess', (SELECT COUNT(*) FROM seller_main.user_product_access),
    'activeUsers', active_users_7d,
    'totalRevenue', total_revenue
  );
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.get_dashboard_stats() TO authenticated;

CREATE OR REPLACE FUNCTION seller_main.get_detailed_revenue_stats(
  p_product_id UUID DEFAULT NULL,
  p_goal_start_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_revenue_by_currency JSONB;
  v_today_revenue_by_currency JSONB;
  v_today_orders INTEGER;
  v_last_order_at TIMESTAMPTZ;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_object_agg(currency, total), '{}'::jsonb)
  INTO v_total_revenue_by_currency
  FROM (
    SELECT pt.currency, SUM(pt.amount) as total
    FROM seller_main.payment_transactions pt
    WHERE pt.status = 'completed'
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
      AND (p_goal_start_date IS NULL OR pt.created_at >= p_goal_start_date)
    GROUP BY pt.currency
  ) sub;

  SELECT
    COALESCE(jsonb_object_agg(currency, total), '{}'::jsonb),
    COALESCE(SUM(order_count), 0)::INTEGER
  INTO v_today_revenue_by_currency, v_today_orders
  FROM (
    SELECT pt.currency, SUM(pt.amount) as total, COUNT(*) as order_count
    FROM seller_main.payment_transactions pt
    WHERE pt.status = 'completed'
      AND pt.created_at >= CURRENT_DATE
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY pt.currency
  ) sub;

  SELECT pt.created_at INTO v_last_order_at
  FROM seller_main.payment_transactions pt
  WHERE pt.status = 'completed'
    AND (p_product_id IS NULL OR pt.product_id = p_product_id)
  ORDER BY pt.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'totalRevenue', v_total_revenue_by_currency,
    'todayRevenue', v_today_revenue_by_currency,
    'todayOrders', v_today_orders,
    'lastOrderAt', v_last_order_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.get_detailed_revenue_stats(UUID, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION seller_main.get_sales_chart_data(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_product_id UUID DEFAULT NULL
)
RETURNS TABLE (
  date TEXT,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    TO_CHAR(pt.created_at, 'YYYY-MM-DD') as date,
    COALESCE(jsonb_object_agg(pt.currency, currency_total), '{}'::jsonb) as amount_by_currency,
    SUM(currency_orders)::INTEGER as orders
  FROM (
    SELECT
      pt.created_at,
      pt.currency,
      SUM(pt.amount) as currency_total,
      COUNT(*) as currency_orders
    FROM seller_main.payment_transactions pt
    WHERE pt.status = 'completed'
      AND pt.created_at >= p_start_date
      AND pt.created_at <= p_end_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY TO_CHAR(pt.created_at, 'YYYY-MM-DD'), pt.currency, pt.created_at
  ) pt
  GROUP BY 1
  ORDER BY 1 ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION seller_main.get_hourly_revenue_stats(
  p_target_date DATE DEFAULT CURRENT_DATE,
  p_product_id UUID DEFAULT NULL
)
RETURNS TABLE (
  hour INTEGER,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH hours AS (
    SELECT generate_series(0, 23) AS h
  ),
  sales AS (
    SELECT
      EXTRACT(HOUR FROM pt.created_at)::INTEGER as sale_hour,
      pt.currency,
      SUM(pt.amount) as total_amount,
      COUNT(*) as total_orders
    FROM seller_main.payment_transactions pt
    WHERE pt.status = 'completed'
      AND pt.created_at::DATE = p_target_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY 1, 2
  ),
  aggregated_sales AS (
    SELECT
      sale_hour,
      jsonb_object_agg(currency, total_amount) as amount_by_currency,
      SUM(total_orders)::INTEGER as total_orders
    FROM sales
    GROUP BY sale_hour
  )
  SELECT
    hours.h,
    COALESCE(aggregated_sales.amount_by_currency, '{}'::jsonb),
    COALESCE(aggregated_sales.total_orders, 0)::INTEGER
  FROM hours
  LEFT JOIN aggregated_sales ON hours.h = aggregated_sales.sale_hour
  ORDER BY hours.h ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.get_hourly_revenue_stats(DATE, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- REVENUE GOALS FUNCTIONS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_main.get_revenue_goal(p_product_id UUID DEFAULT NULL)
RETURNS TABLE (
  goal_amount BIGINT,
  start_date TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT rg.goal_amount, rg.start_date
  FROM seller_main.revenue_goals rg
  WHERE (p_product_id IS NULL AND rg.product_id IS NULL)
     OR (p_product_id IS NOT NULL AND rg.product_id = p_product_id);
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.get_revenue_goal(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION seller_main.set_revenue_goal(
  p_goal_amount BIGINT,
  p_start_date TIMESTAMPTZ,
  p_product_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_product_id IS NULL THEN
    INSERT INTO seller_main.revenue_goals (product_id, goal_amount, start_date, updated_at)
    VALUES (NULL, p_goal_amount, p_start_date, NOW())
    ON CONFLICT ((1)) WHERE product_id IS NULL
    DO UPDATE SET
      goal_amount = EXCLUDED.goal_amount,
      start_date = EXCLUDED.start_date,
      updated_at = NOW();
  ELSE
    INSERT INTO seller_main.revenue_goals (product_id, goal_amount, start_date, updated_at)
    VALUES (p_product_id, p_goal_amount, p_start_date, NOW())
    ON CONFLICT (product_id) WHERE product_id IS NOT NULL
    DO UPDATE SET
      goal_amount = EXCLUDED.goal_amount,
      start_date = EXCLUDED.start_date,
      updated_at = NOW();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.set_revenue_goal(BIGINT, TIMESTAMPTZ, UUID) TO authenticated;

-- =============================================================================
-- TRIGGERS
-- =============================================================================
-- Note: update_updated_at_column() is defined in core_schema.sql
-- We reuse it here via triggers instead of redefining it

CREATE TRIGGER trigger_update_video_progress_updated_at
  BEFORE UPDATE ON seller_main.video_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_order_bumps_updated_at
  BEFORE UPDATE ON seller_main.order_bumps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_coupons_updated_at
  BEFORE UPDATE ON seller_main.coupons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_webhook_endpoints_updated_at
  BEFORE UPDATE ON seller_main.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_integrations_config_updated_at
  BEFORE UPDATE ON seller_main.integrations_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_custom_scripts_updated_at
  BEFORE UPDATE ON seller_main.custom_scripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_profiles_updated_at
  BEFORE UPDATE ON seller_main.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_revenue_goals_updated_at
  BEFORE UPDATE ON seller_main.revenue_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_stripe_configurations_updated_at
  BEFORE UPDATE ON seller_main.stripe_configurations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_shop_config_updated_at
  BEFORE UPDATE ON seller_main.shop_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- User registration trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_registration();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE seller_main.video_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.video_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.order_bumps ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.coupon_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.integrations_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.custom_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.consent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.revenue_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.stripe_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_main.shop_config ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- VIDEO TRACKING POLICIES
-- -----------------------------------------------------------------------------

CREATE POLICY "Users can view own video progress" ON seller_main.video_progress
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own video progress" ON seller_main.video_progress
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own video progress" ON seller_main.video_progress
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Admins can view all video progress" ON seller_main.video_progress
  FOR SELECT TO authenticated
  USING (( select public.is_admin() ));

CREATE POLICY "Users can view own video events" ON seller_main.video_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM seller_main.video_progress
      WHERE video_progress.id = video_events.progress_id
      AND video_progress.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own video events" ON seller_main.video_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM seller_main.video_progress
      WHERE video_progress.id = video_events.progress_id
      AND video_progress.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all video events" ON seller_main.video_events
  FOR SELECT TO authenticated
  USING (( select public.is_admin() ));

-- -----------------------------------------------------------------------------
-- ORDER BUMPS POLICIES
-- -----------------------------------------------------------------------------

CREATE POLICY "Admins can view order bumps" ON seller_main.order_bumps
  FOR SELECT USING (
    ( select public.is_admin() )
  );

CREATE POLICY "Admins can insert order bumps" ON seller_main.order_bumps
  FOR INSERT WITH CHECK (
    ( select public.is_admin() )
  );

CREATE POLICY "Admins can update order bumps" ON seller_main.order_bumps
  FOR UPDATE USING (
    ( select public.is_admin() )
  );

CREATE POLICY "Admins can delete order bumps" ON seller_main.order_bumps
  FOR DELETE USING (
    ( select public.is_admin() )
  );

CREATE POLICY "Public can view active order bumps" ON seller_main.order_bumps
  FOR SELECT TO public USING (is_active = true);

CREATE POLICY "Service role can manage order bumps" ON seller_main.order_bumps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- COUPONS POLICIES
-- -----------------------------------------------------------------------------

CREATE POLICY "Admins full access coupons" ON seller_main.coupons
  FOR ALL TO authenticated
  USING (( select public.is_admin() ));

CREATE POLICY "Service role full access coupons" ON seller_main.coupons
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Admins full access redemptions" ON seller_main.coupon_redemptions
  FOR ALL TO authenticated
  USING (( select public.is_admin() ));

CREATE POLICY "Service role full access redemptions" ON seller_main.coupon_redemptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users view own redemptions" ON seller_main.coupon_redemptions
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Admins full access reservations" ON seller_main.coupon_reservations
  FOR ALL TO authenticated
  USING (( select public.is_admin() ));

CREATE POLICY "Service role full access reservations" ON seller_main.coupon_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- WEBHOOKS POLICIES
-- -----------------------------------------------------------------------------

CREATE POLICY "Admins can manage webhook endpoints" ON seller_main.webhook_endpoints
  FOR ALL USING (
    ( select public.is_admin() )
  );

CREATE POLICY "Admins can view webhook logs" ON seller_main.webhook_logs
  FOR SELECT USING (
    ( select public.is_admin() )
  );

CREATE POLICY "Admins can update webhook logs" ON seller_main.webhook_logs
  FOR UPDATE USING (
    ( select public.is_admin() )
  );

-- INSERT and DELETE go through service_role (webhook delivery system), not direct user access
CREATE POLICY "Service role can insert webhook logs" ON seller_main.webhook_logs
  FOR INSERT WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY "Service role can delete webhook logs" ON seller_main.webhook_logs
  FOR DELETE USING ((select auth.role()) = 'service_role');

-- -----------------------------------------------------------------------------
-- INTEGRATIONS POLICIES
-- -----------------------------------------------------------------------------

CREATE POLICY "Admins manage config" ON seller_main.integrations_config
  USING (
    ( select public.is_admin() ) OR
    ((select auth.role()) = 'service_role')
  )
  WITH CHECK (
    ( select public.is_admin() ) OR
    ((select auth.role()) = 'service_role')
  );

CREATE POLICY "Admins manage scripts" ON seller_main.custom_scripts
  USING (
    ( select public.is_admin() ) OR
    ((select auth.role()) = 'service_role')
  )
  WITH CHECK (
    ( select public.is_admin() ) OR
    ((select auth.role()) = 'service_role')
  );

CREATE POLICY "Admins view logs" ON seller_main.consent_logs
  FOR SELECT USING (
    ( select public.is_admin() ) OR
    ((select auth.role()) = 'service_role')
  );

CREATE POLICY "Authenticated users log own consent" ON seller_main.consent_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Service role insert consent" ON seller_main.consent_logs
  FOR INSERT TO service_role
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- PROFILES POLICIES
-- -----------------------------------------------------------------------------

CREATE POLICY "Self view" ON seller_main.profiles
  FOR SELECT USING ((select auth.uid()) = id);

CREATE POLICY "Self update" ON seller_main.profiles
  FOR UPDATE USING ((select auth.uid()) = id);

CREATE POLICY "Admin view" ON seller_main.profiles
  FOR SELECT USING (( select public.is_admin() ));

CREATE POLICY "Service role insert profiles" ON seller_main.profiles
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY "Admin delete profiles" ON seller_main.profiles
  FOR DELETE TO service_role
  USING (true);

-- -----------------------------------------------------------------------------
-- REVENUE GOALS POLICIES
-- -----------------------------------------------------------------------------

CREATE POLICY "Admins can manage revenue goals" ON seller_main.revenue_goals
  USING (( select public.is_admin() ))
  WITH CHECK (( select public.is_admin() ));

-- -----------------------------------------------------------------------------
-- STRIPE CONFIGURATIONS POLICIES
-- -----------------------------------------------------------------------------

CREATE POLICY "Admins full access to stripe_configurations" ON seller_main.stripe_configurations
  FOR ALL USING (
    ( select public.is_admin() ) OR
    ((select auth.role()) = 'service_role')
  )
  WITH CHECK (
    ( select public.is_admin() ) OR
    ((select auth.role()) = 'service_role')
  );

-- -----------------------------------------------------------------------------
-- SHOP CONFIG POLICIES
-- -----------------------------------------------------------------------------

-- Admin write access (INSERT, UPDATE, DELETE)
CREATE POLICY "Admins full access to shop_config" ON seller_main.shop_config
  FOR ALL TO authenticated USING (
    ( select public.is_admin() )
  )
  WITH CHECK (
    ( select public.is_admin() )
  );

-- Public read access (shop configuration needs to be visible to all users including guests)
CREATE POLICY "Public read access to shop_config" ON seller_main.shop_config
  FOR SELECT TO public USING (true);

-- =============================================================================
-- INITIAL DATA
-- =============================================================================

INSERT INTO seller_main.integrations_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- REALTIME SETUP
-- =============================================================================

ALTER TABLE seller_main.payment_transactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'seller_main'
    AND tablename = 'payment_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE seller_main.payment_transactions;
  END IF;
END $$;

-- =============================================================================
-- SECURITY VIEWS (Enterprise)
-- =============================================================================

CREATE OR REPLACE VIEW seller_main.user_access_stats WITH (security_invoker = on) AS
SELECT
  u.id as user_id,
  u.email,
  u.created_at as user_created_at,
  u.email_confirmed_at,
  u.last_sign_in_at,
  u.raw_user_meta_data,
  COUNT(upa.id) as total_products,
  COALESCE(SUM(p.price), 0) as total_value,
  MAX(upa.created_at) as last_access_granted_at,
  MIN(upa.created_at) as first_access_granted_at
FROM auth.users u
LEFT JOIN seller_main.user_product_access upa ON u.id = upa.user_id
LEFT JOIN seller_main.products p ON upa.product_id = p.id
GROUP BY u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at, u.raw_user_meta_data;

CREATE OR REPLACE VIEW seller_main.user_product_access_detailed WITH (security_invoker = on) AS
SELECT
  upa.id,
  upa.user_id,
  upa.product_id,
  p.slug as product_slug,
  p.name as product_name,
  p.description as product_description,
  p.price as product_price,
  p.currency as product_currency,
  p.icon as product_icon,
  p.is_active as product_is_active,
  upa.access_granted_at,
  upa.access_expires_at,
  upa.access_duration_days,
  upa.created_at as access_created_at,
  p.created_at as product_created_at,
  p.updated_at as product_updated_at
FROM seller_main.user_product_access upa
JOIN seller_main.products p ON upa.product_id = p.id;

DROP VIEW IF EXISTS public.rate_limit_summary;
CREATE VIEW public.rate_limit_summary WITH (security_invoker = on) AS
SELECT
  function_name,
  COUNT(*) as total_calls,
  COUNT(DISTINCT user_id) as unique_users,
  MAX(updated_at) as last_activity,
  MAX(call_count) as max_calls_per_user,
  AVG(call_count) as avg_calls_per_user
FROM public.rate_limits
GROUP BY function_name;

DROP VIEW IF EXISTS public.payment_system_health;
CREATE VIEW public.payment_system_health WITH (security_invoker = on) AS
SELECT
  'payment_transactions'::text as table_name,
  COUNT(*) as total_records,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_transactions,
  COUNT(*) FILTER (WHERE status = 'refunded') as refunded_transactions,
  COUNT(*) FILTER (WHERE status = 'disputed') as disputed_transactions,
  AVG(amount) as avg_transaction_amount,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as records_last_24h,
  NOW() as snapshot_time
FROM seller_main.payment_transactions;

REVOKE ALL ON seller_main.user_access_stats FROM anon, authenticated;
REVOKE ALL ON seller_main.user_product_access_detailed FROM anon, authenticated;
REVOKE ALL ON public.rate_limit_summary FROM anon, authenticated;
REVOKE ALL ON public.payment_system_health FROM anon, authenticated;

GRANT SELECT ON seller_main.user_access_stats TO service_role;
GRANT SELECT ON seller_main.user_product_access_detailed TO service_role;
GRANT SELECT ON public.rate_limit_summary TO service_role;
GRANT SELECT ON public.payment_system_health TO service_role;

GRANT SELECT ON auth.users TO service_role;

-- =============================================================================
-- COMMENTS (Documentation)
-- =============================================================================

COMMENT ON TABLE seller_main.video_progress IS 'Tracks user progress for video content';
COMMENT ON TABLE seller_main.order_bumps IS 'Order bump configurations for one-click upsells';
COMMENT ON TABLE seller_main.coupons IS 'Smart discount codes with auto-apply and targeting';
COMMENT ON TABLE seller_main.webhook_endpoints IS 'Webhook endpoint configurations';
COMMENT ON TABLE seller_main.integrations_config IS 'Global integrations configuration (singleton)';
COMMENT ON TABLE seller_main.stripe_configurations IS 'Encrypted Stripe API keys with rotation support';
COMMENT ON TABLE seller_main.shop_config IS 'Global shop configuration settings (singleton)';

-- =============================================================================
-- PRODUCT VARIANTS FUNCTIONS
-- =============================================================================

-- Get all active variants in a group by UUID (for variant selector page)
-- Uses M:N relationship via product_variant_groups junction table
CREATE OR REPLACE FUNCTION seller_main.get_variant_group(p_group_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  variant_name VARCHAR(100),
  display_order INTEGER,
  is_featured BOOLEAN,
  price NUMERIC,
  currency TEXT,
  description TEXT,
  image_url TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.name,
    p.slug,
    pvg.variant_name,
    pvg.display_order,
    pvg.is_featured,
    p.price,
    p.currency,
    p.description,
    p.image_url,
    p.is_active
  FROM seller_main.products p
  INNER JOIN seller_main.product_variant_groups pvg ON pvg.product_id = p.id
  WHERE pvg.group_id = p_group_id
    AND p.is_active = true
  ORDER BY pvg.display_order ASC, p.price ASC;
$$;

COMMENT ON FUNCTION seller_main.get_variant_group(UUID) IS 'Get all active variants in a group by UUID (M:N schema)';
GRANT EXECUTE ON FUNCTION seller_main.get_variant_group(UUID) TO anon, authenticated, service_role;

-- Get all active variants in a group by slug (for variant selector page)
CREATE OR REPLACE FUNCTION seller_main.get_variant_group_by_slug(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  variant_name VARCHAR(100),
  display_order INTEGER,
  is_featured BOOLEAN,
  price NUMERIC,
  currency TEXT,
  description TEXT,
  image_url TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.name,
    p.slug,
    pvg.variant_name,
    pvg.display_order,
    pvg.is_featured,
    p.price,
    p.currency,
    p.description,
    p.image_url,
    p.is_active
  FROM seller_main.products p
  INNER JOIN seller_main.product_variant_groups pvg ON pvg.product_id = p.id
  INNER JOIN seller_main.variant_groups vg ON vg.id = pvg.group_id
  WHERE vg.slug = p_slug
    AND p.is_active = true
  ORDER BY pvg.display_order ASC, p.price ASC;
$$;

COMMENT ON FUNCTION seller_main.get_variant_group_by_slug(TEXT) IS 'Get all active variants in a group by slug (M:N schema)';
GRANT EXECUTE ON FUNCTION seller_main.get_variant_group_by_slug(TEXT) TO anon, authenticated, service_role;

COMMENT ON COLUMN seller_main.order_bumps.bump_price IS 'Special discounted price for bump (NULL = use product default price)';
COMMENT ON COLUMN seller_main.stripe_configurations.encrypted_key IS 'AES-256-GCM encrypted Stripe API key (base64 encoded)';
COMMENT ON COLUMN seller_main.shop_config.custom_settings IS 'Flexible JSONB field for additional custom settings';
COMMENT ON COLUMN seller_main.shop_config.terms_of_service_url IS 'URL to Terms of Service document (PDF, webpage, etc.)';
COMMENT ON COLUMN seller_main.shop_config.privacy_policy_url IS 'URL to Privacy Policy document (PDF, webpage, etc.)';

-- =============================================================================
-- PROXY VIEWS (backward compatibility for shop tables moved to seller_main)
-- =============================================================================

CREATE OR REPLACE VIEW public.video_progress WITH (security_invoker = on) AS SELECT * FROM seller_main.video_progress;
CREATE OR REPLACE VIEW public.video_events WITH (security_invoker = on) AS SELECT * FROM seller_main.video_events;
CREATE OR REPLACE VIEW public.order_bumps WITH (security_invoker = on) AS SELECT * FROM seller_main.order_bumps;
CREATE OR REPLACE VIEW public.coupons WITH (security_invoker = on) AS SELECT * FROM seller_main.coupons;
CREATE OR REPLACE VIEW public.coupon_redemptions WITH (security_invoker = on) AS SELECT * FROM seller_main.coupon_redemptions;
CREATE OR REPLACE VIEW public.coupon_reservations WITH (security_invoker = on) AS SELECT * FROM seller_main.coupon_reservations;
CREATE OR REPLACE VIEW public.webhook_endpoints WITH (security_invoker = on) AS SELECT * FROM seller_main.webhook_endpoints;
CREATE OR REPLACE VIEW public.webhook_logs WITH (security_invoker = on) AS SELECT * FROM seller_main.webhook_logs;
CREATE OR REPLACE VIEW public.integrations_config WITH (security_invoker = on) AS SELECT * FROM seller_main.integrations_config;
CREATE OR REPLACE VIEW public.custom_scripts WITH (security_invoker = on) AS SELECT * FROM seller_main.custom_scripts;
CREATE OR REPLACE VIEW public.consent_logs WITH (security_invoker = on) AS SELECT * FROM seller_main.consent_logs;
CREATE OR REPLACE VIEW public.profiles WITH (security_invoker = on) AS SELECT * FROM seller_main.profiles;
CREATE OR REPLACE VIEW public.revenue_goals WITH (security_invoker = on) AS SELECT * FROM seller_main.revenue_goals;
CREATE OR REPLACE VIEW public.stripe_configurations WITH (security_invoker = on) AS SELECT * FROM seller_main.stripe_configurations;
CREATE OR REPLACE VIEW public.shop_config WITH (security_invoker = on) AS SELECT * FROM seller_main.shop_config;

-- =============================================================================
-- EXPLICIT TABLE GRANTS (Security Rule #5: never rely on blanket default privileges)
-- =============================================================================
-- Public catalog tables: anon + authenticated SELECT
GRANT SELECT ON seller_main.order_bumps TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.order_bumps TO authenticated;
GRANT SELECT ON seller_main.shop_config TO anon;
GRANT SELECT, UPDATE ON seller_main.shop_config TO authenticated;
-- User's own data: authenticated CRUD (RLS enforced)
GRANT SELECT, INSERT, UPDATE ON seller_main.video_progress TO authenticated;
GRANT INSERT ON seller_main.video_events TO authenticated;
GRANT SELECT, INSERT ON seller_main.coupon_redemptions TO authenticated;
GRANT SELECT, INSERT, DELETE ON seller_main.coupon_reservations TO authenticated;
GRANT SELECT, INSERT ON seller_main.consent_logs TO authenticated;
GRANT SELECT, UPDATE ON seller_main.profiles TO authenticated;
-- Admin-only tables: REVOKE blanket access, then GRANT only what RLS policies need
REVOKE ALL ON seller_main.coupons FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.coupons TO authenticated;
REVOKE ALL ON seller_main.webhook_endpoints FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.webhook_endpoints TO authenticated;
REVOKE ALL ON seller_main.webhook_logs FROM anon, authenticated;
GRANT SELECT, UPDATE ON seller_main.webhook_logs TO authenticated;
REVOKE ALL ON seller_main.integrations_config FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.integrations_config TO authenticated;
REVOKE ALL ON seller_main.custom_scripts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.custom_scripts TO authenticated;
REVOKE ALL ON seller_main.revenue_goals FROM anon, authenticated;
-- revenue_goals: no application code uses this table via authenticated role.
-- Only service_role (via ALTER DEFAULT PRIVILEGES) has access. If future code
-- needs authenticated access, add minimal grants here.
REVOKE ALL ON seller_main.stripe_configurations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON seller_main.stripe_configurations TO authenticated;

-- ===== ATOMIC COUPON USAGE INCREMENT =====
-- Used by 100% coupon flow (create-payment-intent) to prevent race conditions
-- where concurrent requests could both read the same usage count and exceed the limit.
CREATE OR REPLACE FUNCTION seller_main.increment_coupon_usage(coupon_id_param uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE seller_main.coupons
  SET current_usage_count = COALESCE(current_usage_count, 0) + 1
  WHERE id = coupon_id_param;
END;
$$;

REVOKE EXECUTE ON FUNCTION seller_main.increment_coupon_usage FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION seller_main.increment_coupon_usage TO service_role;
