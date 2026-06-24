/**
 * BEHAVIORAL tests for the SUCCESS-REDIRECT capture path: verifyPaymentSession / verifyPaymentIntent.
 *
 * This is the twin of tests/unit/webhooks/onetime-payment-handlers.behavioral.test.ts. Where the
 * webhook is the primary capture path, these two functions are the secondary one — invoked on the
 * client success redirect (/api/verify-payment) so access + tax snapshot land even if the webhook
 * is delayed. Both are EXPORTED, so we call them directly against the REAL local Supabase stack
 * (real RPC, real issueLicense-free completion, real captureAndPersistOrderTax, real payload
 * builder), mocking only the outermost boundary:
 *   - @/lib/stripe/server              → getStripeServer returns a per-test Stripe shim
 *   - @/lib/services/product-validation → validateEmail → true (disposable-domain check has own tests)
 *   - WebhookService.trigger            → spied per test (assert purchase.completed; no real send)
 *
 * Closes the last source-guard-only gap flagged in the coverage audit (verify-payment.ts wiring).
 *
 * Run: bun run test:unit -- tests/unit/payment/verify-payment-onetime.behavioral.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import type { User } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({ stripe: null as unknown as Stripe }));

vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn(async () => h.stripe),
  verifyWebhookSignature: vi.fn(),
}));

vi.mock('@/lib/services/product-validation', () => ({
  ProductValidationService: {
    validateEmail: vi.fn(async () => true),
    validateEmailFormat: () => true,
  },
}));

import { verifyPaymentSession, verifyPaymentIntent } from '@/lib/payment/verify-payment';
import { WebhookService } from '@/lib/services/webhook-service';
import { ProductValidationService } from '@/lib/services/product-validation';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const hasSupabase = !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
const db = hasSupabase ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

const createdProductIds: string[] = [];
const createdEmails: string[] = [];
const createdAuthUserIds: string[] = [];

beforeAll(() => {
  if (!hasSupabase) console.warn('[verify-payment-onetime.behavioral] Skipping — requires Supabase env');
});

afterAll(async () => {
  if (!db) return;
  if (createdEmails.length > 0) await db.from('guest_purchases').delete().in('customer_email', createdEmails);
  if (createdProductIds.length > 0) {
    await db.from('payment_line_items').delete().in('product_id', createdProductIds);
    await db.from('user_product_access').delete().in('product_id', createdProductIds);
    await db.from('payment_transactions').delete().in('product_id', createdProductIds);
    await db.from('order_bumps').delete().in('main_product_id', createdProductIds);
    await db.from('products').delete().in('id', createdProductIds);
  }
  for (const id of createdAuthUserIds) await db.auth.admin.deleteUser(id).catch(() => {});
});

let triggerSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  h.stripe = makeStripeShim();
  triggerSpy = vi.spyOn(WebhookService, 'trigger').mockImplementation(async () => {});
  // Reset the completion RPC's 100/hour counter — both the per-identifier row AND the shared
  // global anti-spoof bucket (global_process_stripe_payment_completion) — for deterministic
  // isolation (see the webhook twin suite). Without this, high-volume completion tests trip it.
  if (db) await db.from('rate_limits').delete().like('function_name', '%process_stripe_payment_completion');
});
afterEach(() => triggerSpy.mockRestore());

let SEQ = 0;
function uniq(p: string): string {
  SEQ += 1;
  return `${p}_${Date.now()}_${SEQ}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Stripe shim. `session` is returned by checkout.sessions.retrieve (used BOTH by the verify fn
 * and by capture), so it carries verify fields AND tax fields. Net = amount_total − amount_tax.
 */
