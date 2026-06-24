/**
 * BEHAVIORAL tests for the one-time Stripe webhook handlers.
 *
 * These drive the REAL exported `POST` of src/app/api/webhooks/stripe/route.ts against the
 * REAL local Supabase stack (real RPC `process_stripe_payment_completion_with_bump`, real
 * issueLicense, real buildPurchaseWebhookPayload, real captureAndPersistOrderTax) — only the
 * outermost boundary is mocked:
 *   - next/headers           → supply the stripe-signature header
 *   - next/cache             → revalidateTag/revalidatePath are no-ops outside a request scope
 *   - @/lib/stripe/server    → verifyWebhookSignature returns the parsed body; getStripeServer
 *                              returns a per-test Stripe shim (line items / session / tax)
 *   - @/lib/rate-limiting    → checkRateLimit toggle (so the 429 branch is deterministic)
 *   - @/lib/tracking         → trackServerSideConversion is a no-op (no real FB CAPI call)
 *   - WebhookService.trigger → spied per test (assert purchase.completed dispatch; no real send)
 *
 * This is the behavioral counterpart to the source-string guard in
 * tests/unit/services/capture-wiring.test.ts, and the regression net for a future extraction
 * of handleCheckoutSessionCompleted / handlePaymentIntentSucceeded out of route.ts. It mirrors
 * the DB+shim pattern established in tests/unit/subscription-handlers.integration.test.ts.
 *
 * Run: bun run test:unit -- tests/unit/webhooks/onetime-payment-handlers.behavioral.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

// ----- hoisted mutable holder (vi.mock factories run before module init) ----------------------
const h = vi.hoisted(() => ({
  // Stripe shim returned by getStripeServer(); set per test.
  stripe: null as unknown as Stripe,
  // stripe-signature header value; null = header absent.
  signature: 'test_sig' as string | null,
  // checkRateLimit return.
  rateLimitAllowed: true,
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (k: string) => (k === 'stripe-signature' ? h.signature : null),
  })),
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
  unstable_noStore: vi.fn(),
}));

vi.mock('@/lib/stripe/server', () => ({
  verifyWebhookSignature: vi.fn(async (body: string) => JSON.parse(body)),
  getStripeServer: vi.fn(async () => h.stripe),
}));

vi.mock('@/lib/rate-limiting', async (orig) => {
  const actual = await orig<typeof import('@/lib/rate-limiting')>();
  return { ...actual, checkRateLimit: vi.fn(async () => h.rateLimitAllowed) };
});

vi.mock('@/lib/tracking', async (orig) => {
  const actual = await orig<typeof import('@/lib/tracking')>();
  return { ...actual, trackServerSideConversion: vi.fn(async () => {}) };
});

import { POST } from '@/app/api/webhooks/stripe/route';
import { verifyWebhookSignature } from '@/lib/stripe/server';
import { WebhookService } from '@/lib/services/webhook-service';

// ----- env / DB -------------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const hasSupabase = !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
const db = hasSupabase ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

// ----- cleanup tracking -----------------------------------------------------------------------
const createdProductIds: string[] = [];
const createdEmails: string[] = [];
const createdAuthUserIds: string[] = [];

beforeAll(() => {
  if (!hasSupabase) {
    console.warn('[onetime-payment-handlers.behavioral] Skipping — requires Supabase env');
  }
});

afterAll(async () => {
  if (!db) return;
  if (createdEmails.length > 0) {
    await db.from('guest_purchases').delete().in('customer_email', createdEmails);
  }
  if (createdProductIds.length > 0) {
    await db.from('payment_line_items').delete().in('product_id', createdProductIds);
    await db.from('user_product_access').delete().in('product_id', createdProductIds);
    await db.from('payment_transactions').delete().in('product_id', createdProductIds);
    await db.from('order_bumps').delete().in('main_product_id', createdProductIds);
    await db.from('products').delete().in('id', createdProductIds);
  }
  for (const id of createdAuthUserIds) {
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
});

let triggerSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.signature = 'test_sig';
  h.rateLimitAllowed = true;
  h.stripe = makeStripeShim();
  vi.mocked(verifyWebhookSignature).mockImplementation(async (body: string) => JSON.parse(body));
  // Spy outbound dispatch: assert purchase.completed wiring without real delivery.
  triggerSpy = vi.spyOn(WebhookService, 'trigger').mockImplementation(async () => {});
});
afterEach(() => {
  triggerSpy.mockRestore();
});

// ----- helpers --------------------------------------------------------------------------------
let SEQ = 0;
function uniq(prefix: string): string {
  SEQ += 1;
  return `${prefix}_${Date.now()}_${SEQ}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Stripe shim. The capture path re-reads tax off the Checkout Session (NOT the event),
 * so `session` here controls net_total/tax_total; `sessionsByPI` feeds both the
 * amount_subtotal lookup and the PI→session resolution inside capture.
 */
