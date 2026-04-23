-- Allow PWYW products with minimum price of 0 (free option)
-- Previously custom_price_min was constrained to >= 0.50 (Stripe minimum)
-- Now we allow 0 to support "Pay What You Want" with free option

-- Relax the CHECK constraint on custom_price_min
ALTER TABLE seller_main.products DROP CONSTRAINT IF EXISTS products_custom_price_min_check;
ALTER TABLE seller_main.products ADD CONSTRAINT products_custom_price_min_check CHECK (custom_price_min >= 0);

-- NOTE: PWYW-free grant path is now unified into seller_main.grant_free_product_access
-- (see 20260306170242_add_rate_limit_to_grant_free_access.sql). A dedicated
-- grant_pwyw_free_access RPC is no longer needed — one function handles three
-- eligibility paths: price=0 / PWYW-free / 100%-coupon on paid product.