function makeStripeShim(opts: {
  session?: Record<string, unknown> | null;
  paymentIntent?: Record<string, unknown> | null;
  sessionsByPI?: Array<Record<string, unknown>>;
  lineItems?: unknown[];
  listThrows?: boolean;
  lineItemsThrows?: boolean;
  /** checkout.sessions.retrieve throws: 'invalid' → StripeInvalidRequestError, 'other' → generic. */
  sessionRetrieveThrows?: 'invalid' | 'other';
  /** paymentIntents.retrieve throws. */
  piRetrieveThrows?: 'invalid' | 'other';
} = {}): Stripe {
  // 'session' in opts distinguishes an explicit null (→ Stripe "not found") from "not provided".
  const session = 'session' in opts ? opts.session : {
    id: 'cs_shim',
    status: 'complete',
    payment_status: 'paid',
    mode: 'payment',
    currency: 'usd',
    amount_total: 1000,
    amount_subtotal: 1000,
    total_details: { amount_tax: 230 }, // → net = 1000 − 230 = 770
    automatic_tax: { enabled: false },
    created: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  const throwStripe = (kind: 'invalid' | 'other') => {
    if (kind === 'invalid') throw { type: 'StripeInvalidRequestError', message: 'No such resource' };
    throw new Error('stripe boom');
  };
  return {
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => {
          if (opts.sessionRetrieveThrows) throwStripe(opts.sessionRetrieveThrows);
          return session;
        }),
        listLineItems: vi.fn(async () => {
          if (opts.lineItemsThrows) throw new Error('stripe listLineItems failed');
          return { data: opts.lineItems ?? [] };
        }),
        list: vi.fn(async () => {
          if (opts.listThrows) throw new Error('stripe sessions.list failed');
          return { data: opts.sessionsByPI ?? [] };
        }),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(async () => {
        if (opts.piRetrieveThrows) throwStripe(opts.piRetrieveThrows);
        return opts.paymentIntent;
      }),
    },
  } as unknown as Stripe;
}

