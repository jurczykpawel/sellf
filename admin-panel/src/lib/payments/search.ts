/** Shared payment-list and CSV search semantics.
 * @see src/app/api/v1/payments/route.ts
 * @see src/app/api/v1/payments/export/route.ts
 */
import { quoteForPostgrestOr } from '@/lib/api/filters';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

export const VALID_PAYMENT_STATUSES = ['pending', 'completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned', 'awaiting_payment', 'cancelled'];

/** Order number typed as `1300` or `#1300`; null for anything else (or beyond bigint-safe range). */
export function parseOrderNumberQuery(search: string): number | null {
  const match = /^#?(\d{1,15})$/.exec(search.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Case-insensitive "contains" pattern for PostgREST `imatch` (Postgres `~*`).
 * ILIKE cannot be used: PostgREST rewrites every `*` in a like/ilike value to `%`
 * with no escape, so `*` searched as match-all (W146 B4). A fully escaped regular
 * expression matches the typed text literally, wildcards included.
 */
export function buildSearchPattern(search: string): string {
  return search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function buildPaymentSearchFilter(supabase: SupabaseClient, search: string): Promise<{ filter: string; error: null } | { filter: null; error: PostgrestError }> {
  const pattern = quoteForPostgrestOr(buildSearchPattern(search));
  const { data, error } = await supabase.from('products').select('id')
    .or(`name.imatch.${pattern},slug.imatch.${pattern}`).limit(500);
  if (error) return { filter: null, error };
  const clauses = ['customer_email', 'session_id', 'stripe_payment_intent_id'].map(field => `${field}.imatch.${pattern}`);
  const orderNumber = parseOrderNumberQuery(search);
  if (orderNumber !== null) clauses.push(`order_number.eq.${orderNumber}`);
  if (data?.length) clauses.push(`product_id.in.(${data.map(product => product.id).join(',')})`);
  return { filter: clauses.join(','), error: null };
}
