/** Public catalogue adapters over caller-authorized service reads. @see supabase/tests/storefront-catalogue.sql */
import 'server-only';
import { createHash } from 'node:crypto';
import { cache } from 'react';
import { z } from 'zod';
import { boundedPublicRead } from '@/lib/public-cache';
import { formatPrice, STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';
import { formatRecurringProductPrice, getVatDisplay } from '@/lib/product-pricing-display';
import { getEffectiveUnitPrice, isSalePriceActive } from '@/lib/services/omnibus';
import { idSchema } from '@/lib/storefront-templates/schemas';
import { checkoutUrl, productUrl } from '@/lib/utils/product-urls';
import { marketingFieldsSchema, productFormatSchema } from '@/lib/validations/product-marketing';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductMarketingFields } from '@/lib/validations/product-marketing';
import type { Database } from '@/types/database';

export interface PublicPriceInfo {
  display: string; taxNote: string | null; omnibus: string | null;
  kind: 'free' | 'one-time' | 'subscription' | 'pwyw';
}
export interface PublicProductInfo {
  id: string; slug: string; title: string; price: PublicPriceInfo; marketing: ProductMarketingFields;
  image: { src: string; alt: string; width: number; height: number } | null;
  actions: { details: string; buy: string }; availability: 'available' | 'unavailable';
}
export interface PublicCategoryInfo { id: string; label: string; filterTarget: string }
export type CatalogueGroup = 'all' | 'featured' | 'free' | 'paid';
export interface CataloguePage { products: PublicProductInfo[]; nextCursor: string | null }
type ReadResult<T> = { success: true; data: T } | { success: false; error: 'INVALID' | 'UNAVAILABLE' };
const uuid = z.uuid().transform(value => value.toLowerCase());
const ids = (max: number) => z.array(uuid).max(max).refine(v => new Set(v).size === v.length);
const filtersSchema = z.strictObject({
  locale: z.enum(['en', 'pl']),
  search: z.string().transform(v => v.trim().normalize('NFC')).refine(v => Array.from(v).length <= 100 && !v.includes('\0')).default(''),
  categoryIds: ids(12).transform(v => v.sort()).default([]),
  priceKind: z.enum(['free', 'one-time', 'subscription', 'pwyw']).nullable().default(null),
  format: productFormatSchema.nullable().default(null),
  group: z.enum(['all', 'featured', 'free', 'paid']).default('all'),
  pageSize: z.union([z.literal(9), z.literal(12), z.literal(24)]).default(9),
  cursor: z.string().max(512).regex(/^[A-Za-z0-9_-]+$/).nullable().default(null),
});
const cursorSchema = z.strictObject({ v: z.literal(1), timestamp: z.iso.datetime({ offset: true }), id: uuid, digest: z.string().regex(/^[a-f0-9]{64}$/) });
const rowSchema = z.object({
  id: uuid, slug: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: z.string().refine(value => Array.from(value).length <= 255), created_at: z.iso.datetime({ offset: true }),
  price: z.number().nonnegative(), currency: z.string().length(3), product_type: z.enum(['one_time', 'subscription']),
  recurring_price: z.number().nullable(), billing_interval: z.enum(['day', 'week', 'month', 'year']).nullable(), billing_interval_count: z.number().nullable(),
  allow_custom_price: z.boolean(), custom_price_min: z.number().nullable(), sale_price: z.number().nullable(), sale_price_until: z.string().nullable(),
  sale_quantity_limit: z.number().nullable(), sale_quantity_sold: z.number().nullable(), marketing_fields: marketingFieldsSchema,
  image_url: z.string().nullable(), vat_rate: z.number().nullable(), vat_exempt: z.boolean(), vat_exempt_note: z.string().max(500).nullable(),
  price_includes_vat: z.boolean(), tax_mode: z.enum(['local', 'stripe_tax']), lowest_prior_price: z.number().nullable(),
});
type ProductRow = z.infer<typeof rowSchema>;
type Filters = z.infer<typeof filtersSchema>;

