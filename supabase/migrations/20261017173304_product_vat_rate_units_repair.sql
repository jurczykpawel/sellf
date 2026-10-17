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