async function createProduct(over: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const slug = uniq('p');
  const { data, error } = await db!
    .from('products')
    .insert({ slug, name: 'Verify Behavioral Product', price: 10, currency: 'usd', is_active: true, ...over })
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
      amount: 1000,
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

async function fetchTx(sessionId: string) {
  const { data } = await db!
    .from('payment_transactions')
    .select('id, status, net_total, tax_total, tax_snapshot_status')
    .eq('session_id', sessionId)
    .maybeSingle();
  return data;
}

function bumpLineItem(productId: string) {
  return { price: { product: { metadata: { is_bump: 'true', product_id: productId } } } };
}

function asUser(id: string, email: string): User {
  return { id, email } as User;
}

function purchaseCalls() {
  return triggerSpy.mock.calls.filter(([e]) => e === 'purchase.completed');
}

// ==============================================================================================
describe.skipIf(!hasSupabase)('verifyPaymentSession — success-redirect capture', () => {
  it('invalid session id → error', async () => {
    const r = await verifyPaymentSession('');
    expect(r.status).toBe('error');
    expect(r.error).toBe('Invalid session ID');
  });

  it('HAPPY guest: completes tx, captures tax, threads snapshot into payload, fires purchase.completed once', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });

    h.stripe = makeStripeShim({
      session: {
        id: cs, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd',
        amount_total: 1000, amount_subtotal: 1000, total_details: { amount_tax: 230 },
        automatic_tax: { enabled: false }, payment_intent: pi,
        customer_details: { email }, customer_email: email,
        metadata: { product_id: product.id }, created: 1, expires_at: 2,
      },
    });

    const r = await verifyPaymentSession(cs);
    expect(r.error).toBeUndefined();

    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('completed');
    expect(tx?.net_total).toBe(770); // 1000 − 230
    expect(tx?.tax_total).toBe(230);
    expect(tx?.tax_snapshot_status).not.toBe('unavailable');

    const calls = purchaseCalls();
    expect(calls).toHaveLength(1);
    const payload = calls[0]?.[1] as { product?: { id?: string }; order?: { netTotal?: number; taxTotal?: number } };
    expect(payload?.product?.id).toBe(product.id);
    expect(payload?.order?.netTotal).toBe(770);
    expect(payload?.order?.taxTotal).toBe(230);
  });

  it('HAPPY registered: grants user_product_access', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });

    h.stripe = makeStripeShim({
      session: {
        id: cs, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd',
        amount_total: 1000, amount_subtotal: 1000, total_details: { amount_tax: 230 },
        automatic_tax: { enabled: false }, payment_intent: pi,
        customer_details: { email }, customer_email: email,
        metadata: { product_id: product.id, user_id: userId }, created: 1, expires_at: 2,
      },
    });

    const r = await verifyPaymentSession(cs, asUser(userId, email));
    expect(r.error).toBeUndefined();
    expect(await hasAccess(userId, product.id)).toBe(true);
    expect((await fetchTx(cs))?.status).toBe('completed');
  });

  it('cached/idempotent (already completed): cache hit, no duplicate webhook', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId, status: 'completed' });
    await db!.from('user_product_access').insert({ user_id: userId, product_id: product.id });

    const r = await verifyPaymentSession(cs, asUser(userId, email));
    expect(r.status).toBe('complete');
    expect(r.access_granted).toBe(true);
    expect(purchaseCalls()).toHaveLength(0); // cache short-circuits before any webhook
  });

  it('missing product_id in session metadata → error, no completion', async () => {
    const cs = uniq('cs');
    const email = uniq('guest') + '@example.com';
    h.stripe = makeStripeShim({
      session: {
        id: cs, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd',
        amount_total: 1000, amount_subtotal: 1000, customer_details: { email }, customer_email: email,
        metadata: {}, created: 1, expires_at: 2,
      },
    });
    const r = await verifyPaymentSession(cs);
    expect(r.access_granted).toBe(false);
    expect(r.error).toMatch(/Product ID missing/);
  });

  it('RPC rejects (unknown product) → access not granted, error surfaced', async () => {
    const cs = uniq('cs');
    const email = uniq('guest') + '@example.com';
    h.stripe = makeStripeShim({
      session: {
        id: cs, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd',
        amount_total: 1000, amount_subtotal: 1000, customer_details: { email }, customer_email: email,
        metadata: { product_id: '00000000-0000-0000-0000-000000000000' }, created: 1, expires_at: 2,
      },
    });
    const r = await verifyPaymentSession(cs);
    expect(r.access_granted).toBe(false);
    expect(r.error).toBeTruthy();
    expect(purchaseCalls()).toHaveLength(0);
  });

  it('subscription mode (logged in) → access granted, scenario=subscription, no one-time RPC/webhook', async () => {
    const cs = uniq('cs');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    h.stripe = makeStripeShim({
      session: {
        id: cs, status: 'complete', payment_status: 'paid', mode: 'subscription', currency: 'usd',
        amount_total: 4900, customer_details: { email }, customer_email: email,
        metadata: { product_id: 'whatever', user_id: userId }, created: 1, expires_at: 2,
      },
    });
    const r = await verifyPaymentSession(cs, asUser(userId, email));
    expect(r.access_granted).toBe(true);
    expect(r.scenario).toBe('subscription');
    expect(purchaseCalls()).toHaveLength(0);
  });

  it('truncated bump metadata recovered from Stripe line items → bumps granted (registered)', async () => {
    const product = await createProduct();
    const b1 = await createBump(product.id);
    const b2 = await createBump(product.id);
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });

    h.stripe = makeStripeShim({
      session: {
        id: cs, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd',
        amount_total: 1000, amount_subtotal: 1000, total_details: { amount_tax: 0 },
        automatic_tax: { enabled: false }, payment_intent: pi,
        customer_details: { email }, customer_email: email,
        metadata: { product_id: product.id, user_id: userId, bump_count: '2' }, created: 1, expires_at: 2,
      },
      lineItems: [bumpLineItem(b1.id), bumpLineItem(b2.id)],
    });

    const r = await verifyPaymentSession(cs, asUser(userId, email));
    expect(r.error).toBeUndefined();
    expect(await hasAccess(userId, b1.id)).toBe(true);
    expect(await hasAccess(userId, b2.id)).toBe(true);
  });
});