function digestFilters(filters: Filters): string {
  return createHash('sha256').update(JSON.stringify({ ...filters, cursor: null, sortVersion: 1 })).digest('hex');
}
function image(row: ProductRow): PublicProductInfo['image'] {
  if (!row.image_url || row.image_url.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(row.image_url)) return null;
  try {
    const url = new URL(row.image_url);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    // Dimensions describe the core 8:5 contain frame, not an asserted source-image size.
    return { src: url.href, alt: row.name, width: 800, height: 500 };
  } catch { return null; }
}
function projectProduct(row: ProductRow, locale: 'en' | 'pl'): PublicProductInfo {
  const messages = locale === 'pl' ? pl : en;
  const kind: PublicPriceInfo['kind'] = row.product_type === 'subscription' ? 'subscription' : row.allow_custom_price ? 'pwyw' : row.price === 0 ? 'free' : 'one-time';
  const amount = formatPrice(getEffectiveUnitPrice(row), row.currency, locale);
  const display = kind === 'free' ? messages.checkout.customPrice.freePreset
    : kind === 'subscription' ? formatRecurringProductPrice(row, locale) ?? formatPrice(row.recurring_price ?? 0, row.currency, locale)
    : kind === 'pwyw' ? messages.admin.products.pwywFromLabel.replace('{amount}', formatPrice(row.custom_price_min ?? STRIPE_MINIMUM_AMOUNT, row.currency, locale)) : amount;
  const vat = getVatDisplay({ taxMode: row.tax_mode, vatRate: row.vat_rate, vatExempt: row.vat_exempt, vatExemptNote: row.vat_exempt_note });
  const taxNote = kind === 'free' || vat.kind === 'none' ? null : vat.kind === 'exempt' ? [messages.checkout.vatExempt, vat.note].filter(Boolean).join(' — ')
    : row.price_includes_vat ? `${messages.checkout.includingVat} ${vat.rate}%` : `+ ${messages.checkout.vat} ${vat.rate}%`;
  const omnibus = kind === 'one-time' && row.lowest_prior_price !== null && isSalePriceActive(row.sale_price, row.sale_price_until, row.sale_quantity_limit, row.sale_quantity_sold)
    ? `${messages.checkout.lowestPriceLabel}: ${formatPrice(row.lowest_prior_price, row.currency, locale)}` : null;
  return { id: row.id, slug: row.slug, title: row.name, price: { display, taxNote, omnibus, kind }, marketing: row.marketing_fields,
    image: image(row), actions: { details: `/${locale}${productUrl(row.slug)}`, buy: `/${locale}${checkoutUrl(row.slug)}` }, availability: 'available' };
}

/** One indexed boundary aggregate per render, including products absent from the current page. */
const readCatalogueBoundary = cache(async (client: SupabaseClient<Database>): Promise<number> => {
  const { data, error } = await client.rpc('storefront_catalogue_boundary');
  if (error || (data !== null && (typeof data !== 'string' || !Number.isFinite(Date.parse(data))))) throw new Error('UNAVAILABLE');
  return data === null ? Infinity : Date.parse(data);
});

/** Neutral first pages alone have finite shared keys; interactions are limited at the API boundary. */
export async function loadCataloguePage(client: SupabaseClient<Database>, input: unknown): Promise<ReadResult<CataloguePage>> {
  const parsed = filtersSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'INVALID' };
  const filters = parsed.data;
  const digest = digestFilters(filters);
  let after: z.infer<typeof cursorSchema> | null = null;
  if (filters.cursor) {
    try {
      const raw = Buffer.from(filters.cursor, 'base64url');
      if (raw.toString('base64url') !== filters.cursor) return { success: false, error: 'INVALID' };
      after = cursorSchema.parse(JSON.parse(raw.toString('utf8')));
      if (after.digest !== digest) return { success: false, error: 'INVALID' };
    } catch { return { success: false, error: 'INVALID' }; }
  }
  const read = async () => {
    const queryFilters = { locale: filters.locale, search: filters.search, categoryIds: filters.categoryIds, priceKind: filters.priceKind, format: filters.format, group: filters.group, pageSize: filters.pageSize };
    const { data, error } = await client.rpc('storefront_catalogue_page', { filters: queryFilters, after_created: after?.timestamp, after_id: after?.id });
    if (error || !data) return null;
    const rows = z.array(rowSchema).max(filters.pageSize + 1).parse(data);
    const page = rows.slice(0, filters.pageSize);
    const last = page.at(-1);
    const nextCursor = rows.length > filters.pageSize && last ? Buffer.from(JSON.stringify({ v: 1, timestamp: last.created_at, id: last.id, digest })).toString('base64url') : null;
    return { products: page.map(row => projectProduct(row, filters.locale)), nextCursor };
  };
  try {
    const neutral = !filters.search && !filters.categoryIds.length && !filters.priceKind && !filters.format && !filters.cursor;
    if (!neutral) {
      const page = await read();
      return page ? { success: true, data: page } : { success: false, error: 'UNAVAILABLE' };
    }
    const entry = await boundedPublicRead(
      ['catalogue', '1', filters.locale, filters.group, String(filters.pageSize)], ['storefront-products'],
      async () => {
        const boundary = await readCatalogueBoundary(client);
        const page = await read();
        return page ? { page, boundary: Number.isFinite(boundary) ? boundary : null } : null;
      },
      { boundary: value => value.boundary ?? Infinity },
    );
    return entry ? { success: true, data: entry.page } : { success: false, error: 'UNAVAILABLE' };
  } catch { return { success: false, error: 'UNAVAILABLE' }; }
}

