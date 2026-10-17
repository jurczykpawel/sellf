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
--   * Products are not told apart by origin (no marker exists), exempt products
--     included: their stored rate is shown nowhere while exempt, and a later
--     switch back to taxable must not expose a fraction.
--
-- Records already written are kept exactly as recorded: completed payments, line
-- items, invoices and their tax snapshots, and product_price_history rows. They
-- describe what was charged at the time. The corrected product row adds one new
-- product_price_history entry (the existing price/rate change trigger), so the
-- history shows the rate change with its date.
-- Open checkout sessions keep the rate they were created with; new sessions use
-- the corrected value. No audit_log row is written: the codebase records admin
-- actions through mutate_product_with_audit, and earlier data repairs do not log.

UPDATE public.products
   SET vat_rate = vat_rate * 100
 WHERE vat_rate > 0
   AND vat_rate < 1;
