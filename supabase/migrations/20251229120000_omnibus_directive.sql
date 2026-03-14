-- Omnibus Directive (EU 2019/2161) - 30-Day Price History Tracking
-- Implements requirement to display lowest price from last 30 days when showing discounts

-- Suppress NOTICE messages during migration (e.g., "relation already exists, skipping")
SET client_min_messages = warning;

-- ============================================================================
-- 1. Add omnibus_exempt flag and sale price fields to products table
-- ============================================================================
ALTER TABLE seller_main.products
ADD COLUMN IF NOT EXISTS omnibus_exempt BOOLEAN DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS sale_price NUMERIC CHECK (sale_price >= 0),
ADD COLUMN IF NOT EXISTS sale_price_until TIMESTAMPTZ,
-- Quantity-based sale limits (added 2026-01-02)
ADD COLUMN IF NOT EXISTS sale_quantity_limit INTEGER CHECK (sale_quantity_limit IS NULL OR sale_quantity_limit > 0),
ADD COLUMN IF NOT EXISTS sale_quantity_sold INTEGER DEFAULT 0 NOT NULL CHECK (sale_quantity_sold >= 0);

-- Refresh proxy view to include new columns
CREATE OR REPLACE VIEW public.products WITH (security_invoker = on) AS SELECT * FROM seller_main.products;

COMMENT ON COLUMN seller_main.products.omnibus_exempt IS
  'Exempt this product from Omnibus price history display (e.g., perishable goods, new arrivals <30 days)';

COMMENT ON COLUMN seller_main.products.sale_price IS
  'Promotional price for the product. When set and active (not expired), this is the public discounted price that triggers Omnibus display.';

COMMENT ON COLUMN seller_main.products.sale_price_until IS
  'Optional expiration date for sale_price. NULL means sale price is active indefinitely. When date passes, sale_price is no longer used.';

COMMENT ON COLUMN seller_main.products.sale_quantity_limit IS
  'Maximum number of units that can be sold at sale price (NULL = unlimited). When limit is reached, sale_price is no longer used.';

COMMENT ON COLUMN seller_main.products.sale_quantity_sold IS
  'Number of units already sold at sale price. Automatically incremented on successful payment when sale is active.';

