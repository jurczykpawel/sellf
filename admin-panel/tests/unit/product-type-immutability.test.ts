/**
  * product_type cannot change after a product has any sales/access/sub.
 *
 * Tests the pure helper that the PATCH /api/v1/products/[id] route uses to
 * decide whether to allow a product_type change.
 */

import { describe, it, expect } from 'vitest';
import { hasProductBeenSold } from '@/lib/validations/product-type-guard';

function fakeSupabase(counts: {
  payment_transactions?: number;
  user_product_access?: number;
  subscriptions?: number;
}) {
  return {
    from(table: 'payment_transactions' | 'user_product_access' | 'subscriptions') {
      const value = counts[table] ?? 0;
      return {
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: Array.from({ length: value }, (_, i) => ({ id: `row-${i}` })),
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

describe('hasProductBeenSold', () => {
  it('returns false when no sales/access/subs exist', async () => {
    const supabase = fakeSupabase({});
    expect(await hasProductBeenSold(supabase as never, 'prod-1')).toBe(false);
  });

  it('returns true when a payment_transactions row exists', async () => {
    const supabase = fakeSupabase({ payment_transactions: 1 });
    expect(await hasProductBeenSold(supabase as never, 'prod-1')).toBe(true);
  });

  it('returns true when a user_product_access row exists', async () => {
    const supabase = fakeSupabase({ user_product_access: 1 });
    expect(await hasProductBeenSold(supabase as never, 'prod-1')).toBe(true);
  });

  it('returns true when a subscriptions row exists (even one_time → subscription flip)', async () => {
    const supabase = fakeSupabase({ subscriptions: 1 });
    expect(await hasProductBeenSold(supabase as never, 'prod-1')).toBe(true);
  });
});