function makeStripeShim(opts: {
  lineItems?: unknown[];
  session?: Record<string, unknown> | null;
  sessionsByPI?: Array<Record<string, unknown>>;
  /** Make checkout.sessions.list reject — exercises the PI amount_subtotal fail-safe. */
  listThrows?: boolean;
} = {}): Stripe {
  const session =
    opts.session ?? {
      id: 'cs_shim',
      amount_total: 1230,
      amount_subtotal: 1000,
      currency: 'usd',
      total_details: { amount_tax: 230 },
      automatic_tax: { enabled: false },
    };
  return {
    checkout: {
      sessions: {
        listLineItems: vi.fn(async () => ({ data: opts.lineItems ?? [] })),
        retrieve: vi.fn(async () => session),
        list: vi.fn(async () => {
          if (opts.listThrows) throw new Error('stripe sessions.list failed');
          return { data: opts.sessionsByPI ?? [] };
        }),
      },
    },
  } as unknown as Stripe;
}

async function createProduct(over: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const slug = uniq('p');
  const { data, error } = await db!
    .from('products')
    .insert({ slug, name: 'Behavioral Test Product', price: 10, currency: 'usd', is_active: true, ...over })
    .select('id, slug')
    .single();
  if (error || !data) throw new Error(`createProduct failed: ${error?.message}`);
  createdProductIds.push(data.id);
  return data;
}

