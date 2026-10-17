/** Real bounded offer loader against two stale cache replicas and failed invalidation. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadPublicOffer } from '@/lib/storefront-templates/offer-public';
import { DEFAULT_OFFER } from '@/lib/storefront-templates/offer';
import { PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
const m = vi.hoisted(() => ({ entries: new Map<string, unknown>(), replica: 'a', published: null as unknown, product: {} as Record<string, unknown>, allowed: true }));
vi.mock('next/cache', () => ({ unstable_cache: (read: () => unknown, key: string[]) => async () => { const id = m.replica + key.join(); if (!m.entries.has(id)) m.entries.set(id, await read()); return m.entries.get(id); } }));
vi.mock('@/lib/redis/cache', () => ({ cacheGet: async () => null, cacheSet: async () => {} }));
vi.mock('@/lib/license/public-snapshot', () => ({ checkPublicFeature: () => m.allowed }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => ({ select: (columns: string) => { expect(columns).not.toMatch(/draft|history|content_config|customer/); return { eq: () => ({ maybeSingle: async () => table === 'products' ? { data: m.product, error: null } : { data: { published: m.published }, error: null } }) }; } }) }) }));
vi.mock('@/lib/storefront-templates/catalogue', () => ({ loadStorefrontBindings: async () => ({ success: true, data: { hero: Date.now() < Number(m.product.boundary) ? { ...PUBLIC_FIXTURE.products[0], slug: 'course', availability: 'available', actions: { details: '/en/p/course', buy: '/en/checkout/course' } } : null } }) }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); m.entries.clear(); m.allowed = true; m.published = { ...DEFAULT_OFFER, enabled: true }; m.product = { id: PUBLIC_FIXTURE.products[0].id, slug: 'course', name: 'Course', is_active: true, is_listed: true, boundary: Infinity }; });
afterEach(() => vi.useRealTimers());
it('refreshes edits and opt-out at the absolute 60s deadline on both replicas', async () => {
  for (const replica of ['a', 'b']) { m.replica = replica; expect(await loadPublicOffer('en', 'course')).not.toBeNull(); }
  m.published = null; vi.advanceTimersByTime(59999);
  for (const replica of ['a', 'b']) { m.replica = replica; expect(await loadPublicOffer('en', 'course')).not.toBeNull(); }
  vi.advanceTimersByTime(1);
  for (const replica of ['a', 'b']) { m.replica = replica; expect(await loadPublicOffer('en', 'course')).toBeNull(); }
  expect(JSON.stringify([...m.entries.values()])).not.toMatch(/draft|content_config|customer|cookie/);
});
it('removes purchasing at a scheduled boundary despite warm offer caches', async () => {
  m.product.boundary = 105000; m.product.available_until = new Date(105000).toISOString();
  for (const replica of ['a', 'b']) { m.replica = replica; expect((await loadPublicOffer('en', 'course'))?.model.sections[0].props).toMatchObject({ product: { availability: 'available' } }); }
  vi.advanceTimersByTime(5000);
  for (const replica of ['a', 'b']) { m.replica = replica; const result = await loadPublicOffer('en', 'course'); expect(result?.model.sections[0].props).toMatchObject({ product: null }); }
});
