-- Add per-product checkout template selector.
--
-- Buyers visiting /checkout/<slug> are rendered by the template referenced
-- here. 'default' = current payment form. 'tip-jar' = donation-style page
-- with PWYW + recent supporters. Registry of allowed slugs lives in
-- admin-panel/src/lib/checkout-templates/types.ts; the CHECK constraint
-- below is defense-in-depth so a hand-rolled SQL update can never put the
-- table into a state the renderer can't handle (it would fall back to
-- 'default' anyway, but we'd rather fail loud at write time).
--
-- @see admin-panel/src/lib/checkout-templates/registry.ts

ALTER TABLE seller_main.products
  ADD COLUMN checkout_template TEXT NOT NULL DEFAULT 'default';

ALTER TABLE seller_main.products
  ADD CONSTRAINT products_checkout_template_check
  CHECK (checkout_template IN ('default', 'tip-jar'));

COMMENT ON COLUMN seller_main.products.checkout_template IS
  'Slug of the React template that renders /checkout/<slug>. Allowed values mirrored in admin-panel/src/lib/checkout-templates/types.ts.';

-- public.products is a SELECT * view but Postgres freezes the column list at
-- view-creation time; recreate so the new column is exposed to PostgREST and
-- to any client going through the public schema.
CREATE OR REPLACE VIEW public.products WITH (security_invoker = on) AS
  SELECT * FROM seller_main.products;
