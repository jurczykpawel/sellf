-- Per-product webhook scoping.
--
-- An endpoint either fires for every product (product_filter_mode = 'all',
-- the existing behaviour and default) or only for an explicit set of products
-- (product_filter_mode = 'selected'), held in the webhook_endpoint_products
-- junction. The data model is license-agnostic: gating of the 'selected' mode
-- is enforced at write time in the API layer, not here, so the downgrade
-- policy can change without a migration.

ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS product_filter_mode TEXT NOT NULL DEFAULT 'all'
    CHECK (product_filter_mode IN ('all', 'selected'));

CREATE TABLE IF NOT EXISTS public.webhook_endpoint_products (
  webhook_endpoint_id UUID REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (webhook_endpoint_id, product_id)
);

ALTER TABLE public.webhook_endpoint_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage webhook endpoint products" ON public.webhook_endpoint_products
  FOR ALL USING (
    ( select public.is_admin() )
  );

REVOKE ALL ON public.webhook_endpoint_products FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_endpoint_products TO authenticated;

CREATE INDEX IF NOT EXISTS idx_webhook_endpoint_products_product_id
  ON public.webhook_endpoint_products(product_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoint_products_endpoint_id
  ON public.webhook_endpoint_products(webhook_endpoint_id);