// ==============================================================================================
describe.skipIf(!hasSupabase)('verifyPaymentIntent — success-redirect capture (direct PI flow)', () => {
  function piShim(cs: string, over: Record<string, unknown> = {}) {
    return makeStripeShim({
      paymentIntent: {
        id: over.id ?? 'pi_x',
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
        receipt_email: over.receipt_email,
        metadata: over.metadata ?? {},
        created: 1,
      },
      sessionsByPI: [{ id: cs, amount_subtotal: 1000 }],
      session: {
        id: cs, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd',
        amount_total: 1000, amount_subtotal: 1000, total_details: { amount_tax: 230 },
        automatic_tax: { enabled: false }, created: 1, expires_at: 2,
      },
      listThrows: over.listThrows as boolean | undefined,
    });
  }

  it('invalid payment intent id → error', async () => {
    const r = await verifyPaymentIntent('');
    expect(r.status).toBe('error');
    expect(r.error).toBe('Invalid payment intent ID');
  });

  it('HAPPY: completes tx, captures tax via PI→session, threads snapshot, fires purchase.completed once', async () => {
    const product = await createProduct();
    const cs = uniq('cs'); // tx.session_id is the cs_ id (capture resolves it from the PI)
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });

    h.stripe = piShim(cs, { id: pi, receipt_email: email, metadata: { product_id: product.id } });

    const r = await verifyPaymentIntent(pi, null);
    expect(r.error).toBeUndefined();

    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('completed');
    expect(tx?.net_total).toBe(770);
    expect(tx?.tax_total).toBe(230);

    const calls = purchaseCalls();
    expect(calls).toHaveLength(1);
    const payload = calls[0]?.[1] as { order?: { netTotal?: number; taxTotal?: number } };
    expect(payload?.order?.netTotal).toBe(770);
    expect(payload?.order?.taxTotal).toBe(230);
  });

  it('missing product_id/email → error', async () => {
    h.stripe = makeStripeShim({
      paymentIntent: { id: 'pi_missing', status: 'succeeded', amount: 1000, currency: 'usd', metadata: {} },
    });
    const r = await verifyPaymentIntent('pi_missing');
    expect(r.access_granted).toBe(false);
    expect(r.error).toMatch(/Product ID missing|Customer email missing/);
  });

  it('RPC rejects (unknown product) → access not granted, error surfaced', async () => {
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    h.stripe = piShim(cs, { id: pi, receipt_email: email, metadata: { product_id: '00000000-0000-0000-0000-000000000000' } });
    const r = await verifyPaymentIntent(pi, null);
    expect(r.access_granted).toBe(false);
    expect(r.error).toBeTruthy();
    expect(purchaseCalls()).toHaveLength(0);
  });

  it('amount_subtotal lookup failure is non-fatal: completion still succeeds, tax still lands via cs_', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('guest') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });

    // sessions.list throws (amount_subtotal lookup) — capture still resolves via the cs_ session_id.
    h.stripe = piShim(cs, { id: pi, receipt_email: email, metadata: { product_id: product.id }, listThrows: true });

    const r = await verifyPaymentIntent(pi, null);
    expect(r.error).toBeUndefined();
    const tx = await fetchTx(cs);
    expect(tx?.status).toBe('completed');
    expect(tx?.net_total).toBe(770);
    expect(tx?.tax_total).toBe(230);
  });

  it('truncated bump metadata recovered from pending-tx metadata → bumps granted (registered)', async () => {
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

    h.stripe = piShim(cs, { id: pi, receipt_email: email, metadata: { product_id: product.id, bump_count: '2' } });

    const r = await verifyPaymentIntent(pi, asUser(userId, email));
    expect(r.error).toBeUndefined();
    expect(await hasAccess(userId, b1.id)).toBe(true);
    expect(await hasAccess(userId, b2.id)).toBe(true);
  });
});

