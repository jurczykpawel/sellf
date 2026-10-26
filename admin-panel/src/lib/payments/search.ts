/** Shared payment-list and CSV search semantics.
 * @see src/app/api/v1/payments/route.ts
 * @see src/app/api/v1/payments/export/route.ts
 */
import { quoteForPostgrestOr } from '@/lib/api/filters';
import { escapeIlikePattern } from '@/lib/validations/product';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

export const VALID_PAYMENT_STATUSES = ['pending', 'completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned', 'awaiting_payment', 'cancelled'];

export async function buildPaymentSearchFilter(supabase: SupabaseClient, search: string): Promise<{ filter: string; error: null } | { filter: null; error: PostgrestError }> {
  const pattern = quoteForPostgrestOr(`%${escapeIlikePattern(search)}%`);
  const { data, error } = await supabase.from('products').select('id')
    .or(`name.ilike.${pattern},slug.ilike.${pattern}`).limit(500);
  if (error) return { filter: null, error };
  const clauses = ['customer_email', 'session_id', 'stripe_payment_intent_id'].map(field => `${field}.ilike.${pattern}`);
  if (data?.length) clauses.push(`product_id.in.(${data.map(product => product.id).join(',')})`);
  return { filter: clauses.join(','), error: null };
}
