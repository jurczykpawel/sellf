/**
 * Columns of `products` that anon and authenticated clients may read.
 *
 * MUST stay in sync with the column-level GRANT in
 * `supabase/migrations/20260924000000_access_scope_tightening.sql`.
 * Any `.from('products')` read through a non-service client (storefront pages,
 * checkout, buyer routes) may only select, filter or order by these columns.
 *
 * Excluded (service role only):
 *  - `content_config`: delivered content (download/embed/redirect URLs). Read
 *    with the admin client after the caller's access has been confirmed.
 *  - `stripe_product_id`, `embed_enabled`, `license_tier`: admin configuration
 *    no storefront path reads.
 *
 * Lives in its own module so the storefront read test can assert the exact
 * list against the live grant.
 */
export const PRODUCT_PUBLIC_COLUMNS = [
  'id',
  'name',
  'slug',
  'description',
  'long_description',
  'icon',
  'image_url',
  'thumbnail_url',
  'preview_video_url',
  'preview_video_config',
  'price',
  'currency',
  'vat_rate',
  'price_includes_vat',
  'vat_exempt',
  'vat_exempt_note',
  'features',
  'layout_template',
  'checkout_template',
  'custom_checkout_fields',
  'is_active',
  'is_featured',
  'is_listed',
  'is_bundle',
  'available_from',
  'available_until',
  'auto_grant_duration_days',
  'content_delivery_type',
  'success_redirect_url',
  'pass_params_to_redirect',
  'is_refundable',
  'refund_period_days',
  'enable_waitlist',
  'allow_custom_price',
  'custom_price_min',
  'show_price_presets',
  'custom_price_presets',
  'omnibus_exempt',
  'sale_price',
  'sale_price_until',
  'sale_quantity_limit',
  'sale_quantity_sold',
  'product_type',
  'billing_interval',
  'billing_interval_count',
  'recurring_price',
  'trial_days',
  'stripe_price_id',
  'seller_id',
  'issue_license_on_purchase',
  'license_duration_days',
  'created_at',
  'updated_at',
] as const

/** Comma-joined form for PostgREST `.select(...)`. */
export const PRODUCT_PUBLIC_COLUMNS_CSV = PRODUCT_PUBLIC_COLUMNS.join(',')
