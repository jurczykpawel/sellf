/** Bounded public catalogue reads. @see supabase/tests/storefront-catalogue.sql */
import { describe, expect, it, vi } from 'vitest';
import { loadCataloguePage, loadCatalogueGroups, loadStorefrontBindings } from '@/lib/storefront-templates/catalogue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

vi.mock('next/cache', () => ({ unstable_cache: (read: () => Promise<unknown>) => read }));

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const marketing = { format: 'course', sourceLocale: 'en', en: { result: null, tools: [], requirements: [] } };
function row(n = 1) {
  return { id: id(n), slug: `example-${n}`, name: 'Example', created_at: '2026-01-01T00:00:00.123456+00:00',
    price: 20, currency: 'USD', product_type: 'one_time', recurring_price: null, billing_interval: null,
    billing_interval_count: null, allow_custom_price: false, custom_price_min: null, sale_price: null,
    sale_price_until: null, sale_quantity_limit: null, sale_quantity_sold: 0, marketing_fields: marketing,
    image_url: 'https://example.com/product.png', vat_rate: 23, vat_exempt: false, vat_exempt_note: null,
    price_includes_vat: true, tax_mode: 'local', lowest_prior_price: null,
    content_config: 'PRIVATE_CONTENT', customer: 'PRIVATE_CUSTOMER', license_key: 'PRIVATE_KEY' };
}
function client(rows: unknown[] = [row()]) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
  return { rpc, db: { rpc: (name: string, ...args: unknown[]) => name === 'storefront_catalogue_boundary' ? Promise.resolve({ data: null, error: null }) : rpc(name, ...args) } as unknown as SupabaseClient<Database> };
}
const input = { locale: 'en', pageSize: 9 };