// ==============================================================================================
// Additional branch coverage: ownership/mismatch guards, email validation, subscription-guest,
// session-not-found, RPC thrown-error, bump-recovery catch, and the Stripe error tails.
describe.skipIf(!hasSupabase)('verify-payment — additional branch coverage', () => {
  function paidSession(cs: string, productId: string, email: string, over: Record<string, unknown> = {}) {
    return {
      id: cs, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd',
      amount_total: 1000, amount_subtotal: 1000, total_details: { amount_tax: 0 },
      automatic_tax: { enabled: false }, payment_intent: 'pi_x',
      customer_details: { email }, customer_email: email,
      metadata: { product_id: productId }, created: 1, expires_at: 2, ...over,
    };
  }

  it('session not found (Stripe returns null) → not_found', async () => {
    h.stripe = makeStripeShim({ session: null });
    const r = await verifyPaymentSession(uniq('cs'));
    expect(r.status).toBe('not_found');
    expect(r.error).toBe('Session not found');
  });

  it('session metadata.user_id ≠ caller → ownership rejected', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const email = uniq('a') + '@example.com';
    h.stripe = makeStripeShim({ session: paidSession(cs, product.id, email, { metadata: { product_id: product.id, user_id: 'someone-else' } }) });
    const r = await verifyPaymentSession(cs, asUser('current-user', email));
    expect(r.error).toBe('Session does not belong to current user');
  });

  it('session email ≠ caller email (no matching user_id) → ownership rejected', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    h.stripe = makeStripeShim({ session: paidSession(cs, product.id, 'seller-side@example.com') });
    const r = await verifyPaymentSession(cs, asUser('u1', 'different@example.com'));
    expect(r.error).toBe('Session does not belong to current user');
  });

  it('disposable/invalid email → email_validation_failed_server_side, no completion', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('temp') + '@example.com';
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });
    h.stripe = makeStripeShim({ session: paidSession(cs, product.id, email, { payment_intent: pi }) });
    vi.mocked(ProductValidationService.validateEmail).mockResolvedValueOnce(false);

    const r = await verifyPaymentSession(cs);
    expect(r.access_granted).toBe(false);
    expect(r.scenario).toBe('email_validation_failed_server_side');
    expect((await fetchTx(cs))?.status).toBe('pending'); // never completed
  });

  it('subscription mode as GUEST → magic-link scenario, no one-time completion', async () => {
    const cs = uniq('cs');
    const email = uniq('guest') + '@example.com';
    h.stripe = makeStripeShim({
      session: { id: cs, status: 'complete', payment_status: 'paid', mode: 'subscription', currency: 'usd',
        amount_total: 4900, customer_details: { email }, customer_email: email, metadata: {}, created: 1, expires_at: 2 },
    });
    const r = await verifyPaymentSession(cs); // no user
    expect(r.access_granted).toBe(false);
    expect(r.is_guest_purchase).toBe(true);
    expect(r.send_magic_link).toBe(true);
    expect(r.scenario).toBe('subscription_guest');
  });

  it('thrown RPC error (non-uuid product) → Failed to process payment', async () => {
    const cs = uniq('cs');
    const email = uniq('g') + '@example.com';
    h.stripe = makeStripeShim({ session: paidSession(cs, 'not-a-uuid', email) });
    const r = await verifyPaymentSession(cs);
    expect(r.access_granted).toBe(false);
    expect(r.error).toBe('Failed to process payment');
  });

  it('bump recovery: listLineItems throws → caught, completion proceeds (main only)', async () => {
    const product = await createProduct();
    const b1 = await createBump(product.id);
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });
    h.stripe = makeStripeShim({
      session: paidSession(cs, product.id, email, { payment_intent: pi, metadata: { product_id: product.id, user_id: userId, bump_count: '1' } }),
      lineItemsThrows: true,
    });

    const r = await verifyPaymentSession(cs, asUser(userId, email));
    expect(r.error).toBeUndefined();
    expect(await hasAccess(userId, product.id)).toBe(true);
    expect(await hasAccess(userId, b1.id)).toBe(false); // recovery failed → bump not granted, but main OK
  });

  it('cached path: completed tx owned by a DIFFERENT user → ownership rejected', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const email = uniq('owner') + '@example.com';
    createdEmails.push(email);
    const ownerId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi: uniq('pi'), userId: ownerId, status: 'completed' });

    const r = await verifyPaymentSession(cs, asUser('intruder-id', 'intruder@example.com'));
    expect(r.error).toBe('Session does not belong to current user');
  });

  it('Stripe StripeInvalidRequestError on retrieve → Invalid session ID', async () => {
    h.stripe = makeStripeShim({ sessionRetrieveThrows: 'invalid' });
    const r = await verifyPaymentSession(uniq('cs'));
    expect(r.status).toBe('invalid');
    expect(r.error).toBe('Invalid session ID');
  });

  it('generic Stripe error on retrieve → Payment verification failed', async () => {
    h.stripe = makeStripeShim({ sessionRetrieveThrows: 'other' });
    const r = await verifyPaymentSession(uniq('cs'));
    expect(r.status).toBe('error');
    expect(r.error).toBe('Payment verification failed');
  });

  // ---- verifyPaymentIntent tails ----
  it('PI not found (Stripe returns null) → not_found', async () => {
    h.stripe = makeStripeShim({ paymentIntent: null });
    const r = await verifyPaymentIntent('pi_none');
    expect(r.status).toBe('not_found');
    expect(r.error).toBe('Payment intent not found');
  });

  it('PI not succeeded → base response, no completion', async () => {
    h.stripe = makeStripeShim({ paymentIntent: { id: 'pi_proc', status: 'processing', amount: 1000, currency: 'usd', metadata: {} } });
    const r = await verifyPaymentIntent('pi_proc');
    expect(r.status).toBe('processing');
    expect(r.access_granted).toBeUndefined();
  });

  it('PI disposable/invalid email → email_validation_failed_server_side', async () => {
    const product = await createProduct();
    h.stripe = makeStripeShim({ paymentIntent: { id: 'pi_bad', status: 'succeeded', amount: 1000, currency: 'usd', receipt_email: 'temp@example.com', metadata: { product_id: product.id } } });
    vi.mocked(ProductValidationService.validateEmail).mockResolvedValueOnce(false);
    const r = await verifyPaymentIntent('pi_bad');
    expect(r.access_granted).toBe(false);
    expect(r.scenario).toBe('email_validation_failed_server_side');
  });

  it('PI thrown RPC error (non-uuid product) → Failed to process payment', async () => {
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('g') + '@example.com';
    h.stripe = makeStripeShim({
      paymentIntent: { id: pi, status: 'succeeded', amount: 1000, currency: 'usd', receipt_email: email, metadata: { product_id: 'not-a-uuid' } },
      sessionsByPI: [{ id: cs, amount_subtotal: 1000 }],
    });
    const r = await verifyPaymentIntent(pi, null);
    expect(r.access_granted).toBe(false);
    expect(r.error).toBe('Failed to process payment');
  });

  it('PI StripeInvalidRequestError on retrieve → Invalid payment intent ID', async () => {
    h.stripe = makeStripeShim({ piRetrieveThrows: 'invalid' });
    const r = await verifyPaymentIntent('pi_x');
    expect(r.status).toBe('invalid');
    expect(r.error).toBe('Invalid payment intent ID');
  });

  it('PI generic Stripe error on retrieve → verification failed', async () => {
    h.stripe = makeStripeShim({ piRetrieveThrows: 'other' });
    const r = await verifyPaymentIntent('pi_x');
    expect(r.status).toBe('error');
    expect(r.error).toBe('Payment intent verification failed');
  });

  it('session not complete/paid → base response, no completion', async () => {
    const cs = uniq('cs');
    const email = uniq('g') + '@example.com';
    h.stripe = makeStripeShim({
      session: { id: cs, status: 'open', payment_status: 'unpaid', mode: 'payment', currency: 'usd',
        amount_total: 1000, customer_details: { email }, customer_email: email, metadata: {}, created: 1, expires_at: 2 },
    });
    const r = await verifyPaymentSession(cs);
    expect(r.status).toBe('open');
    expect(r.payment_status).toBe('unpaid');
    expect(r.access_granted).toBeUndefined();
  });

  it('single-bump fallback (has_bump + bump_product_id) → bump granted [session]', async () => {
    const product = await createProduct();
    const b1 = await createBump(product.id);
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });
    h.stripe = makeStripeShim({
      session: paidSession(cs, product.id, email, { payment_intent: pi, metadata: { product_id: product.id, user_id: userId, has_bump: 'true', bump_product_id: b1.id } }),
    });
    const r = await verifyPaymentSession(cs, asUser(userId, email));
    expect(r.error).toBeUndefined();
    expect(await hasAccess(userId, b1.id)).toBe(true);
  });

  it('single-bump fallback (legacy bump_product_id) → bump granted [PI]', async () => {
    const product = await createProduct();
    const b1 = await createBump(product.id);
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });
    h.stripe = makeStripeShim({
      paymentIntent: { id: pi, status: 'succeeded', amount: 1000, currency: 'usd', receipt_email: email, metadata: { product_id: product.id, bump_product_id: b1.id } },
      sessionsByPI: [{ id: cs, amount_subtotal: 1000 }],
      session: { id: cs, status: 'complete', payment_status: 'paid', mode: 'payment', currency: 'usd', amount_total: 1000, amount_subtotal: 1000, total_details: { amount_tax: 0 }, automatic_tax: { enabled: false }, created: 1, expires_at: 2 },
    });
    const r = await verifyPaymentIntent(pi, asUser(userId, email));
    expect(r.error).toBeUndefined();
    expect(await hasAccess(userId, b1.id)).toBe(true);
  });

  it('outbound webhook rejection is non-fatal [session]', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('g') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });
    h.stripe = makeStripeShim({ session: paidSession(cs, product.id, email, { payment_intent: pi }) });
    triggerSpy.mockRejectedValueOnce(new Error('webhook down'));

    const r = await verifyPaymentSession(cs);
    expect(r.error).toBeUndefined();
    expect((await fetchTx(cs))?.status).toBe('completed');
  });

  it('outbound webhook rejection is non-fatal [PI]', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('g') + '@example.com';
    createdEmails.push(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi });
    h.stripe = makeStripeShim({
      paymentIntent: { id: pi, status: 'succeeded', amount: 1000, currency: 'usd', receipt_email: email, metadata: { product_id: product.id } },
      sessionsByPI: [{ id: cs, amount_subtotal: 1000 }],
    });
    triggerSpy.mockRejectedValueOnce(new Error('webhook down'));

    const r = await verifyPaymentIntent(pi, null);
    expect(r.error).toBeUndefined();
    expect((await fetchTx(cs))?.status).toBe('completed');
  });

  it('registered + invoice metadata → profile updated with company data (tax_id)', async () => {
    const product = await createProduct();
    const cs = uniq('cs');
    const pi = uniq('pi');
    const email = uniq('reg') + '@example.com';
    createdEmails.push(email);
    const userId = await createAuthUser(email);
    await seedPendingTx({ sessionId: cs, productId: product.id, email, pi, userId });
    const nip = '1234567890';
    h.stripe = makeStripeShim({
      session: paidSession(cs, product.id, email, {
        payment_intent: pi,
        metadata: {
          product_id: product.id, user_id: userId,
          first_name: 'Jan', last_name: 'Kowalski', full_name: 'Jan Kowalski',
          needs_invoice: 'true', nip, company_name: 'ACME', address: 'Main 1', city: 'Warsaw', postal_code: '00-001', country: 'PL',
        },
      }),
    });
    const r = await verifyPaymentSession(cs, asUser(userId, email));
    expect(r.error).toBeUndefined();
    const { data: profile } = await db!.from('profiles').select('tax_id, company_name, first_name').eq('id', userId).maybeSingle();
    expect(profile?.tax_id).toBe(nip);
    expect(profile?.company_name).toBe('ACME');
    expect(profile?.first_name).toBe('Jan');
  });
});
