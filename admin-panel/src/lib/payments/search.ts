/** Shared payment-list and CSV search semantics.
 * @see src/app/api/v1/payments/route.ts
 * @see src/app/api/v1/payments/export/route.ts
 */
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export const VALID_PAYMENT_STATUSES = ['pending', 'completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned', 'awaiting_payment', 'cancelled'];

/** Order number typed as `1300` or `#1300`; null for anything else (or beyond bigint-safe range). */
export function parseOrderNumberQuery(search: string): number | null {
  const match = /^#?(\d{1,15})$/.exec(search.trim());
  return match ? Number(match[1]) : null;
}

/** Uses a POST body for literal text; the result remains filterable as a transaction table. */
export function paymentSearchQuery(supabase: SupabaseClient<Database>, search: string) {
  return search ? supabase.rpc('search_payment_transactions', { p_search: search }) : supabase.from('payment_transactions');
}