-- ============================================================================
-- 2. Create product_price_history table
-- ============================================================================
CREATE TABLE IF NOT EXISTS seller_main.product_price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES seller_main.products(id) ON DELETE CASCADE NOT NULL,
  price NUMERIC NOT NULL CHECK (price >= 0),
  sale_price NUMERIC CHECK (sale_price >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  vat_rate DECIMAL(5,2),
  price_includes_vat BOOLEAN DEFAULT true,
  effective_from TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  effective_until TIMESTAMPTZ, -- NULL = current price
  changed_by UUID REFERENCES auth.users(id),
  change_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE seller_main.product_price_history IS
  'Price history for Omnibus Directive compliance (EU 2019/2161) - tracks lowest price in last 30 days';

-- Index for fast queries (product + date range)
CREATE INDEX IF NOT EXISTS idx_product_price_history_product_date
  ON seller_main.product_price_history(product_id, effective_from DESC);

-- Index for finding current prices (where effective_until IS NULL)
CREATE INDEX IF NOT EXISTS idx_product_price_history_current
  ON seller_main.product_price_history(product_id, effective_until) WHERE effective_until IS NULL;

-- ============================================================================
-- 3. Add Omnibus settings to shop_config as proper columns
-- ============================================================================
ALTER TABLE seller_main.shop_config
ADD COLUMN IF NOT EXISTS omnibus_enabled BOOLEAN DEFAULT true NOT NULL;

-- Refresh proxy view to include new column
CREATE OR REPLACE VIEW public.shop_config WITH (security_invoker = on) AS SELECT * FROM seller_main.shop_config;

COMMENT ON COLUMN seller_main.shop_config.omnibus_enabled IS
  'Global toggle for EU Omnibus Directive (2019/2161) price history display';

-- ============================================================================
-- 4. Create trigger function to log price changes automatically
-- ============================================================================
CREATE OR REPLACE FUNCTION seller_main.log_product_price_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if price or sale_price actually changed
  IF (TG_OP = 'UPDATE' AND
      (OLD.price != NEW.price OR
       OLD.sale_price IS DISTINCT FROM NEW.sale_price OR
       OLD.currency != NEW.currency OR
       OLD.vat_rate != NEW.vat_rate)) OR
     TG_OP = 'INSERT' THEN

    -- Close previous price period
    IF TG_OP = 'UPDATE' THEN
      UPDATE seller_main.product_price_history
      SET effective_until = NOW()
      WHERE product_id = OLD.id
        AND effective_until IS NULL;
    END IF;

    -- Insert new price record
    INSERT INTO seller_main.product_price_history (
      product_id, price, sale_price, currency, vat_rate,
      price_includes_vat, effective_from
    ) VALUES (
      NEW.id, NEW.price, NEW.sale_price, NEW.currency, NEW.vat_rate,
      NEW.price_includes_vat, NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION seller_main.log_product_price_change() IS
  'Automatically logs price changes to product_price_history for Omnibus compliance';

-- ============================================================================
-- 5. Create trigger on products table
-- ============================================================================
DROP TRIGGER IF EXISTS product_price_change_trigger ON seller_main.products;

CREATE TRIGGER product_price_change_trigger
  AFTER INSERT OR UPDATE OF price, sale_price, currency, vat_rate
  ON seller_main.products
  FOR EACH ROW
  EXECUTE FUNCTION seller_main.log_product_price_change();

-- ============================================================================
-- 6. Backfill existing products (create initial price history entries)
-- ============================================================================
-- Only backfill products that don't have any price history yet
INSERT INTO seller_main.product_price_history (
  product_id,
  price,
  sale_price,
  currency,
  vat_rate,
  price_includes_vat,
  effective_from
)
SELECT
  id,
  price,
  sale_price,
  currency,
  vat_rate,
  price_includes_vat,
  created_at -- Use product creation time as effective_from
FROM seller_main.products
WHERE NOT EXISTS (
  SELECT 1 FROM seller_main.product_price_history
  WHERE product_price_history.product_id = products.id
);

-- ============================================================================
-- 7. Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on product_price_history
ALTER TABLE seller_main.product_price_history ENABLE ROW LEVEL SECURITY;

-- Everyone can read price history (public data for transparency)
CREATE POLICY "Price history is publicly readable"
  ON seller_main.product_price_history
  FOR SELECT
  USING (true);

-- Only system (via trigger) or admins can insert price history
CREATE POLICY "Only system or admins can insert price history"
  ON seller_main.product_price_history
  FOR INSERT
  WITH CHECK (
    -- Allow trigger (no auth.uid())
    auth.uid() IS NULL
    OR
    -- Or allow admins
    ( select public.is_admin() )
  );

-- Only admins can update price history (for manual corrections)
CREATE POLICY "Only admins can update price history"
  ON seller_main.product_price_history
  FOR UPDATE
  USING (
    ( select public.is_admin() )
  );

-- Only admins can delete price history
CREATE POLICY "Only admins can delete price history"
  ON seller_main.product_price_history
  FOR DELETE
  USING (
    ( select public.is_admin() )
  );

-- shop_config already has RLS policies defined in core schema migration

-- ============================================================================
-- 8. Auto-cleanup old price history (keep only last 30 days)
-- ============================================================================
CREATE OR REPLACE FUNCTION seller_main.cleanup_old_price_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete price history entries older than 30 days
  DELETE FROM seller_main.product_price_history
  WHERE effective_from < NOW() - INTERVAL '30 days'
    AND effective_until IS NOT NULL; -- Only delete closed periods, keep current price

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION seller_main.cleanup_old_price_history() IS
  'Automatically removes price history entries older than 30 days to comply with Omnibus Directive requirements';

-- Create trigger to run cleanup on every insert
DROP TRIGGER IF EXISTS cleanup_price_history_trigger ON seller_main.product_price_history;

CREATE TRIGGER cleanup_price_history_trigger
  AFTER INSERT ON seller_main.product_price_history
  FOR EACH STATEMENT
  EXECUTE FUNCTION seller_main.cleanup_old_price_history();

-- ============================================================================
-- 9. Sale Quantity Limit Helper Functions
-- ============================================================================

-- Helper function to check if sale price is currently active
CREATE OR REPLACE FUNCTION seller_main.is_sale_price_active(
  p_sale_price NUMERIC,
  p_sale_price_until TIMESTAMPTZ,
  p_sale_quantity_limit INTEGER,
  p_sale_quantity_sold INTEGER
) RETURNS BOOLEAN AS $$
BEGIN
  -- No sale price set
  IF p_sale_price IS NULL OR p_sale_price <= 0 THEN
    RETURN FALSE;
  END IF;

  -- Check time limit (if set)
  IF p_sale_price_until IS NOT NULL AND p_sale_price_until <= NOW() THEN
    RETURN FALSE;
  END IF;

  -- Check quantity limit (if set)
  IF p_sale_quantity_limit IS NOT NULL AND COALESCE(p_sale_quantity_sold, 0) >= p_sale_quantity_limit THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE
SET search_path = '';

COMMENT ON FUNCTION seller_main.is_sale_price_active IS
  'Check if sale price is currently active (considers both time and quantity limits)';

-- Function to atomically increment sale_quantity_sold after successful payment
CREATE OR REPLACE FUNCTION seller_main.increment_sale_quantity_sold(
  p_product_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  -- SECURITY: Atomic check-and-update in single statement to prevent race conditions
  -- This ensures sale validity is checked at the exact moment of update, not before
  UPDATE seller_main.products
  SET sale_quantity_sold = COALESCE(sale_quantity_sold, 0) + 1
  WHERE id = p_product_id
    AND sale_price IS NOT NULL
    AND sale_price > 0
    AND (sale_price_until IS NULL OR sale_price_until > NOW())
    AND (sale_quantity_limit IS NULL OR COALESCE(sale_quantity_sold, 0) < sale_quantity_limit);

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

COMMENT ON FUNCTION seller_main.increment_sale_quantity_sold IS
  'Atomically increment sale_quantity_sold for a product (uses row locking to prevent race conditions)';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION seller_main.increment_sale_quantity_sold(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION seller_main.is_sale_price_active(NUMERIC, TIMESTAMPTZ, INTEGER, INTEGER) TO anon, authenticated, service_role;

-- Proxy view for backward compatibility
CREATE OR REPLACE VIEW public.product_price_history WITH (security_invoker = on) AS SELECT * FROM seller_main.product_price_history;

-- Explicit table grants (Security Rule #5)
-- product_price_history: public price history for omnibus compliance display
GRANT SELECT ON seller_main.product_price_history TO anon, authenticated;
