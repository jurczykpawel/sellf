-- Persist the Stripe Product ID per Sellf product.
--
-- stripe_price_id (existing) pins a FIXED recurring price for traditional
-- subscription products. For PWYW subscriptions the price is dynamic per
-- buyer, so we can't pre-create a Price — but we DO need a stable Stripe
-- Product to reference from `subscriptions.create.items.price_data.product`
-- (Stripe rejects inline `product_data` in that nested context).
--
-- Lazy-populated by ensureStripeProduct() during the first PWYW subscription
-- create. Backward compatible: existing fixed-price subscriptions don't read
-- this column.

ALTER TABLE seller_main.products
  ADD COLUMN stripe_product_id TEXT;

COMMENT ON COLUMN seller_main.products.stripe_product_id IS
  'Stripe Product ID lazily created the first time a buyer initiates a PWYW subscription for this product. Reused for subsequent dynamic-price subscriptions so we never accumulate one Stripe Product per donation amount.';

-- Refresh the public view so PostgREST sees the new column.
CREATE OR REPLACE VIEW public.products WITH (security_invoker = on) AS
  SELECT * FROM seller_main.products;
