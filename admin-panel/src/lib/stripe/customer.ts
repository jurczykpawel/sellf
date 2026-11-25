/**
 * Stripe Customer resolver.
 *
 * Single source of truth for "give me the Stripe customer id for this email/user".
 * Resolution order, fastest-first:
 *   1. Verify or replace the mapping in public.stripe_customers (when userId is known).
 *   2. With no mapping, search by email (handles guests + customers migrated from one-time payments).
 *      A match is reused only while no other account holds it — neither via
 *      metadata.sellf_user_id nor via a public.stripe_customers row.
 *   3. Create a fresh Stripe customer
 * After resolution, the mapping is persisted to public.stripe_customers when userId is provided.
 *
 * With a userId, `email` must be that account's own email — callers never pass a
 * form-typed address for a signed-in buyer.
 *
 * Stripe Customer Search has eventual consistency (~few seconds). The DB cache covers the
 * deterministic path; Stripe search is the fallback for cold lookups.
 *
 * @see https://docs.stripe.com/api/customers/search
 * @see supabase/migrations/20260430142135_subscriptions_mvp.sql (stripe_customers table)
 */

import { createHash } from 'node:crypto';
import { getStripeInstanceId, isForeignStripeMarker, readStripeInstanceMarker, STRIPE_INSTANCE_METADATA_KEY } from '@/lib/stripe/instance-marker';
import { getStripeServer } from '@/lib/stripe/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type Stripe from 'stripe';

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
/** RFC 5321 mailbox cap — also keeps the regex above (nested quantifiers) off unbounded input. */
export const MAX_EMAIL_LENGTH = 254;

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

async function isHeldByAnotherAccount(
  db: ReturnType<typeof createAdminClient>,
  customer: Stripe.Customer,
  userId: string | undefined
): Promise<boolean> {
  const metaOwner = customer.metadata?.sellf_user_id;
  if (metaOwner && metaOwner !== userId) return true;

  const { data, error } = await db
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', customer.id)
    .maybeSingle();
  if (error) {
    console.error('[getOrCreateStripeCustomer] mapping lookup error:', error);
    return true;
  }
  return !!data && data.user_id !== userId;
}

async function readCustomerMapping(db: ReturnType<typeof createAdminClient>, userId: string): Promise<string | null> {
  const { data, error } = await db.from('stripe_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Failed to read Stripe customer mapping', { cause: error });
  return data?.stripe_customer_id ?? null;
}

async function verifyMappedCustomer(stripe: Stripe, id: string, userId: string): Promise<boolean> {
  const customer = await stripe.customers.retrieve(id).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404
      && 'code' in error && error.code === 'resource_missing') return null;
    throw error;
  });
  if (!customer || customer.deleted || await isForeignStripeMarker(readStripeInstanceMarker(customer))) return false;
  const owner = customer.metadata?.sellf_user_id;
  return !owner || owner === userId;
}

export async function getOrCreateStripeCustomer(
  { email: rawEmail, userId }: GetOrCreateStripeCustomerInput,
  stripeClient?: Stripe,
): Promise<string> {
  const email = rawEmail?.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
    throw new Error('getOrCreateStripeCustomer: valid email is required');
  }

  const stripe = stripeClient ?? await getStripeServer();
  const db = createAdminClient();
  const mappedId = userId ? await readCustomerMapping(db, userId) : null;
  if (userId && mappedId && await verifyMappedCustomer(stripe, mappedId, userId)) return mappedId;

  let stripeCustomerId: string | undefined;
  if (!mappedId) {
    try {
      const search = await stripe.customers.search({
        query: `email:"${escapeStripeSearchValue(email)}"`,
        limit: 1,
      });
      const match = search.data[0];
      if (match && !await isForeignStripeMarker(readStripeInstanceMarker(match))
        && !await isHeldByAnotherAccount(db, match, userId)) {
        stripeCustomerId = match.id;
      }
    } catch (err) {
      console.warn('[getOrCreateStripeCustomer] Stripe customer search failed:', err);
    }
  }

  const instanceId = await getStripeInstanceId();
  const metadata = { [STRIPE_INSTANCE_METADATA_KEY]: instanceId, ...(userId && { sellf_user_id: userId }) };
  if (!stripeCustomerId) {
    const replacementKey = mappedId
      ? createHash('sha256').update(JSON.stringify([instanceId, userId, mappedId])).digest('hex')
      : null;
    const created = replacementKey
      ? await stripe.customers.create({ email, metadata }, { idempotencyKey: `sellf-customer-replacement:${replacementKey}` })
      : await stripe.customers.create({ email, metadata });
    stripeCustomerId = created.id;
  } else if (userId) {
    try {
      await stripe.customers.update(stripeCustomerId, { metadata });
    } catch (err) {
      console.warn('[getOrCreateStripeCustomer] Failed to patch metadata:', err);
    }
  }

  if (userId && mappedId) {
    const { data, error } = await db.from('stripe_customers')
      .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('stripe_customer_id', mappedId)
      .select('stripe_customer_id')
      .maybeSingle();
    if (error) throw new Error('Failed to replace Stripe customer mapping', { cause: error });
    if (data) return data.stripe_customer_id;

    const winner = await readCustomerMapping(db, userId);
    if (winner && await verifyMappedCustomer(stripe, winner, userId)) return winner;
    throw new Error('Stripe customer mapping changed during replacement');
  }

  if (userId) {
    const { error } = await db
      .from('stripe_customers')
      .upsert(
        { user_id: userId, stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) {
      console.error('[getOrCreateStripeCustomer] DB upsert error:', error);
    }
  }

  return stripeCustomerId;
}