async function seedPendingTx(args: {
  sessionId: string;
  productId: string;
  email: string;
  amountCents?: number;
  pi?: string | null;
  userId?: string | null;
  status?: 'pending' | 'completed';
}): Promise<string> {
  const { data, error } = await db!
    .from('payment_transactions')
    .insert({
      session_id: args.sessionId,
      product_id: args.productId,
      customer_email: args.email,
      amount: args.amountCents ?? 1000,
      currency: 'usd',
      stripe_payment_intent_id: args.pi ?? null,
      user_id: args.userId ?? null,
      status: args.status ?? 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedPendingTx failed: ${error?.message}`);
  return data.id;
}

async function createAuthUser(email: string): Promise<string> {
  const { data, error } = await db!.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data?.user) throw new Error(`createAuthUser failed: ${error?.message}`);
  createdAuthUserIds.push(data.user.id);
  return data.user.id;
}

/** Create a bump product + the order_bumps link required by the completion RPC. */
async function createBump(mainProductId: string): Promise<{ id: string; slug: string }> {
  const bump = await createProduct({ price: 0 });
  const { error } = await db!.from('order_bumps').insert({
    main_product_id: mainProductId,
    bump_product_id: bump.id,
    bump_title: 'Test Bump',
    bump_price: 0,
    is_active: true,
  });
  if (error) throw new Error(`createBump link failed: ${error.message}`);
  return bump;
}

async function hasAccess(userId: string, productId: string): Promise<boolean> {
  const { data } = await db!
    .from('user_product_access')
    .select('id')
    .eq('user_id', userId)
    .eq('product_id', productId);
  return (data ?? []).length > 0;
}

/** A Stripe line item shaped for the bump-recovery path (price.product.metadata). */
function bumpLineItem(productId: string) {
  return { price: { product: { metadata: { is_bump: 'true', product_id: productId } } } };
}

function checkoutEvent(session: Record<string, unknown>, type = 'checkout.session.completed') {
  return { id: uniq('evt'), type, data: { object: session } };
}
function piEvent(paymentIntent: Record<string, unknown>) {
  return { id: uniq('evt'), type: 'payment_intent.succeeded', data: { object: paymentIntent } };
}

async function post(event: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const body = JSON.stringify(event);
  const req = new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body });
  const res = await POST(req as never);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function fetchTx(sessionId: string) {
  const { data } = await db!
    .from('payment_transactions')
    .select('id, status, stripe_payment_intent_id, net_total, tax_total, tax_snapshot_status')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data;
}

// ==============================================================================================
describe.skipIf(!hasSupabase)('Stripe webhook — POST routing & gates', () => {
  it('missing stripe-signature → 400 Missing signature', async () => {
    h.signature = null;
    const { status, json } = await post(checkoutEvent({ id: uniq('cs'), mode: 'payment', payment_status: 'paid' }));
    expect(status).toBe(400);
    expect(json.error).toBe('Missing signature');
  });

  it('invalid signature (verify throws) → 400 Invalid signature', async () => {
    vi.mocked(verifyWebhookSignature).mockRejectedValueOnce(new Error('bad sig'));
    const { status, json } = await post(checkoutEvent({ id: uniq('cs'), mode: 'payment', payment_status: 'paid' }));
    expect(status).toBe(400);
    expect(json.error).toBe('Invalid signature');
  });

  it('rate limit exceeded → 429', async () => {
    h.rateLimitAllowed = false;
    const { status } = await post(checkoutEvent({ id: uniq('cs'), mode: 'payment', payment_status: 'paid' }));
    expect(status).toBe(429);
  });

  it('unhandled event type → 200 received', async () => {
    const { status, json } = await post({ id: uniq('evt'), type: 'customer.created', data: { object: {} } });
    expect(status).toBe(200);
    expect(json.received).toBe(true);
  });

  it('checkout.session.completed with payment_status≠paid → 200, no completion', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const email = uniq('buyer') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email });

    const { status, json } = await post(
      checkoutEvent({
        id: cs,
        mode: 'payment',
        payment_status: 'unpaid',
        metadata: { product_id: product.id },
        customer_details: { email },
      }),
    );
    expect(status).toBe(200);
    expect(json.received).toBe(true);
    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('pending'); // never completed
  });

  it('missing product_id → terminal → 200 skipped (not retried)', async () => {
    const email = uniq('buyer') + '@example.com';
    const { status, json } = await post(
      checkoutEvent({ id: uniq('cs'), mode: 'payment', payment_status: 'paid', customer_details: { email } }),
    );
    expect(status).toBe(200);
    expect(json.skipped).toBe('Missing product_id or customer_email in session');
  });

  it('non-terminal completion failure (unknown product) → 500 so Stripe retries', async () => {
    const email = uniq('buyer') + '@example.com';
    const { status } = await post(
      checkoutEvent({
        id: uniq('cs'),
        mode: 'payment',
        payment_status: 'paid',
        metadata: { product_id: '00000000-0000-0000-0000-000000000000' },
        customer_details: { email },
        amount_total: 1000,
        amount_subtotal: 1000,
        currency: 'usd',
      }),
    );
    expect(status).toBe(500);
  });
});

// ==============================================================================================
describe.skipIf(!hasSupabase)('checkout.session.completed — handler behavior', () => {
  it('subscription mode → processed, no one-time completion', async () => {
    const { status, json } = await post(
      checkoutEvent({ id: uniq('cs'), mode: 'subscription', payment_status: 'paid', metadata: { product_id: 'x' } }),
    );
    expect(status).toBe(200);
    expect(json.received).toBe(true);
  });

  it('HAPPY guest purchase: completes tx, books guest purchase, captures tax, dispatches purchase.completed', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });

    const { status, json } = await post(
      checkoutEvent({
        id: cs,
        mode: 'payment',
        payment_status: 'paid',
        metadata: { product_id: product.id },
        customer_details: { email },
        payment_intent: pi,
        amount_total: 1000,
        amount_subtotal: 1000,
        currency: 'usd',
      }),
    );

    expect(status).toBe(200);
    expect(json.received).toBe(true);

    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('completed');
    // Capture wiring: Stripe's session tax (net = amount_total − amount_tax) persisted.
    expect(tx?.net_total).toBe(1000);
    expect(tx?.tax_total).toBe(230);
    expect(tx?.tax_snapshot_status).not.toBe('unavailable');

    // Guest purchase booked.
    const { data: gp } = await db!.from('guest_purchases').select('id').eq('customer_email', email);
    expect((gp ?? []).length).toBeGreaterThan(0);

    // Outbound purchase.completed dispatched exactly once for this product.
    const calls = triggerSpy.mock.calls.filter(([evt]) => evt === 'purchase.completed');
    expect(calls).toHaveLength(1);
    const payload = calls[0]?.[1] as { product?: { id?: string }; order?: { netTotal?: number; taxTotal?: number } };
    expect(payload?.product?.id).toBe(product.id);
    // taxSnapshot threaded INTO the outbound payload (not only persisted on the tx row).
    expect(payload?.order?.netTotal).toBe(1000);
    expect(payload?.order?.taxTotal).toBe(230);
  });

  it('HAPPY registered user: grants user_product_access', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });

    const { status } = await post(
      checkoutEvent({
        id: cs,
        mode: 'payment',
        payment_status: 'paid',
        metadata: { product_id: product.id, user_id: userId },
        customer_details: { email },
        payment_intent: pi,
        amount_total: 1000,
        amount_subtotal: 1000,
        currency: 'usd',
      }),
    );
    expect(status).toBe(200);

    const { data: access } = await db!
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', product.id);
    expect((access ?? []).length).toBeGreaterThan(0);

    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('completed');
  });

  it('idempotent replay (tx already completed): 200, no duplicate webhook', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, status: 'completed' });
    // Realistic completed GUEST purchase also carries an (unclaimed) guest_purchases row. A Stripe
    // redelivery of checkout.session.completed must NOT fire a second purchase.completed — idempotency
    // here is defense-in-depth (the handler's completed-row early-return AND the RPC's already_had_access
    // gate both enforce it). This asserts that user-facing invariant end-to-end.
    await db!.from('guest_purchases').insert({
      customer_email: email,
      product_id: product.id,
      session_id: cs,
      transaction_amount: 10,
    });

    const { status, json } = await post(
      checkoutEvent({
        id: cs,
        mode: 'payment',
        payment_status: 'paid',
        metadata: { product_id: product.id },
        customer_details: { email },
        payment_intent: pi,
        amount_total: 1000,
        amount_subtotal: 1000,
        currency: 'usd',
      }),
    );
    expect(status).toBe(200);
    expect(String(json.received ?? json.skipped ?? '')).toBeTruthy();

    // No purchase.completed on a replay of an already-completed row.
    const calls = triggerSpy.mock.calls.filter(([evt]) => evt === 'purchase.completed');
    expect(calls).toHaveLength(0);
  });

  it('attaches PaymentIntent id to a pending row that lacked one', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi: null });

    await post(
      checkoutEvent({
        id: cs,
        mode: 'payment',
        payment_status: 'paid',
        metadata: { product_id: product.id },
        customer_details: { email },
        payment_intent: pi,
        amount_total: 1000,
        amount_subtotal: 1000,
        currency: 'usd',
      }),
    );

    const tx = await fetchTx(cs);
    expect(tx?.stripe_payment_intent_id).toBe(pi);
    expect(tx?.status).toBe('completed');
  });

  it('async_payment_succeeded alias runs the same completion path', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });

    const { status } = await post(
      checkoutEvent(
        {
          id: cs,
          mode: 'payment',
          payment_status: 'paid',
          metadata: { product_id: product.id },
          customer_details: { email },
          payment_intent: pi,
          amount_total: 1000,
          amount_subtotal: 1000,
          currency: 'usd',
        },
        'checkout.session.async_payment_succeeded',
      ),
    );
    expect(status).toBe(200);
    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('completed');
  });
});

// ==============================================================================================
describe.skipIf(!hasSupabase)('payment_intent.succeeded — handler behavior', () => {
  it('missing product_id/email → terminal → 200 skipped', async () => {
    const { status, json } = await post(piEvent({ id: uniq('pi'), amount: 1000, currency: 'usd', metadata: {} }));
    expect(status).toBe(200);
    expect(json.skipped).toBe('Missing product_id or email in payment intent');
  });

  it('HAPPY: completes tx by PI, captures tax (PI→session resolution), dispatches purchase.completed', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });

    // PI flow resolves the owning session (for amount_subtotal AND capture) via sessions.list.
    h.stripe = makeStripeShim({
      sessionsByPI: [{ id: cs, amount_subtotal: 1000 }],
      session: {
        id: cs,
        amount_total: 1230,
        amount_subtotal: 1000,
        currency: 'usd',
        total_details: { amount_tax: 230 },
        automatic_tax: { enabled: false },
      },
    });

    const { status } = await post(
      piEvent({
        id: pi,
        amount: 1000,
        currency: 'usd',
        receipt_email: email,
        metadata: { product_id: product.id },
      }),
    );
    expect(status).toBe(200);

    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('completed');
    expect(tx?.net_total).toBe(1000);
    expect(tx?.tax_total).toBe(230);

    const calls = triggerSpy.mock.calls.filter(([evt]) => evt === 'purchase.completed');
    expect(calls).toHaveLength(1);
  });

  it('idempotent by PI id (already completed): 200, no duplicate webhook', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, status: 'completed' });

    const { status } = await post(
      piEvent({ id: pi, amount: 1000, currency: 'usd', receipt_email: email, metadata: { product_id: product.id } }),
    );
    expect(status).toBe(200);
    const calls = triggerSpy.mock.calls.filter(([evt]) => evt === 'purchase.completed');
    expect(calls).toHaveLength(0);
  });

  it('idempotent by session_id fallback (PI id stored as session_id): 200, no duplicate webhook', async () => {
    const product = await createProduct();
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    // Direct-payment flow: row keyed by the PI id as session_id, no separate stripe_payment_intent_id.
    await seedPendingTx({ sessionId: pi, productId: product.id, email, pi: null, status: 'completed' });

    const { status } = await post(
      piEvent({ id: pi, amount: 1000, currency: 'usd', receipt_email: email, metadata: { product_id: product.id } }),
    );
    expect(status).toBe(200);
    const calls = triggerSpy.mock.calls.filter(([evt]) => evt === 'purchase.completed');
    expect(calls).toHaveLength(0);
  });

  it('RPC failure (unknown product) → 500 so Stripe retries', async () => {
    const email = uniq('guest') + '@example.com';
    const { status } = await post(
      piEvent({
        id: uniq('pi'),
        amount: 1000,
        currency: 'usd',
        receipt_email: email,
        metadata: { product_id: '00000000-0000-0000-0000-000000000000' },
      }),
    );
    expect(status).toBe(500);
  });

  it('comma-separated bump_product_ids → all bumps granted (registered)', async () => {
    const product = await createProduct();
    const b1 = await createBump(product.id);
    const b2 = await createBump(product.id);
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });
    h.stripe = makeStripeShim({ sessionsByPI: [{ id: cs, amount_subtotal: 1000 }] });

    const { status } = await post(
      piEvent({
        id: pi,
        amount: 1000,
        currency: 'usd',
        receipt_email: email,
        metadata: { product_id: product.id, user_id: userId, bump_product_ids: `${b1.id},${b2.id}` },
      }),
    );
    expect(status).toBe(200);
    expect(await hasAccess(userId, b1.id)).toBe(true);
    expect(await hasAccess(userId, b2.id)).toBe(true);
  });

  it('truncated bump metadata recovered from pending-tx metadata → all bumps granted (registered)', async () => {
    const product = await createProduct();
    const b1 = await createBump(product.id);
    const b2 = await createBump(product.id);
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    const txId = await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });
    await db!.from('payment_transactions')
      .update({ metadata: { bump_product_ids_full: [b1.id, b2.id] } })
      .eq('id', txId);
    h.stripe = makeStripeShim({ sessionsByPI: [{ id: cs, amount_subtotal: 1000 }] });

    const { status } = await post(
      piEvent({
        id: pi,
        amount: 1000,
        currency: 'usd',
        receipt_email: email,
        metadata: { product_id: product.id, user_id: userId, bump_count: '2' },
      }),
    );
    expect(status).toBe(200);
    expect(await hasAccess(userId, b1.id)).toBe(true);
    expect(await hasAccess(userId, b2.id)).toBe(true);
  });

  it('amount_subtotal lookup failure is non-fatal: completion still succeeds (gross fallback)', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });
    // sessions.list throws (used for amount_subtotal); capture still resolves via the cs_ session_id.
    h.stripe = makeStripeShim({ listThrows: true });

    const { status } = await post(
      piEvent({ id: pi, amount: 1000, currency: 'usd', receipt_email: email, metadata: { product_id: product.id } }),
    );
    expect(status).toBe(200);
    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('completed');
    // capture used session_id (cs_) directly, so tax still lands despite the list() failure.
    expect(tx?.net_total).toBe(1000);
    expect(tx?.tax_total).toBe(230);
  });
});

// ==============================================================================================
describe.skipIf(!hasSupabase)('checkout.session.completed — order-bump metadata branches', () => {
  async function registeredBumpCase() {
    const product = await createProduct();
    const b1 = await createBump(product.id);
    const b2 = await createBump(product.id);
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    const txId = await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });
    return { product, b1, b2, cs, pi, email, userId, txId };
  }

  function bumpSession(c: { cs: string; product: { id: string }; userId: string; pi: string }, metaExtra: Record<string, string>) {
    return checkoutEvent({
      id: c.cs,
      mode: 'payment',
      payment_status: 'paid',
      metadata: { product_id: c.product.id, user_id: c.userId, ...metaExtra },
      customer_details: { email: '' }, // overwritten below by caller-provided email
      payment_intent: c.pi,
      amount_total: 1000,
      amount_subtotal: 1000,
      currency: 'usd',
    });
  }

  it('comma-separated bump_product_ids → all bumps granted', async () => {
    const c = await registeredBumpCase();
    const ev = bumpSession(c, { bump_product_ids: `${c.b1.id},${c.b2.id}` });
    (ev.data.object as { customer_details: { email: string } }).customer_details.email = c.email;

    const { status } = await post(ev);
    expect(status).toBe(200);
    expect(await hasAccess(c.userId, c.product.id)).toBe(true);
    expect(await hasAccess(c.userId, c.b1.id)).toBe(true);
    expect(await hasAccess(c.userId, c.b2.id)).toBe(true);
  });

  it('single-bump fallback (has_bump + bump_product_id) → bump granted', async () => {
    const c = await registeredBumpCase();
    const ev = bumpSession(c, { has_bump: 'true', bump_product_id: c.b1.id });
    (ev.data.object as { customer_details: { email: string } }).customer_details.email = c.email;

    const { status } = await post(ev);
    expect(status).toBe(200);
    expect(await hasAccess(c.userId, c.b1.id)).toBe(true);
  });

  it('truncated metadata recovered from Stripe line items → all bumps granted', async () => {
    const c = await registeredBumpCase();
    // bump_count says 2 but the id list is empty (Stripe metadata truncation).
    h.stripe = makeStripeShim({ lineItems: [bumpLineItem(c.b1.id), bumpLineItem(c.b2.id)] });
    const ev = bumpSession(c, { bump_count: '2' });
    (ev.data.object as { customer_details: { email: string } }).customer_details.email = c.email;

    const { status } = await post(ev);
    expect(status).toBe(200);
    expect(await hasAccess(c.userId, c.b1.id)).toBe(true);
    expect(await hasAccess(c.userId, c.b2.id)).toBe(true);
  });

  it('truncated metadata recovered from pending-tx metadata when Stripe recovery is insufficient', async () => {
    const c = await registeredBumpCase();
    // Persist the full id list on the pending row; Stripe line items return nothing usable.
    await db!.from('payment_transactions')
      .update({ metadata: { bump_product_ids_full: [c.b1.id, c.b2.id] } })
      .eq('id', c.txId);
    h.stripe = makeStripeShim({ lineItems: [] });
    const ev = bumpSession(c, { bump_count: '2' });
    (ev.data.object as { customer_details: { email: string } }).customer_details.email = c.email;

    const { status } = await post(ev);
    expect(status).toBe(200);
    expect(await hasAccess(c.userId, c.b1.id)).toBe(true);
    expect(await hasAccess(c.userId, c.b2.id)).toBe(true);
  });
});
