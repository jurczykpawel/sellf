-- Change vat_rate default from 23.00 to NULL (copy-on-create from shop_config)
ALTER TABLE products ALTER COLUMN vat_rate SET DEFAULT NULL;

-- Set existing products with hardcoded 23% to NULL (will use shop_config default on next edit)
UPDATE products SET vat_rate = NULL WHERE vat_rate = 23.00;

-- ===== Dual Tax Mode =====
-- tax_mode: 'local' = fixed rate from product/shop sent to Stripe as manual Tax Rate
--           'stripe_tax' = Stripe Automatic Tax based on customer location + registrations
ALTER TABLE shop_config
ADD COLUMN IF NOT EXISTS tax_mode TEXT DEFAULT 'local'
  CHECK (tax_mode IN ('local', 'stripe_tax'));

-- Cache for Stripe Tax Rate IDs (immutable objects, keyed by "23.00_inclusive" → "txr_xxx")
ALTER TABLE shop_config
ADD COLUMN IF NOT EXISTS stripe_tax_rate_cache JSONB DEFAULT '{}'::jsonb;

-- Migrate existing: if automatic_tax was explicitly disabled, assume local mode
UPDATE shop_config SET tax_mode = 'local' WHERE automatic_tax_enabled = false;
UPDATE shop_config SET tax_mode = 'stripe_tax' WHERE automatic_tax_enabled IS NULL OR automatic_tax_enabled = true;
