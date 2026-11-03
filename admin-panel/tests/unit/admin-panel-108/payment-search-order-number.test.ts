/** Seller finds an order by its number (e.g. 1300 or #1300). @see src/lib/payments/search.ts */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPaymentSearchFilter, parseOrderNumberQuery } from '@/lib/payments/search';

const supabase = { from: () => ({ select: () => ({ or: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) } as unknown as SupabaseClient;

describe('order number search @J191', () => {
  it('parses plain and hash-prefixed numbers only @J191', () => {
    expect(parseOrderNumberQuery('1300')).toBe(1300);
    expect(parseOrderNumberQuery(' #1300 ')).toBe(1300);
    expect(parseOrderNumberQuery('1300abc')).toBeNull();
    expect(parseOrderNumberQuery('a@b.pl')).toBeNull();
    expect(parseOrderNumberQuery('99999999999999999999')).toBeNull();
  });
  it('adds an exact order_number clause for a numeric query', async () => {
    const { filter } = await buildPaymentSearchFilter(supabase, '#1300');
    expect(filter).toContain('order_number.eq.1300');
  });
  it('does not add the clause for a text query', async () => {
    const { filter } = await buildPaymentSearchFilter(supabase, 'jan@example.com');
    expect(filter).not.toContain('order_number');
  });
});
