/**
 * Product input contract for the standalone MCP package.
 * @see admin-panel/src/lib/api/dto/product.ts
 * @see admin-panel/src/lib/validations/redirect.ts
 */
import { z } from 'zod';

function isRelativeOrHttpUrl(url: string): boolean {
  if (!url) return false;
  const normalized = url.replace(/\\/g, '/');
  return (normalized.startsWith('/') && !normalized.startsWith('//'))
    || normalized.startsWith('https://') || normalized.startsWith('http://');
}

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

const productShape = {
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
  embed_enabled: z.boolean().optional(),
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
  // Post-purchase destination on the seller's site or another content platform.
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
  license_duration_days: z.number().int().positive().nullable().optional(),
};


const moneyFields = new Set(['price', 'sale_price', 'recurring_price', 'custom_price_min', 'custom_price_presets']);
const descriptions: Record<string, string> = {
  long_description: 'Full product description (max 20000 characters); null clears it',
  image_url: 'Product image URL; null clears it',
  thumbnail_url: 'Product thumbnail URL; null clears it',
  product_type: 'One-time purchase or subscription; include product_type: subscription when updating subscription fields',
  billing_interval: 'Subscription billing interval; null clears it',
  billing_interval_count: 'Number of billing intervals (positive integer)',
  trial_days: 'Subscription trial duration in days (nonnegative integer)',
  features: 'Feature sections, each with a title and items',
  vat_rate: 'VAT percentage (23 means 23%); null uses the installation default',
  sale_quantity_limit: 'Sale quantity limit; null, empty string or zero clears it',
  price_includes_vat: 'Whether product prices include VAT',
  currency: 'ISO 4217 currency code (default: USD)',
  is_active: 'Whether product is published and available for purchase',
  available_from: 'ISO 8601 availability start; null or empty string clears it',
  available_until: 'ISO 8601 availability end; null or empty string clears it',
  sale_price_until: 'ISO 8601 sale end; null or empty string clears it',
  auto_grant_duration_days: 'Days of access granted (nonnegative integer); null means no expiry',
  success_redirect_url: 'Post-purchase relative path or http(s) URL; null or empty string clears it',
};

const describedShape = Object.fromEntries(Object.entries(productShape).map(([key, schema]) => [
  key,
  schema.describe(moneyFields.has(key)
    ? `${key}: major units; 49.99 means 49.99 in the product currency (each entry for arrays)`
    : descriptions[key] ?? key.replaceAll('_', ' ')),
])) as typeof productShape;

const relations = {
  categories: z.array(z.string().uuid()).max(50).optional().describe('Category IDs; replaces existing links on update'),
  tags: z.array(z.string().uuid()).max(50).optional().describe('Tag IDs; replaces existing links on update'),
  bundleItemIds: z.array(z.string().uuid()).max(100).optional().describe('Bundle component product IDs; replaces existing components on update'),
};

export const productCreateShape = {
  ...describedShape,
  ...relations,
  is_active: describedShape.is_active.default(false).describe('Defaults to false: keep a draft until explicitly published'),
};
const partialShape = z.object(describedShape).partial().shape;
export const productUpdateShape = {
  ...Object.fromEntries(Object.entries(partialShape).map(([key, schema]) => [
    key, schema.describe(describedShape[key as keyof typeof describedShape].description ?? key),
  ])) as typeof partialShape,
  ...relations,
};
