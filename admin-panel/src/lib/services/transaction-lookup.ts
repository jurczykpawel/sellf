/**
 * Shared lookup for a payment_transactions row by a single Stripe-side order
 * id, matching either `stripe_payment_intent_id` or `session_id` — a direct
 * payment-intent flow stores the payment intent id as its `session_id`, so a
 * caller holding one verified id (from a Stripe event, or from a client that
 * already completed checkout) needs to try both columns.
 *
 * Two parameterized `.eq()` lookups instead of a single interpolated `.or()`
 * filter. Single source of truth for every Stripe webhook path that resolves
 * a transaction from an order id (refund, dispute).
 *
 * @see src/app/api/webhooks/stripe/route.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type AnySupabaseClient = SupabaseClient<any, any, any>;

export async function findTransactionByOrderId<T>(
  supabase: AnySupabaseClient,
  orderId: string,
  columns: string,
): Promise<T | null> {
  const { data: byIntent } = await supabase
    .from('payment_transactions')
    .select(columns)
    .eq('stripe_payment_intent_id', orderId)
    .maybeSingle();
  if (byIntent) return byIntent as T;

  const { data: bySession } = await supabase
    .from('payment_transactions')
    .select(columns)
    .eq('session_id', orderId)
    .maybeSingle();
  return (bySession as T) ?? null;
}
