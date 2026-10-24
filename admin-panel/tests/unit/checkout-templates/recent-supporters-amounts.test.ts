import { describe, expect, it, vi } from 'vitest';
import { getRecentSupporters } from '@/lib/checkout-templates/recent-supporters';
import { formatPrice } from '@/lib/constants';

const { rows } = vi.hoisted(() => ({ rows: [
  { id: 'pln-7', amount: 700, currency: 'PLN' },
  { id: 'pln-5', amount: 500, currency: 'PLN' },
  { id: 'jpy', amount: 1000, currency: 'JPY' },
] }));

vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        single: async () => ({ data: { id: 'product', icon: '☕' } }),
        limit: async () => ({ data: rows }),
        then: (resolve: (value: unknown) => unknown) => resolve({ count: rows.length }),
      };
      return query;
    },
  }),
}));

describe('recent supporter display amounts', () => {
  it.each([
    ['PLN', 0, 7],
    ['PLN', 1, 5],
    ['JPY', 2, 1000],
  ] as const)('returns %s entry %i in display units', async (currency, index, expected) => {
    const result = await getRecentSupporters('coffee');
    const supporter = result!.supporters[index];
    expect(supporter.amount).toBe(expected);
    expect(formatPrice(supporter.amount, supporter.currency, 'pl'))
      .toBe(formatPrice(expected, currency, 'pl'));
    expect(result!.totalCount).toBe(3);
  });
});
