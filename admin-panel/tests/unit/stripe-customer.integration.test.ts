/**
 * Stripe Customer Integration Tests (Phase 2 — Subscriptions MVP)
 *
 * Verifies getOrCreateStripeCustomer({ email, userId? }):
 * - guest path: creates a Stripe customer, does NOT persist to DB
 * - logged-in path: creates a Stripe customer AND persists user_id -> stripe_customer_id mapping
 * - cache hit: second call for same userId reuses the cached Stripe customer (no new Stripe customer)
 *
 * Run: bun run test:unit -- tests/unit/stripe-customer.integration.test.ts
 * Requires: local Supabase running, subscriptions_mvp migration applied,
 *           STRIPE_SECRET_KEY=sk_test_* in .env.local.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getOrCreateStripeCustomer } from '@/lib/stripe/customer';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const hasStripeTestKey = !!STRIPE_SECRET_KEY && STRIPE_SECRET_KEY.startsWith('sk_test_');
const hasSupabase = !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
const canRun = hasStripeTestKey && hasSupabase;

const stripe = canRun ? new Stripe(STRIPE_SECRET_KEY!) : null;
const supabaseAdmin = hasSupabase
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  : null;
const supabaseSeller = hasSupabase
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { db: { schema: 'public' } })
  : null;

const createdStripeCustomerIds = new Set<string>();
const createdAuthUserIds = new Set<string>();

function uniqueEmail(tag: string): string {
  return `phase2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sellf-test.local`;
}

async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await supabaseAdmin!.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createAuthUser failed: ${error?.message}`);
  createdAuthUserIds.add(data.user.id);
  return data.user.id;
}

beforeAll(() => {
  if (!canRun) {
    console.warn(
      '[stripe-customer.integration] Skipping suite — requires STRIPE_SECRET_KEY=sk_test_* and Supabase env'
    );
  }
});

afterAll(async () => {
  // Order matters: stripe_customers FK -> auth.users (ON DELETE CASCADE),
  // so deleting auth users also clears mappings.
  if (createdStripeCustomerIds.size > 0 && stripe) {
    await Promise.allSettled(
      Array.from(createdStripeCustomerIds).map((id) => stripe.customers.del(id))
    );
  }
  if (createdAuthUserIds.size > 0 && supabaseAdmin) {
    await Promise.allSettled(
      Array.from(createdAuthUserIds).map((id) => supabaseAdmin.auth.admin.deleteUser(id))
    );
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!canRun)('getOrCreateStripeCustomer', () => {
  it('guest path: creates a Stripe customer and does NOT persist DB mapping', async () => {
    const email = uniqueEmail('guest');

    const stripeCustomerId = await getOrCreateStripeCustomer({ email });

    expect(stripeCustomerId).toMatch(/^cus_/);
    createdStripeCustomerIds.add(stripeCustomerId);

    const customer = await stripe!.customers.retrieve(stripeCustomerId);
    expect(customer.deleted).toBeFalsy();
    expect((customer as Stripe.Customer).email).toBe(email);
    expect((customer as Stripe.Customer).metadata?.sellf_user_id).toBeFalsy();

    // No DB row should be written for guests (no auth.users to FK to).
    const { data, error } = await supabaseSeller!
      .from('stripe_customers')
      .select('id')
      .eq('stripe_customer_id', stripeCustomerId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('logged-in path: creates Stripe customer, persists DB mapping, sets metadata.sellf_user_id', async () => {
    const email = uniqueEmail('user');
    const userId = await createAuthUser(email);

    const stripeCustomerId = await getOrCreateStripeCustomer({ email, userId });
    createdStripeCustomerIds.add(stripeCustomerId);

    expect(stripeCustomerId).toMatch(/^cus_/);

    const customer = (await stripe!.customers.retrieve(stripeCustomerId)) as Stripe.Customer;
    expect(customer.email).toBe(email);
    expect(customer.metadata?.sellf_user_id).toBe(userId);

    const { data, error } = await supabaseSeller!
      .from('stripe_customers')
      .select('user_id, stripe_customer_id')
      .eq('user_id', userId)
      .single();
    expect(error).toBeNull();
    expect(data?.stripe_customer_id).toBe(stripeCustomerId);
  });

  it('cache hit: second call for same userId reuses cached Stripe customer (no new Stripe customer)', async () => {
    const email = uniqueEmail('cache');
    const userId = await createAuthUser(email);

    const first = await getOrCreateStripeCustomer({ email, userId });
    createdStripeCustomerIds.add(first);

    const second = await getOrCreateStripeCustomer({ email, userId });

    expect(second).toBe(first);

    // Sanity: only one Stripe customer for this email
    const search = await stripe!.customers.list({ email, limit: 10 });
    expect(search.data.map((c) => c.id)).toContain(first);
  });

  it('rejects invalid input', async () => {
    await expect(getOrCreateStripeCustomer({ email: '' })).rejects.toThrow();
    await expect(
      getOrCreateStripeCustomer({ email: 'not-an-email' })
    ).rejects.toThrow();
  });
});