export async function loadCatalogueGroups(client: SupabaseClient<Database>, input: unknown, variant: unknown, cursors: Partial<Record<CatalogueGroup, string | null>> = {}): Promise<ReadResult<Partial<Record<CatalogueGroup, CataloguePage>>>> {
  const parsed = filtersSchema.omit({ group: true, cursor: true }).safeParse(input);
  if (!parsed.success || (variant !== 'detail-cards' && variant !== 'default-groups')) return { success: false, error: 'INVALID' };
  const groups: CatalogueGroup[] = variant === 'detail-cards' ? ['all'] : ['featured', 'free', 'paid'];
  if (Object.keys(cursors).some(key => !groups.includes(key as CatalogueGroup))) return { success: false, error: 'INVALID' };
  const pages = await Promise.all(groups.map(group => loadCataloguePage(client, { ...parsed.data, group, cursor: cursors[group] ?? null })));
  const failure = pages.find(page => !page.success);
  if (failure && !failure.success) return failure;
  return { success: true, data: Object.fromEntries(pages.map((page, i) => [groups[i], page.success ? page.data : null])) };
}

const bindingsSchema = z.strictObject({ locale: z.enum(['en', 'pl']), heroProduct: uuid.nullable().default(null), closingProduct: uuid.nullable().default(null), starterProducts: ids(3).default([]), taskCategories: ids(12).default([]), target: idSchema });
interface StorefrontBindings {
  hero: PublicProductInfo | null; closing: PublicProductInfo | null; starters: PublicProductInfo[]; categories: PublicCategoryInfo[];
}
export async function loadStorefrontBindings(client: SupabaseClient<Database>, input: unknown): Promise<ReadResult<StorefrontBindings>> {
  const parsed = bindingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'INVALID' };
  const b = parsed.data;
  const productIds = [...new Set([b.heroProduct, b.closingProduct, ...b.starterProducts].filter((id): id is string => id !== null))];
  try {
    const [products, categories] = await Promise.all([
      productIds.length ? client.rpc('storefront_catalogue_page', { filters: { pageSize: 9 }, product_ids: productIds }) : { data: [], error: null },
      b.taskCategories.length ? client.rpc('storefront_catalogue_categories', { category_ids: b.taskCategories }) : { data: [], error: null },
    ]);
    if (products.error || categories.error) return { success: false, error: 'UNAVAILABLE' };
    const rows = z.array(rowSchema).max(5).parse(products.data);
    const categoryRows = z.array(z.object({ id: uuid, name: z.string().refine(value => Array.from(value).length <= 100) })).max(12).parse(categories.data);
    const byId = new Map(rows.map(row => [row.id, projectProduct(row, b.locale)]));
    const byCategory = new Map(categoryRows.map(row => [row.id, row.name]));
    return { success: true, data: { hero: byId.get(b.heroProduct ?? '') ?? null, closing: byId.get(b.closingProduct ?? '') ?? null,
      starters: b.starterProducts.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
      categories: b.taskCategories.flatMap(id => byCategory.has(id) ? [{ id, label: byCategory.get(id)!, filterTarget: b.target }] : []) } };
  } catch { return { success: false, error: 'UNAVAILABLE' }; }
}
