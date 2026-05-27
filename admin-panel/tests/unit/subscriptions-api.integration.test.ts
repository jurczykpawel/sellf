/**
 * Subscription self-service API tests (Phase 5)
 *
 * Verifies the customer-facing endpoints under /api/subscriptions:
 *   GET  /api/subscriptions               — list own subs (cross-leak check)
 *   POST /api/subscriptions/[id]/cancel   — IDOR check + ownership enforcement
 *   POST /api/subscriptions/[id]/resume   — IDOR check + idempotency
 *
 * Strategy: real Supabase + Stripe stub. We mock the auth context (createClient)
 * to control which user the handler thinks it's serving, and we mock the Stripe
 * client so we can assert the exact `subscriptions.update` call without hitting
 * Stripe's API every test.
 *
 * Requires: local Supabase running with subscriptions_mvp migration applied.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env vars for subscription API tests');
}

// Service-role client used by the test setup itself (creating users + rows).
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const sellerAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: 'public' },
});

// ---------------------------------------------------------------------------
// Mocks that make the route handlers runnable in vitest
// ---------------------------------------------------------------------------

type AuthState = { userId: string | null };
const authState: AuthState = { userId: null };

const stripeUpdates: Array<{ id: string; params: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase/server', async () => ({
  createClient: async () => ({
    auth: {
      getUser: async () =>
        authState.userId
          ? { data: { user: { id: authState.userId, email: 'mocked@x.test' } } }
          : { data: { user: null } },
    },
    from: (table: string) =>
      sellerAdmin.from(
        table as Parameters<typeof sellerAdmin.from>[0]
      ),
  }),
}));

vi.mock('@/lib/stripe/server', async () => ({
  getStripeServer: async () => ({
    subscriptions: {
      update: async (id: string, params: Record<string, unknown>) => {
        stripeUpdates.push({ id, params });
        return { id, ...params };
      },
    },
  }),
}));

// Always allow rate limit in tests (we cover the rejection path explicitly below).
let rateLimitAllow = true;
vi.mock('@/lib/rate-limiting', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limiting')>('@/lib/rate-limiting');
  return {
    ...actual,
    checkRateLimit: async () => rateLimitAllow,
  };
});

function csrfHeaders() {
  return { 'X-Requested-With': 'XMLHttpRequest' };
}

// Import handlers AFTER mocks are in place
const listRoute = await import('@/app/api/subscriptions/route');
const cancelRoute = await import('@/app/api/subscriptions/[id]/cancel/route');
const resumeRoute = await import('@/app/api/subscriptions/[id]/resume/route');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TS = Date.now();
const RAND = Math.random().toString(36).slice(2, 6);

const createdAuthUserIds: string[] = [];
const createdProductIds: string[] = [];
const createdSubIds: string[] = [];

let userA = '';
let userB = '';
let productId = '';
let subA = ''; // user A's subscription row id
let subB = ''; // user B's subscription row id

async function createUser(label: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: `${label}-${TS}-${RAND}@sellf-test.local`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdAuthUserIds.push(data.user.id);
  return data.user.id;
}

async function createSubscriptionRow(userId: string, stripeSubId: string): Promise<string> {
  const { data, error } = await sellerAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      product_id: productId,
      stripe_customer_id: `cus_${stripeSubId}`,
      stripe_subscription_id: stripeSubId,
      status: 'active',
      cancel_at_period_end: false,
      metadata: { product_id: productId },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`createSubscription failed: ${error?.message}`);
  createdSubIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  // Subscription product
  const { data: product, error: prodErr } = await sellerAdmin
    .from('products')
    .insert({
      name: 'API Test Sub',
      slug: `api-sub-${TS}-${RAND}`,
      price: 0,
      currency: 'PLN',
      product_type: 'subscription',
      billing_interval: 'month',
      billing_interval_count: 1,
      recurring_price: 49.0,
    })
    .select('id')
    .single();
  if (prodErr || !product) throw new Error(`product insert failed: ${prodErr?.message}`);
  productId = product.id;
  createdProductIds.push(productId);

  userA = await createUser('userA');
  userB = await createUser('userB');
  subA = await createSubscriptionRow(userA, `sub_a_${TS}_${RAND}`);
  subB = await createSubscriptionRow(userB, `sub_b_${TS}_${RAND}`);
});

afterAll(async () => {
  if (createdSubIds.length > 0) {
    await sellerAdmin.from('subscriptions').delete().in('id', createdSubIds);
  }
  if (createdProductIds.length > 0) {
    await sellerAdmin.from('products').delete().in('id', createdProductIds);
  }
  if (createdAuthUserIds.length > 0) {
    await Promise.allSettled(
      createdAuthUserIds.map((id) => supabaseAdmin.auth.admin.deleteUser(id))
    );
  }
});

function asResponse(res: unknown): { status: number; json: () => Promise<unknown> } {
  return res as { status: number; json: () => Promise<unknown> };
}

// ---------------------------------------------------------------------------
// GET /api/subscriptions
// ---------------------------------------------------------------------------

describe('GET /api/subscriptions', () => {
  it('rejects unauthenticated requests with 401', async () => {
    authState.userId = null;
    const res = asResponse(await listRoute.GET());
    expect(res.status).toBe(401);
  });

  it('returns only the calling user’s subscriptions', async () => {
    authState.userId = userA;
    const res = asResponse(await listRoute.GET());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscriptions: Array<{ id: string }> };
    const ids = body.subscriptions.map((s) => s.id);
    expect(ids).toContain(subA);
    expect(ids).not.toContain(subB);
  });

  it('user B sees only their own row, never user A’s', async () => {
    authState.userId = userB;
    const res = asResponse(await listRoute.GET());
    const body = (await res.json()) as { subscriptions: Array<{ id: string }> };
    const ids = body.subscriptions.map((s) => s.id);
    expect(ids).toEqual([subB]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/subscriptions/[id]/cancel
// ---------------------------------------------------------------------------

describe('POST /api/subscriptions/[id]/cancel', () => {
  const fakeReq = new Request('http://localhost/test', { method: 'POST', headers: csrfHeaders() });

  it('rejects requests missing X-Requested-With (CSRF guard)', async () => {
    stripeUpdates.length = 0;
    authState.userId = userA;
    const noCsrf = new Request('http://localhost/test', { method: 'POST' });
    const res = asResponse(
      await cancelRoute.POST(noCsrf, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(403);
    expect(stripeUpdates).toHaveLength(0);
  });

  it('returns 429 when rate-limited', async () => {
    stripeUpdates.length = 0;
    authState.userId = userA;
    rateLimitAllow = false;
    const res = asResponse(
      await cancelRoute.POST(fakeReq, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(429);
    expect(stripeUpdates).toHaveLength(0);
    rateLimitAllow = true;
  });

  it('rejects unauthenticated requests with 401', async () => {
    stripeUpdates.length = 0;
    authState.userId = null;
    const res = asResponse(
      await cancelRoute.POST(fakeReq, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(401);
    expect(stripeUpdates).toHaveLength(0);
  });

  it('IDOR: user B cannot cancel user A’s subscription', async () => {
    stripeUpdates.length = 0;
    authState.userId = userB;
    const res = asResponse(
      await cancelRoute.POST(fakeReq, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(404);
    expect(stripeUpdates).toHaveLength(0);
  });

  it('owner can cancel their own subscription and Stripe gets cancel_at_period_end=true', async () => {
    stripeUpdates.length = 0;
    authState.userId = userA;
    const res = asResponse(
      await cancelRoute.POST(fakeReq, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(200);
    expect(stripeUpdates).toHaveLength(1);
    expect(stripeUpdates[0].params).toEqual({ cancel_at_period_end: true });
  });

  it('returns 404 for non-existent subscription id', async () => {
    stripeUpdates.length = 0;
    authState.userId = userA;
    const res = asResponse(
      await cancelRoute.POST(fakeReq, {
        params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
      })
    );
    expect(res.status).toBe(404);
    expect(stripeUpdates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/subscriptions/[id]/resume
// ---------------------------------------------------------------------------

describe('POST /api/subscriptions/[id]/resume', () => {
  const fakeReq = new Request('http://localhost/test', { method: 'POST', headers: csrfHeaders() });

  it('rejects requests missing X-Requested-With (CSRF guard)', async () => {
    stripeUpdates.length = 0;
    authState.userId = userA;
    const noCsrf = new Request('http://localhost/test', { method: 'POST' });
    const res = asResponse(
      await resumeRoute.POST(noCsrf, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(403);
    expect(stripeUpdates).toHaveLength(0);
  });

  it('returns 429 when rate-limited', async () => {
    stripeUpdates.length = 0;
    authState.userId = userA;
    rateLimitAllow = false;
    const res = asResponse(
      await resumeRoute.POST(fakeReq, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(429);
    expect(stripeUpdates).toHaveLength(0);
    rateLimitAllow = true;
  });

  it('rejects unauthenticated requests with 401', async () => {
    stripeUpdates.length = 0;
    authState.userId = null;
    const res = asResponse(
      await resumeRoute.POST(fakeReq, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(401);
    expect(stripeUpdates).toHaveLength(0);
  });

  it('IDOR: user B cannot resume user A’s subscription', async () => {
    stripeUpdates.length = 0;
    authState.userId = userB;
    const res = asResponse(
      await resumeRoute.POST(fakeReq, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(404);
    expect(stripeUpdates).toHaveLength(0);
  });

  it('idempotent: resume on already-active sub returns 200 without Stripe call', async () => {
    stripeUpdates.length = 0;
    authState.userId = userB; // user B's sub is still cancel_at_period_end=false
    const res = asResponse(
      await resumeRoute.POST(fakeReq, { params: Promise.resolve({ id: subB }) })
    );
    expect(res.status).toBe(200);
    expect(stripeUpdates).toHaveLength(0);
  });

  it('owner can resume a scheduled-cancel subscription', async () => {
    // Mark user A's sub as scheduled to cancel (so resume has work to do).
    await sellerAdmin
      .from('subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('id', subA);

    stripeUpdates.length = 0;
    authState.userId = userA;
    const res = asResponse(
      await resumeRoute.POST(fakeReq, { params: Promise.resolve({ id: subA }) })
    );
    expect(res.status).toBe(200);
    expect(stripeUpdates).toHaveLength(1);
    expect(stripeUpdates[0].params).toEqual({ cancel_at_period_end: false });
  });
});
