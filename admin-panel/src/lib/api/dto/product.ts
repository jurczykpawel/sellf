import { z } from 'zod';
import { leadSettingsSchema } from '@/lib/leads/config';
import { eventSessionsSchema, isEventCompatible } from '@/lib/events/schema';
import { checkoutProfileSchema } from '@/lib/checkout-modules/profile';

import { marketingFieldsSchema } from '@/lib/validations/product-marketing';
import { isRelativeOrHttpUrl } from '@/lib/validations/redirect';
import { MAX_LICENSE_DURATION_DAYS } from '@/lib/validations/product';
import { minimumChargeAmount } from '@/lib/currency/minor-units';

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
  event_mode: z.boolean().optional(),
  allow_repeat_purchase: z.boolean().optional(),
  sessions: eventSessionsSchema.optional(),
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
  is_bundle: z.boolean().optional(),
  icon: z.string().max(8).optional(),
  image_url: z.string().max(2048).nullable().optional(),
  thumbnail_url: z.string().max(2048).nullable().optional(),
  preview_video_url: z.string().max(2048).nullable().optional(),
  features: z.array(featureSection).max(20).nullable().optional(),
  marketing_fields: marketingFieldsSchema.optional(),
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
  checkout_profile: checkoutProfileSchema.nullable().optional().describe('Versioned checkout modules. Company lookup uses shop integrations; buyer.gus is no longer accepted.'),
  checkout_template: z.string().max(40).optional(),
  custom_checkout_fields: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  tip_icon: z.string().max(8).optional(),
  suggested_amounts: z.array(z.number().nonnegative()).max(20).optional(),
  min_amount: z.number().nonnegative().nullable().optional(),
  ...leadSettingsSchema.shape,
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
  vat_exempt: z.boolean().optional(),
  vat_exempt_note: z.string().max(500).nullable().optional(),
  // Post-purchase redirect (success page). Cross-origin destinations are
  // allowed by design (the seller's own store) — only the scheme is gated.
  success_redirect_url: z
    .string()
    .max(2048)
    .nullable()
    .optional()
    .refine((v) => v == null || v === '' || isRelativeOrHttpUrl(v), {
      message: 'success_redirect_url must be a relative path or an http(s) URL',
    }),
  pass_params_to_redirect: z.boolean().optional(),
  // License keys (signed JWT issued on purchase)
  issue_license_on_purchase: z.boolean().optional(),
  license_tier: z.string().max(80).nullable().optional(),
  license_duration_days: z.number().int().positive().max(MAX_LICENSE_DURATION_DAYS).nullable().optional(),
};

/** A paid price Stripe cannot charge must never be stored. 0 = free. */
function refineChargeablePrice(p: { price?: number; currency?: string }, ctx: z.RefinementCtx): void {
  if (p.price != null && p.price > 0 && p.price < minimumChargeAmount(p.currency ?? '')) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: `price must be 0 or at least ${minimumChargeAmount(p.currency ?? '')}` });
  }
}

export const ProductCreateDTO = z.object(baseShape).strip().refine(isEventCompatible, 'Invalid event product type').superRefine(refineChargeablePrice);
export const ProductUpdateDTO = z.object(baseShape).partial().strip().refine(isEventCompatible, 'Invalid event product type').superRefine(refineChargeablePrice);

export type ProductCreateInput = z.infer<typeof ProductCreateDTO>;
export type ProductUpdateInput = z.infer<typeof ProductUpdateDTO>;

export const ProductCategoriesSchema = z.array(z.string().uuid()).max(50).optional();
export const ProductTagsSchema = z.array(z.string().uuid()).max(50).optional();
export const BundleItemIdsSchema = z.array(z.string().uuid()).max(100).optional();

/** Relation fields accepted next to the product columns on POST/PATCH; stored in junction tables. */
export const ProductRelationsDTO = z.object({
  categories: ProductCategoriesSchema.describe('Category UUIDs (PATCH replaces the whole set)'),
  tags: ProductTagsSchema.describe('Tag UUIDs (PATCH replaces the whole set)'),
  bundleItemIds: BundleItemIdsSchema.describe('Component product UUIDs of a bundle (is_bundle: true)'),
});

const embeddedTerm = z.object({ id: z.uuid(), name: z.string(), slug: z.string() }).loose();

