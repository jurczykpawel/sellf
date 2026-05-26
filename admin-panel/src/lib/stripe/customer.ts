/**
 * Stripe Customer resolver.
 *
 * Single source of truth for "give me the Stripe customer id for this email/user".
 * Resolution order, fastest-first:
 *   1. DB cache: public.stripe_customers (when userId is known)
 *   2. Stripe customer search by email (handles guests + customers migrated from one-time payments)
 *   3. Create a fresh Stripe customer
 * After resolution, the mapping is persisted to public.stripe_customers when userId is provided.
 *
 * Stripe Customer Search has eventual consistency (~few seconds). The DB cache covers the
 * deterministic path; Stripe search is the fallback for cold lookups.
 *
 * @see https://docs.stripe.com/api/customers/search
 * @see supabase/migrations/20260430142135_subscriptions_mvp.sql (stripe_customers table)
 */

import { getStripeServer } from '@/lib/stripe/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface GetOrCreateStripeCustomerInput {
  email: string;
  userId?: string;
}

/**
 * Email regex tightened to reject characters that Stripe Search Query
 * Language treats as metacharacters (`\`, `(`, `)`, `:`, `"`). The
 * value flows into a `email:"..."` query string built in this module;
 * keeping these characters out at the shape-validation layer means a
 * future regression cannot route them into the search call.
 */
export const EMAIL_REGEX = /^[^\s@\\():"]+@[^\s@\\():"]+(\.[^\s@\\():"]+)+$/;

/**
 * Escape a string for use inside a `email:"..."`-style Stripe search
 * query. Escapes backslash first (otherwise the escaped quote becomes
 * `\\"` not `\\\"` and the parser closes the string early), then
 * double-quote.
 *
 * @see https://docs.stripe.com/search
 */
export function escapeStripeSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function getOrCreateStripeCustomer(
  input: GetOrCreateStripeCustomerInput
): Promise<string> {
  const email = input.email?.trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new Error('getOrCreateStripeCustomer: valid email is required');
  }

  const stripe = await getStripeServer();
  const db = createAdminClient();

  // 1. DB cache (only meaningful for logged-in users)
  if (input.userId) {
    const { data, error } = await db
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', input.userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[getOrCreateStripeCustomer] DB lookup error:', error);
    }

    if (data?.stripe_customer_id) {
      return data.stripe_customer_id;
    }
  }

  // 2. Stripe customer search by email
  let stripeCustomerId: string | undefined;
  try {
    const search = await stripe.customers.search({
      query: `email:"${escapeStripeSearchValue(email)}"`,
      limit: 1,
    });
    stripeCustomerId = search.data[0]?.id;
  } catch (err) {
    console.warn('[getOrCreateStripeCustomer] Stripe customer search failed:', err);
  }

  // 3. Create if still not found, otherwise patch metadata when we have a userId.
  if (!stripeCustomerId) {
    const created = await stripe.customers.create({
      email,
      ...(input.userId && { metadata: { sellf_user_id: input.userId } }),
    });
    stripeCustomerId = created.id;
  } else if (input.userId) {
    try {
      await stripe.customers.update(stripeCustomerId, {
        metadata: { sellf_user_id: input.userId },
      });
    } catch (err) {
      console.warn('[getOrCreateStripeCustomer] Failed to patch metadata:', err);
    }
  }

  // 4. Persist DB mapping (logged-in users only — FK requires auth.users row)
  if (input.userId) {
    const { error } = await db
      .from('stripe_customers')
      .upsert(
        { user_id: input.userId, stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) {
      console.error('[getOrCreateStripeCustomer] DB upsert error:', error);
    }
  }

  return stripeCustomerId;
}
