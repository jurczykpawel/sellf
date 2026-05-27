-- Custom checkout fields — product-level shared system usable by ANY template.
--
-- products.custom_checkout_fields    JSONB array of field definitions
-- payment_transactions.custom_field_values JSONB map of field id → buyer-typed string
--
-- Shape + hard limits are enforced by
-- admin-panel/src/lib/validations/custom-checkout-fields.ts which is the
-- single source of truth — server (API) + client (admin editor) both use it.
-- DB stays opinion-free about contents so future field types / shape evolution
-- don't require a new migration each time.
--
-- @see admin-panel/src/lib/validations/custom-checkout-fields.ts

ALTER TABLE public.products
  ADD COLUMN custom_checkout_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.payment_transactions
  ADD COLUMN custom_field_values JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Per-product playback options for preview_video_url on the checkout/product
-- page. Shape: { autoplay?, loop?, muted?, controls?, saved_position?: bool }.
-- Validated by admin-panel/src/lib/validations/product.ts and applied by
-- buildPlayerstackRenderConfig() in admin-panel/src/lib/playerstack.ts.
ALTER TABLE public.products
  ADD COLUMN preview_video_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.products
  ADD CONSTRAINT preview_video_config_is_object
  CHECK (jsonb_typeof(preview_video_config) = 'object');

COMMENT ON COLUMN public.products.custom_checkout_fields IS
  'Array of {id,type,label,required,max_length,placeholder?} definitions. Shape validated at API layer (lib/validations/custom-checkout-fields.ts).';
COMMENT ON COLUMN public.payment_transactions.custom_field_values IS
  'Map of field_id → buyer-typed string. Validated against the buying product''s custom_checkout_fields before insert.';

-- public.* SELECT * views freeze their column list at create time; refresh
-- so PostgREST + standalone-mode clients see the new columns (same gotcha
-- hit in 20260515080046_add_checkout_template_to_products).



