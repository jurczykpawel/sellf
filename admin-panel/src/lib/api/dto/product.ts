import { z } from 'zod';

const SLUG_RE = /^[a-z0-9-]+$/;

const isoDateOrEmpty = z
  .union([z.string().datetime({ offset: true }), z.literal(''), z.null()])
  .optional();

const contentDelivery = z.enum(['content', 'redirect', 'download']);
const productType = z.enum(['one_time', 'subscription']);

// Mirrors the { title, items } sections expected by validateFeatures and the product page
const featureSection = z.object({
  title: z.string().trim().min(1).max(200),
  items: z.array(z.string().max(500)),
});

const baseShape = {
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((s) => s.toLowerCase())
    .refine((s) => SLUG_RE.test(s), 'slug must be lowercase letters, digits, or hyphens'),
  description: z.string().trim().max(5000).optional(),
  long_description: z.string().max(20000).nullable().optional(),
  price: z.number().nonnegative().finite(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((s) => s.toUpperCase())
    .optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  is_listed: z.boolean().optional(),
  icon: z.string().max(8).optional(),
  image_url: z.string().max(2048).nullable().optional(),
  thumbnail_url: z.string().max(2048).nullable().optional(),
  preview_video_url: z.string().max(2048).nullable().optional(),
  features: z.array(featureSection).max(20).nullable().optional(),
  layout_template: z.string().max(40).nullable().optional(),
  content_delivery_type: contentDelivery.optional(),
  content_config: z.record(z.string(), z.unknown()).optional(),
  available_from: isoDateOrEmpty,
  available_until: isoDateOrEmpty,
  sale_price: z.number().nonnegative().nullable().optional(),
  sale_price_until: isoDateOrEmpty,
  sale_quantity_limit: z
    .union([z.number().int().nonnegative(), z.null(), z.literal('')])
    .optional(),
  product_type: productType.optional(),
  recurring_price: z.number().nonnegative().nullable().optional(),
  billing_interval: z.enum(['day', 'week', 'month', 'year']).nullable().optional(),
  billing_interval_count: z.number().int().positive().nullable().optional(),
  trial_days: z.number().int().nonnegative().nullable().optional(),
  auto_grant_duration_days: z.number().int().nonnegative().nullable().optional(),
  allow_custom_price: z.boolean().optional(),
  show_price_presets: z.boolean().optional(),
  custom_price_min: z.number().nonnegative().optional(),
  custom_price_presets: z.array(z.number().nonnegative()).max(20).optional(),
  custom_price_label: z.string().max(80).optional(),
  preview_video_config: z.record(z.string(), z.unknown()).nullable().optional(),
  checkout_template: z.string().max(40).optional(),
  custom_checkout_fields: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  tip_icon: z.string().max(8).optional(),
  suggested_amounts: z.array(z.number().nonnegative()).max(20).optional(),
  min_amount: z.number().nonnegative().nullable().optional(),
  embed_enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Refund settings
  is_refundable: z.boolean().optional(),
  refund_period_days: z.number().int().nonnegative().nullable().optional(),
  // Waitlist on inactive products
  enable_waitlist: z.boolean().optional(),
  // VAT / EU Omnibus
  vat_rate: z.number().nonnegative().nullable().optional(),
  price_includes_vat: z.boolean().optional(),
  omnibus_exempt: z.boolean().optional(),
  // Post-purchase redirect (success page)
  success_redirect_url: z.string().max(2048).nullable().optional(),
  pass_params_to_redirect: z.boolean().optional(),
  // License keys (signed JWT issued on purchase)
  issue_license_on_purchase: z.boolean().optional(),
  license_tier: z.string().max(80).nullable().optional(),
  license_duration_days: z.number().int().positive().nullable().optional(),
};

export const ProductCreateDTO = z.object(baseShape).strip();
export const ProductUpdateDTO = z.object(baseShape).partial().strip();

export type ProductCreateInput = z.infer<typeof ProductCreateDTO>;
export type ProductUpdateInput = z.infer<typeof ProductUpdateDTO>;

export const ProductCategoriesSchema = z.array(z.string().uuid()).max(50).optional();
export const ProductTagsSchema = z.array(z.string().uuid()).max(50).optional();

const DATE_FIELDS = ['available_from', 'available_until', 'sale_price_until'] as const;

function normaliseEmptyDates(row: Record<string, unknown>): Record<string, unknown> {
  for (const key of DATE_FIELDS) {
    if (row[key] === '') row[key] = null;
  }
  return row;
}

function normaliseSaleFields(row: Record<string, unknown>): Record<string, unknown> {
  if (row.sale_quantity_limit === '' || row.sale_quantity_limit === 0) {
    row.sale_quantity_limit = null;
  }
  if (row.sale_price === '' || row.sale_price === 0) {
    row.sale_price = null;
  }
  if (row.preview_video_config === null) {
    delete row.preview_video_config;
  }
  return row;
}

const CREATE_DEFAULTS: Record<string, unknown> = {
  currency: 'USD',
  description: '',
  product_type: 'one_time',
  icon: '📦',
  content_delivery_type: 'content',
  content_config: { content_items: [] },
  is_active: true,
  is_featured: false,
  allow_custom_price: false,
  show_price_presets: true,
};

function applyCreateDefaults(row: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(CREATE_DEFAULTS)) {
    if (row[key] === undefined) row[key] = value;
  }
  return row;
}

function normaliseSubscriptionFields(row: Record<string, unknown>, context: 'create' | 'update'): Record<string, unknown> {
  if (row.product_type !== 'subscription') {
    if (row.product_type !== undefined) row.product_type = 'one_time';
    if ('recurring_price' in row) row.recurring_price = null;
    if ('billing_interval' in row) row.billing_interval = null;
    if ('billing_interval_count' in row) row.billing_interval_count = null;
    if ('trial_days' in row) row.trial_days = null;
    return row;
  }

  if (row.billing_interval_count == null && context === 'create') {
    row.billing_interval_count = 1;
  }
  return row;
}

export function mapApiInputToProductRow(
  input: Record<string, unknown>,
  context: 'create' | 'update',
): Record<string, unknown> {
  const schema = context === 'create' ? ProductCreateDTO : ProductUpdateDTO;
  const parsed = schema.parse(input) as Record<string, unknown>;
  const normalised = normaliseSaleFields(normaliseEmptyDates(parsed));
  const withDefaults = context === 'create' ? applyCreateDefaults(normalised) : normalised;
  return normaliseSubscriptionFields(withDefaults, context);
}