/** GET /api/v1/products/:id/deletion-impact (SQL product_deletion_impact). */
export const ProductDeletionImpactDTO = z.object({
  orders: z.number().int(), invoices: z.number().int(), licenses: z.number().int(), accesses: z.number().int(), subscriptions: z.number().int(),
  activeSubscriptions: z.number().int(), futureReservations: z.number().int(),
  affiliateRules: z.number().int(), affiliateCommissions: z.number().int(), bundles: z.number().int(),
  bundleReferences: z.array(z.object({ id: z.uuid(), name: z.string() })).describe('Bundles that block archiving and deletion'),
  hasHistory: z.boolean().describe('true: DELETE archives unless bundle membership blocks it'),
});

/** DELETE /api/v1/products/:id of a product with history: archived, not deleted (200). */
export const ProductArchivedDTO = z.object({ id: z.uuid(), status: z.literal('archived'), impact: ProductDeletionImpactDTO });

// ===== READ SCHEMA =====
// Responses describe what the database returns, not what the API accepts: SQL constraints and
// nullability (supabase/schema.snapshot.sql), not the stricter input validators above.
// tests/unit/lib/api/openapi-product-responses.test.ts ties every selected column to the snapshot.

const columns = (names: string, type: z.ZodType): Record<string, z.ZodType> => Object.fromEntries(names.split(/\s+/).map((name) => [name, type]));
const jsonObject = z.record(z.string(), z.unknown());
const productSession = z.object({
  id: z.uuid(), starts_at: z.string(), ends_at: z.string().nullable(), timezone: z.string(), title: z.string().nullable(), venue: z.string().nullable(),
  online_url: z.string().nullable(), extra_days: z.string().nullable(), capacity: z.number().int().nullable(), sales_open: z.boolean(), sort: z.number().int(),
  tiers: z.array(z.object({ id: z.uuid(), label: z.string().nullable(), price: z.number(), seats: z.number().int().nullable(), sale_ends_at: z.string().nullable(), sort: z.number().int() })),
});

/** Product as returned by /api/v1/products: the columns of PRODUCT_API_FIELDS as SQL stores them. */
export const ProductResponseDTO = z.object({
  id: z.uuid(),
  ...columns('event_mode allow_repeat_purchase is_active is_featured is_listed is_bundle is_refundable enable_waitlist allow_custom_price show_price_presets price_includes_vat vat_exempt omnibus_exempt pass_params_to_redirect lead_consent_required embed_enabled issue_license_on_purchase', z.boolean()),
  ...columns('name slug currency layout_template lead_consent_version lead_consent_text_pl lead_consent_text_en created_at updated_at', z.string()),
  ...columns('description long_description icon image_url thumbnail_url preview_video_url available_from available_until vat_exempt_note sale_price_until success_redirect_url license_tier', z.string().nullable()),
  ...columns('vat_rate custom_price_min sale_price recurring_price', z.number().nullable()),
  ...columns('auto_grant_duration_days refund_period_days sale_quantity_limit billing_interval_count trial_days license_duration_days', z.number().int().nullable()),
  ...columns('preview_video_config content_config marketing_fields', jsonObject),
  price: z.number().describe('Major currency units'),
  product_type: productType,
  content_delivery_type: z.enum(['content', 'redirect']),
  checkout_template: z.enum(['default', 'tip-jar', 'oto']),
  billing_interval: z.enum(['day', 'week', 'month', 'year']).nullable(),
  features: z.array(jsonObject).nullable(),
  custom_price_presets: z.array(z.number()).nullable(),
  checkout_profile: jsonObject.nullable(),
  custom_checkout_fields: z.array(jsonObject),
  archived_at: z.string().nullable().describe('Set when the product is archived (DELETE of a product with history)'),
  sessions: z.array(productSession).describe('Event sessions with their price tiers (empty unless event_mode)'),
  categories: z.array(embeddedTerm).optional().describe('Present with ?embed=categories'),
  tags: z.array(embeddedTerm).optional().describe('Present with ?embed=tags'),
  bundle_item_count: z.number().int().optional().describe('List rows: number of bundle components'),
  _warnings: z.array(z.string()).optional().describe('PATCH answered 207: relation writes that failed (the product itself was saved)'),
}).loose();

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
  // Legacy v1 inputs have no product columns; keep accepting them without persisting them.
  for (const field of ['custom_price_label', 'tip_icon', 'suggested_amounts', 'min_amount', 'metadata']) {
    delete parsed[field];
  }
  const normalised = normaliseSaleFields(normaliseEmptyDates(parsed));
  const withDefaults = context === 'create' ? applyCreateDefaults(normalised) : normalised;
  return normaliseSubscriptionFields(withDefaults, context);
}
