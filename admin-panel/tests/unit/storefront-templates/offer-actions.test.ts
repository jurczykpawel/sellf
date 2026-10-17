/** Batched opt-in details routing never changes checkout or accepts recipe URLs. */
import { expect, it, vi } from 'vitest';
import { resolveOfferDetails } from '@/lib/storefront-templates/offer-actions';
import { hasCoreProductActions } from '@/lib/storefront-templates/faq-closing';
import { PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
it.each(['en', 'pl'] as const)('resolves one bounded status batch after cached products in %s', async locale => {
  const products = PUBLIC_FIXTURE.products.slice(0, 3).map(p => ({ ...p, availability: 'available' as const, actions: { details: `/${locale}/p/${p.slug}`, buy: `/${locale}/checkout/${p.slug}` } }));
  const q = { select: vi.fn(), in: vi.fn(), eq: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [{ product_id: products[0].id }], error: null }) };
  for (const method of ['select', 'in', 'eq'] as const) q[method].mockReturnValue(q);
  const from = vi.fn(() => q);
  const result = await resolveOfferDetails({ from } as unknown as SupabaseClient<Database>, products, locale);
  expect(from).toHaveBeenCalledTimes(1); expect(q.select).toHaveBeenCalledWith('product_id'); expect(q.eq).toHaveBeenCalledWith('published->>enabled', 'true'); expect(q.limit).toHaveBeenCalledWith(3);
  expect(result[0].actions.details).toBe(`/${locale}/offer/${products[0].slug}`);
  expect(result[1].actions).toEqual(products[1].actions);
  expect(result.map(p => p.actions.buy)).toEqual(products.map(p => p.actions.buy));
  expect(result.every(p => hasCoreProductActions(p, locale))).toBe(true);
  expect(hasCoreProductActions({ ...result[0], actions: { ...result[0].actions, details: 'https://attacker.example' } }, locale)).toBe(false);
  expect(products[0].actions.details).toBe(`/${locale}/p/${products[0].slug}`);
});
it('falls back to current /p on unavailable status without leaking diagnostics', async () => {
  const products = [{ ...PUBLIC_FIXTURE.products[0], availability: 'available' as const }];
  expect(await resolveOfferDetails({ from: () => { throw Error('private'); } } as unknown as SupabaseClient<Database>, products, 'en')).toEqual(products);
});
it('accepts offer details in the catalogue wire while restricting buy to checkout', async () => {
  const { cataloguePageSchema } = await import('@/lib/storefront-templates/catalogue-section');
  const product = { ...PUBLIC_FIXTURE.products[0], availability: 'available', actions: { details: '/en/offer/example-1', buy: '/en/checkout/example-1' } };
  expect(cataloguePageSchema(9).safeParse({ products: [product], nextCursor: null }).success).toBe(true);
  expect(cataloguePageSchema(9).safeParse({ products: [{ ...product, actions: { ...product.actions, buy: '/en/offer/example-1' } }], nextCursor: null }).success).toBe(false);
});
