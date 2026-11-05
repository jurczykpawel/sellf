/** Seller finds an order by its number (e.g. 1300 or #1300). @see src/lib/payments/search.ts */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { paymentSearchQuery, parseOrderNumberQuery } from '@/lib/payments/search';

const rpc = vi.fn();
const supabase = { rpc } as unknown as SupabaseClient;

describe('order number search @J191', () => {
  it('parses plain and hash-prefixed numbers only @J191', () => {
    expect(parseOrderNumberQuery('1300')).toBe(1300);
    expect(parseOrderNumberQuery(' #1300 ')).toBe(1300);
    expect(parseOrderNumberQuery('1300abc')).toBeNull();
    expect(parseOrderNumberQuery('a@b.pl')).toBeNull();
    expect(parseOrderNumberQuery('99999999999999999999')).toBeNull();
  });
  it('passes the exact order number to the search RPC', () => {
    paymentSearchQuery(supabase, '#1300');
    expect(rpc).toHaveBeenLastCalledWith('search_payment_transactions', { p_search: '#1300' });
  });
  it('passes literal text to the search RPC', () => {
    paymentSearchQuery(supabase, 'jan@example.com');
    expect(rpc).toHaveBeenLastCalledWith('search_payment_transactions', { p_search: 'jan@example.com' });
  });
});