describe('storefront catalogue', () => {
  it('projects only public model fields and core URLs/media/prices', async () => {
    const c = client();
    const result = await loadCataloguePage(c.db, input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data.products[0]).sort()).toEqual(['actions', 'availability', 'id', 'image', 'marketing', 'price', 'slug', 'title']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(result.data.products[0]).toMatchObject({ title: 'Example', price: { display: '$20.00', kind: 'one-time' },
      actions: { details: '/en/p/example-1', buy: '/en/checkout/example-1' }, image: { width: 800, height: 500 } });
    expect(c.rpc).toHaveBeenCalledTimes(1);
    const longTitle = await loadCataloguePage(client([{ ...row(), name: '😀'.repeat(255) }]).db, input);
    expect(longTitle.success && longTitle.data.products[0].title).toBe('😀'.repeat(255));
  });
  it('uses limit+1 and retains microseconds in a filter-bound cursor', async () => {
    const c = client(Array.from({ length: 10 }, (_, n) => row(n + 1)));
    const first = await loadCataloguePage(c.db, input);
    if (!first.success) throw Error('page failed');
    expect(first.data.products).toHaveLength(9);
    expect(first.data.nextCursor!.length).toBeLessThanOrEqual(512);
    await loadCataloguePage(c.db, { ...input, cursor: first.data.nextCursor });
    expect(c.rpc.mock.calls[1][1]).toMatchObject({ after_created: row().created_at, after_id: id(9) });
    for (const change of [{ search: 'new' }, { locale: 'pl' }, { group: 'paid' }, { pageSize: 12 }, { format: 'ebook' }, { priceKind: 'free' }, { categoryIds: [id(2)] }]) {
      expect(await loadCataloguePage(c.db, { ...input, ...change, cursor: first.data.nextCursor })).toMatchObject({ success: false, error: 'INVALID' });
    }
    expect(c.rpc).toHaveBeenCalledTimes(2);
  });
  it('normalizes filters and rejects invalid requests before reading', async () => {
    const c = client([]);
    await loadCataloguePage(c.db, { ...input, search: '  e\u0301_%  ', categoryIds: [id(2), id(1)] });
    expect(c.rpc.mock.calls[0][1].filters).toMatchObject({ search: 'é_%', categoryIds: [id(1), id(2)] });
    for (const change of [{ search: 'a'.repeat(101) }, { categoryIds: [id(1), id(1)] }, { categoryIds: ['x'] }, { pageSize: 25 }, { group: 'x' }, { cursor: 'a'.repeat(513) }, { cursor: 'e30' }, { actor: id(1) }]) {
      expect(await loadCataloguePage(c.db, { ...input, ...change })).toMatchObject({ success: false, error: 'INVALID' });
    }
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
  it('keeps subscription/PWYW/free independent of editorial format and applies core sale/tax', async () => {
    const c = client([
      { ...row(1), product_type: 'subscription', recurring_price: 15, billing_interval: 'month', price: 0 },
      { ...row(2), allow_custom_price: true, custom_price_min: 3, price: 0 },
      { ...row(3), price: 0 },
      { ...row(4), sale_price: 10, lowest_prior_price: 18 },
    ]);
    const result = await loadCataloguePage(c.db, { ...input, locale: 'pl' });
    if (!result.success) throw Error('page failed');
    expect(result.data.products.map(p => p.price.kind)).toEqual(['subscription', 'pwyw', 'free', 'one-time']);
    expect(result.data.products[0].price.display).toBe('15,00 USD / mies.');
    expect(result.data.products[3].price).toMatchObject({ display: '10,00 USD', omnibus: expect.stringContaining('18,00 USD') });
    expect(result.data.products[0].actions.buy).toBe('/pl/checkout/example-1');
  });
  it('omits unsupported image URLs and returns errors without rows', async () => {
    const withCredentials = new URL('https://example.com/a');
    withCredentials.username = 'example';
    withCredentials.password = 'example';
    for (const image_url of ['javascript:example', '//example.com/a', withCredentials.href, 'data:image/png;base64,a']) {
      const result = await loadCataloguePage(client([{ ...row(), image_url }]).db, input);
      expect(result.success && result.data.products[0].image).toBe(null);
    }
    const c = client();
    c.rpc.mockRejectedValue(Error('PRIVATE_ERROR'));
    expect(await loadCataloguePage(c.db, input)).toEqual({ success: false, error: 'UNAVAILABLE' });
  });
  it('loads independent default groups with no per-card calls and exact variant shape', async () => {
    const c = client(Array.from({ length: 25 }, (_, n) => row(n + 1)));
    const result = await loadCatalogueGroups(c.db, { locale: 'en', pageSize: 24 }, 'default-groups');
    if (!result.success) throw Error('groups failed');
    expect(Object.keys(result.data)).toEqual(['featured', 'free', 'paid']);
    expect(Object.values(result.data).reduce((n, p) => n + p.products.length, 0)).toBe(72);
    expect(new Set(Object.values(result.data).map(p => p.nextCursor)).size).toBe(3);
    expect(c.rpc).toHaveBeenCalledTimes(3);
    expect(await loadCatalogueGroups(c.db, input, 'other')).toEqual({ success: false, error: 'INVALID' });
  });
  it('returns exact all-group shape and final/empty pages', async () => {
    const c = client([row()]);
    const result = await loadCatalogueGroups(c.db, input, 'detail-cards');
    expect(result.success && Object.keys(result.data)).toEqual(['all']);
    expect(result.success && result.data.all?.nextCursor).toBe(null);
    expect(await loadCataloguePage(client([]).db, input)).toEqual({ success: true, data: { products: [], nextCursor: null } });
    expect(await loadCatalogueGroups(c.db, input, 'detail-cards', { free: null })).toEqual({ success: false, error: 'INVALID' });
  });
  it('validates cursor version and fields and permits canonical equivalent filters', async () => {
    const c = client(Array.from({ length: 10 }, (_, n) => row(n + 1)));
    const result = await loadCataloguePage(c.db, { ...input, search: '  é  ', categoryIds: [id(2), id(1)] });
    if (!result.success || !result.data.nextCursor) throw Error('page failed');
    expect((await loadCataloguePage(c.db, { ...input, search: 'e\u0301', categoryIds: [id(1), id(2)], cursor: result.data.nextCursor })).success).toBe(true);
    const cursor = JSON.parse(Buffer.from(result.data.nextCursor, 'base64url').toString());
    for (const change of [{ v: 2 }, { timestamp: 'bad' }, { id: 'bad' }, { extra: true }, { digest: 'a'.repeat(64) }]) {
      expect(await loadCataloguePage(c.db, { ...input, cursor: Buffer.from(JSON.stringify({ ...cursor, ...change })).toString('base64url') })).toEqual({ success: false, error: 'INVALID' });
    }
    expect(c.rpc).toHaveBeenCalledTimes(2);
  });
  it('uses current core sale and VAT rules and handles zero recurring prices', async () => {
    const c = client([
      { ...row(1), sale_price: 5, sale_quantity_limit: 1, sale_quantity_sold: 1, lowest_prior_price: 20, vat_exempt: true, vat_exempt_note: 'Exemption basis' },
      { ...row(2), sale_price: 5, sale_price_until: '2000-01-01T00:00:00Z', lowest_prior_price: 20, tax_mode: 'stripe_tax' },
      { ...row(3), product_type: 'subscription', price: 0, recurring_price: 0, billing_interval: 'month' },
      { ...row(4), price_includes_vat: false },
    ]);
    const result = await loadCataloguePage(c.db, input);
    if (!result.success) throw Error('page failed');
    expect(result.data.products[0].price).toMatchObject({ display: '$20.00', omnibus: null, taxNote: 'VAT-exempt sale — Exemption basis' });
    expect(result.data.products[1].price).toMatchObject({ display: '$20.00', omnibus: null, taxNote: null });
    expect(result.data.products[2].price).toMatchObject({ display: '$0.00', kind: 'subscription' });
    expect(result.data.products[3].price.taxNote).toBe('+ VAT 23%');
  });
  it('fails closed on invalid rows, missing data and group failures', async () => {
    for (const data of [null, [row(), { ...row(2), slug: '../other' }], [row(), { ...row(2), marketing_fields: { ...marketing, extra: true } }]]) {
      expect(await loadCataloguePage(client(data as unknown[]).db, input)).toEqual({ success: false, error: 'UNAVAILABLE' });
    }
    const c = client();
    c.rpc.mockResolvedValue({ error: { message: 'PRIVATE_ERROR' }, data: null });
    expect(await loadCatalogueGroups(c.db, input, 'default-groups')).toEqual({ success: false, error: 'UNAVAILABLE' });
    expect(await loadStorefrontBindings(c.db, { locale: 'en', target: 'catalogue', starterProducts: [id(1), id(1)] })).toEqual({ success: false, error: 'INVALID' });
  });
  it('batches bindings, preserves starter order and omits missing products/categories', async () => {
    const c = client([row(1), row(2)]);
    c.rpc.mockResolvedValueOnce({ data: [row(1), row(2)], error: null })
      .mockResolvedValueOnce({ data: [{ id: id(3), name: 'Category' }], error: null });
    const result = await loadStorefrontBindings(c.db, { locale: 'en', heroProduct: id(1), closingProduct: id(9), starterProducts: [id(2), id(1)], taskCategories: [id(3), id(4)], target: 'catalogue' });
    if (!result.success) throw Error('bindings failed');
    expect(result.data.starters.map(p => p.id)).toEqual([id(2), id(1)]);
    expect(result.data.closing).toBe(null);
    expect(result.data.categories).toEqual([{ id: id(3), label: 'Category', filterTarget: 'catalogue' }]);
    expect(c.rpc).toHaveBeenCalledTimes(2);
  });
});
