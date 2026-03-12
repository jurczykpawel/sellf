-- Migration: Payment Method Configuration
-- Description: Global payment method configuration with future per-product extensibility
-- Author: Claude Sonnet 4.5
-- Date: 2026-01-15

SET client_min_messages = warning;

BEGIN;

-- =============================================================================
-- PAYMENT METHOD CONFIGURATION DOMAIN
-- =============================================================================

-- Global payment method configuration (singleton)
-- This table stores the global payment method configuration for the entire shop.
-- Future: Per-product overrides via products.payment_config_override JSONB column
CREATE TABLE IF NOT EXISTS seller_main.payment_method_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Singleton constraint

  -- Configuration mode
  config_mode TEXT NOT NULL DEFAULT 'automatic'
    CHECK (config_mode IN ('automatic', 'stripe_preset', 'custom')),
  -- automatic: Use Stripe's automatic_payment_methods with allow_redirects
  -- stripe_preset: Use a specific Stripe Payment Method Configuration (pmc_xxx)
  -- custom: Use explicit payment_method_types array with custom ordering

  -- Stripe Payment Method Configuration ID (for 'stripe_preset' mode)
  stripe_pmc_id TEXT CHECK (
    (config_mode = 'stripe_preset' AND stripe_pmc_id IS NOT NULL AND stripe_pmc_id ~ '^pmc_') OR
    (config_mode != 'stripe_preset')
  ),
  stripe_pmc_name TEXT, -- Cached name from Stripe Dashboard for display
  stripe_pmc_last_synced TIMESTAMPTZ, -- When we last fetched from Stripe API

  -- Custom payment methods configuration (for 'custom' mode)
  -- Array of payment method types with metadata
  custom_payment_methods JSONB DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(custom_payment_methods) = 'array'
  ),
  -- Example structure:
  -- [
  --   {"type": "card", "enabled": true, "display_order": 0, "currency_restrictions": []},
  --   {"type": "blik", "enabled": true, "display_order": 1, "currency_restrictions": ["PLN"]},
  --   {"type": "p24", "enabled": true, "display_order": 2, "currency_restrictions": ["PLN", "EUR"]}
  -- ]

  -- Payment method display ordering (works with all modes)
  -- Array of payment method type strings in desired order
  payment_method_order JSONB DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(payment_method_order) = 'array'
  ),
  -- Example: ["blik", "p24", "card", "sepa_debit", "ideal"]

  -- Currency-specific overrides (optional, for advanced use cases)
  -- Allows different ordering per currency
  currency_overrides JSONB DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(currency_overrides) = 'object'
  ),
  -- Example: {"PLN": ["blik", "p24", "card"], "EUR": ["sepa_debit", "ideal", "card"]}

  -- Express checkout configuration
  enable_express_checkout BOOLEAN DEFAULT true NOT NULL,
  enable_apple_pay BOOLEAN DEFAULT true NOT NULL,
  enable_google_pay BOOLEAN DEFAULT true NOT NULL,
  enable_link BOOLEAN DEFAULT true NOT NULL,

  -- Cache for available payment methods from Stripe
  -- Refreshed periodically to show admin what's available
  available_payment_methods JSONB DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(available_payment_methods) = 'array'
  ),
  -- Example: [{"id": "pmc_xxx", "name": "Default", "active": true, ...}, ...]

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_modified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Ensure singleton row exists with defaults
INSERT INTO seller_main.payment_method_config (id, config_mode)
VALUES (1, 'automatic')
ON CONFLICT (id) DO NOTHING;

-- Index for faster lookups (though singleton, good practice)
CREATE INDEX IF NOT EXISTS idx_payment_method_config_mode
  ON seller_main.payment_method_config(config_mode);

-- GIN index for JSONB columns (improves query performance on custom_payment_methods)
CREATE INDEX IF NOT EXISTS idx_payment_method_config_custom_methods
  ON seller_main.payment_method_config USING GIN (custom_payment_methods);

CREATE INDEX IF NOT EXISTS idx_payment_method_config_currency_overrides
  ON seller_main.payment_method_config USING GIN (currency_overrides);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION seller_main.update_payment_method_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_method_config_updated_at
  BEFORE UPDATE ON seller_main.payment_method_config
  FOR EACH ROW
  EXECUTE FUNCTION seller_main.update_payment_method_config_timestamp();

-- Trigger to protect created_at from modification
CREATE OR REPLACE FUNCTION seller_main.protect_payment_method_config_created_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.created_at = OLD.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_method_config_protect_created_at
  BEFORE UPDATE ON seller_main.payment_method_config
  FOR EACH ROW
  EXECUTE FUNCTION seller_main.protect_payment_method_config_created_at();

-- =============================================================================
-- COMMENTS (DOCUMENTATION)
-- =============================================================================

COMMENT ON TABLE seller_main.payment_method_config IS
  'Global payment method configuration (singleton). Controls how payment methods are displayed at checkout. Future: per-product overrides via products.payment_config_override JSONB column';

COMMENT ON COLUMN seller_main.payment_method_config.id IS
  'Singleton ID (always 1). Enforced by PRIMARY KEY and CHECK constraint';

COMMENT ON COLUMN seller_main.payment_method_config.config_mode IS
  'Configuration mode: automatic (Stripe default), stripe_preset (use specific PMC), or custom (explicit payment methods)';

COMMENT ON COLUMN seller_main.payment_method_config.stripe_pmc_id IS
  'Stripe Payment Method Configuration ID (e.g., pmc_xxx). Required for stripe_preset mode. Must start with pmc_ prefix';

COMMENT ON COLUMN seller_main.payment_method_config.stripe_pmc_name IS
  'Cached display name of the Stripe PMC (e.g., "Default Config", "EU Only"). Updated when PMC is selected';

