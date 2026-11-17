/** The public supporter list exists only for a tip jar the shop currently offers. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecentSupporters } from '@/lib/checkout-templates/recent-supporters';

const state = vi.hoisted(() => ({ product: {} as Record<string, unknown> }));
const TIP_JAR = { id: 'product', icon: '☕', is_active: true, archived_at: null, checkout_template: 'tip-jar', available_from: null, available_until: null };

vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        single: async () => ({ data: state.product, error: null }),
        limit: async () => ({ data: [{ id: 'tx-1', amount: 500, currency: 'PLN', metadata: { first_name: 'Anna' } }] }),
        then: (resolve: (value: unknown) => unknown) => resolve({ count: 1 }),
      };
      return query;
    },
  }),
}));

beforeEach(() => { state.product = { ...TIP_JAR }; });

describe('recent supporters visibility', () => {
  it('lists supporters of an active, offered tip jar', async () => {
    expect((await getRecentSupporters('coffee'))?.totalCount).toBe(1);
  });

  it.each([
    ['archived', { archived_at: '2026-11-01T00:00:00Z' }],
    ['inactive', { is_active: false }],
    ['not a tip jar', { checkout_template: null }],
    ['not yet offered', { available_from: '2999-01-01T00:00:00Z' }],
    ['no longer offered', { available_until: '2000-01-01T00:00:00Z' }],
  ])('treats the product as not found when it is %s', async (_label, over) => {
    state.product = { ...TIP_JAR, ...over };
    expect(await getRecentSupporters('coffee')).toBeNull();
  });
});