COMMENT ON COLUMN seller_main.payment_method_config.stripe_pmc_last_synced IS
  'Timestamp of last successful fetch from Stripe API. Used for cache TTL (1 hour)';

COMMENT ON COLUMN seller_main.payment_method_config.custom_payment_methods IS
  'Custom payment methods array with enabled state, order, and currency restrictions (only for custom mode). Structure: [{"type": "blik", "enabled": true, "display_order": 0, "currency_restrictions": ["PLN"]}]';

COMMENT ON COLUMN seller_main.payment_method_config.payment_method_order IS
  'Preferred display order of payment methods. Used for paymentMethodOrder in PaymentElement options. Example: ["blik", "p24", "card"]';

COMMENT ON COLUMN seller_main.payment_method_config.currency_overrides IS
  'Currency-specific payment method ordering overrides for localized optimization. Example: {"PLN": ["blik", "p24", "card"], "EUR": ["sepa_debit", "ideal"]}';

COMMENT ON COLUMN seller_main.payment_method_config.enable_express_checkout IS
  'Master toggle for Express Checkout Element (Link, Apple Pay, Google Pay)';

COMMENT ON COLUMN seller_main.payment_method_config.enable_apple_pay IS
  'Enable Apple Pay in Express Checkout Element';

COMMENT ON COLUMN seller_main.payment_method_config.enable_google_pay IS
  'Enable Google Pay in Express Checkout Element';

COMMENT ON COLUMN seller_main.payment_method_config.enable_link IS
  'Enable Stripe Link in Express Checkout Element for one-click checkout';

COMMENT ON COLUMN seller_main.payment_method_config.available_payment_methods IS
  'Cached list of Stripe Payment Method Configurations from API. Refreshed every 1 hour. Used for admin UI dropdown';

COMMENT ON COLUMN seller_main.payment_method_config.last_modified_by IS
  'User ID of the admin who last modified this configuration';

-- =============================================================================
-- RLS POLICIES
-- =============================================================================

-- Enable RLS
ALTER TABLE seller_main.payment_method_config ENABLE ROW LEVEL SECURITY;

-- Admin users can read configuration
CREATE POLICY "Admin users can view payment method config"
  ON seller_main.payment_method_config
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.user_id = auth.uid()
    )
  );

-- Admin users can update configuration
CREATE POLICY "Admin users can update payment method config"
  ON seller_main.payment_method_config
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.user_id = auth.uid()
    )
  );

-- Service role can do anything (for API routes)
CREATE POLICY "Service role full access to payment method config"
  ON seller_main.payment_method_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- FUTURE: PER-PRODUCT OVERRIDE (BACKLOG - NOT IMPLEMENTED IN PHASE 1)
-- =============================================================================

-- Uncomment when implementing Phase 2:
--
-- Add column to products table for per-product payment method override
-- ALTER TABLE seller_main.products
-- ADD COLUMN IF NOT EXISTS payment_config_override JSONB DEFAULT NULL;
--
-- Structure matches payment_method_config but at product level:
-- {
--   "override_enabled": true,
--   "config_mode": "custom",
--   "stripe_pmc_id": null,
--   "custom_payment_methods": [{"type": "card", "enabled": true, ...}],
--   "payment_method_order": ["card", "blik"],
--   "currency_overrides": {},
--   "enable_express_checkout": true,
--   "enable_apple_pay": true,
--   "enable_google_pay": true,
--   "enable_link": true
-- }
--
-- COMMENT ON COLUMN seller_main.products.payment_config_override IS
--   'Per-product payment method configuration override. If NULL, uses global config from payment_method_config table. If set with override_enabled=true, takes precedence over global config';

-- =============================================================================
-- INSERT DEFAULT RECOMMENDED CONFIGURATION
-- =============================================================================

-- Insert default recommended configuration optimized for Polish market
-- Order: BLIK -> Przelewy24 -> Card + Express Checkout enabled
INSERT INTO seller_main.payment_method_config (
  id,
  config_mode,
  stripe_pmc_id,
  stripe_pmc_name,
  custom_payment_methods,
  payment_method_order,
  currency_overrides,
  enable_express_checkout,
  enable_apple_pay,
  enable_google_pay,
  enable_link,
  available_payment_methods
) VALUES (
  1,
  'custom',
  NULL,
  NULL,
  '[
    {"type": "blik", "enabled": true, "display_order": 0, "currency_restrictions": ["PLN"], "label": "BLIK"},
    {"type": "p24", "enabled": true, "display_order": 1, "currency_restrictions": ["PLN", "EUR"], "label": "Przelewy24"},
    {"type": "card", "enabled": true, "display_order": 2, "currency_restrictions": [], "label": "Card"}
  ]'::jsonb,
  '["blik", "p24", "card"]'::jsonb,
  '{}'::jsonb,
  true,
  true,
  true,
  true,
  '[]'::jsonb
) ON CONFLICT (id) DO UPDATE SET
  config_mode = EXCLUDED.config_mode,
  custom_payment_methods = EXCLUDED.custom_payment_methods,
  payment_method_order = EXCLUDED.payment_method_order,
  enable_express_checkout = EXCLUDED.enable_express_checkout,
  enable_apple_pay = EXCLUDED.enable_apple_pay,
  enable_google_pay = EXCLUDED.enable_google_pay,
  enable_link = EXCLUDED.enable_link,
  updated_at = NOW();

-- Proxy view for backward compatibility
CREATE OR REPLACE VIEW public.payment_method_config WITH (security_invoker = on) AS SELECT * FROM seller_main.payment_method_config;

COMMIT;
