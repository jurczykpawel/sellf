/**
 * BEHAVIORAL: several Sellf installations share one Stripe account. Drives the REAL webhook POST
 * against the REAL local Supabase (completion RPC, products, payment_transactions). Only the
 * boundary is mocked: signature header, signature verification (returns the recorded payload),
 * Stripe client shim, rate limit, conversion tracking, outbound webhooks.
 *
 * Events are built from the recorded test-mode payloads in tests/fixtures/stripe.
 *
 * @see src/app/api/webhooks/stripe/instance-gate.ts
 * @see src/lib/stripe/instance-marker.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { deleteChecked } from '../../helpers/db-cleanup';
import checkoutFixture from '../../fixtures/stripe/checkout_completed_receiver.json';
import invoiceFixture from '../../fixtures/stripe/invoice_paid_cycle.json';
import disputeFixture from '../../fixtures/stripe/charge_dispute_created_needs_response.json';
import quickPayFixture from '../../fixtures/stripe/quick_pay_checkout_completed.json';
import subscriptionFixture from '../../fixtures/stripe/subscription_before_cancel.json';

type AdminFactory = typeof import('@/lib/supabase/admin').createAdminClient;
const h = vi.hoisted(() => ({ stripe: null as unknown as Stripe, admin: null as null | ((real: AdminFactory) => unknown) }));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: (k: string) => (k === 'stripe-signature' ? 'test_sig' : null) })) }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn, unstable_noStore: vi.fn() }));
vi.mock('@/lib/stripe/server', () => ({
  verifyWebhookSignature: vi.fn(async (body: string) => JSON.parse(body)),
  getStripeServer: vi.fn(async () => h.stripe),
}));
vi.mock('@/lib/rate-limiting', async (orig) => ({ ...(await orig<typeof import('@/lib/rate-limiting')>()), checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/tracking', async (orig) => ({ ...(await orig<typeof import('@/lib/tracking')>()), trackServerSideConversion: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/admin', async (orig) => {
  const actual = await orig<typeof import('@/lib/supabase/admin')>();
  return { ...actual, createAdminClient: vi.fn(() => (h.admin ? h.admin(actual.createAdminClient) : actual.createAdminClient())) };
});
vi.mock('@/lib/services/product-validation', () => ({ ProductValidationService: { validateEmail: vi.fn(async () => true) } }));

import { POST } from '@/app/api/webhooks/stripe/route';
import { WebhookService } from '@/lib/services/webhook-service';
import { getStripeInstanceId, STRIPE_INSTANCE_METADATA_KEY } from '@/lib/stripe/instance-marker';
import { listPaymentsNeedingReconciliation, PAYMENT_RECONCILIATION_ACTION, reconcilePaymentForMissingProduct } from '@/lib/stripe/payment-reconciliation';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const hasSupabase = !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
const db = hasSupabase ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

const productIds: string[] = [];
const emails: string[] = [];
const subscriptionIds: string[] = [];
const reconciliationTargets: string[] = [];
let ours = '';
let seq = 0;
const uniq = (p: string) => `${p}_${Date.now()}_${++seq}_${Math.random().toString(36).slice(2, 7)}`;
const FOREIGN = 'f'.repeat(32);

beforeAll(async () => { if (hasSupabase) ours = await getStripeInstanceId(); });
afterAll(async () => {
  if (!db) return;
  if (reconciliationTargets.length) await deleteChecked('admin_actions', db.from('admin_actions').delete().in('target_id', reconciliationTargets));
  if (subscriptionIds.length) await deleteChecked('subscriptions', db.from('subscriptions').delete().in('stripe_subscription_id', subscriptionIds));
  if (emails.length) await deleteChecked('guest_purchases', db.from('guest_purchases').delete().in('customer_email', emails));
  if (productIds.length) {
    await deleteChecked('payment_line_items', db.from('payment_line_items').delete().in('product_id', productIds));
    await deleteChecked('payment_transactions', db.from('payment_transactions').delete().in('product_id', productIds));
    await deleteChecked('products', db.from('products').delete().in('id', productIds));
  }
});

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  h.admin = null;
  h.stripe = {
    checkout: { sessions: { listLineItems: vi.fn(async () => ({ data: [] })), retrieve: vi.fn(async () => ({ id: 'cs_shim', amount_total: 4999, amount_subtotal: 4999, currency: 'usd', total_details: { amount_tax: 0 }, automatic_tax: { enabled: false } })), list: vi.fn(async () => ({ data: [] })) } },
  } as unknown as Stripe;
  vi.spyOn(WebhookService, 'trigger').mockImplementation(async () => {});
  logSpy = vi.spyOn(console, 'log');
  warnSpy = vi.spyOn(console, 'warn');
  errorSpy = vi.spyOn(console, 'error');
  if (db) await db.from('rate_limits').delete().like('function_name', '%process_stripe_payment_completion');
});
afterEach(() => vi.restoreAllMocks());

async function createProduct(isActive = true): Promise<string> {
  const { data, error } = await db!.from('products')
    .insert({ slug: uniq('im'), name: 'Instance marker product', price: 49.99, currency: 'usd', is_active: isActive })
    .select('id').single();
  if (error || !data) throw new Error(`createProduct failed: ${error?.message}`);
  productIds.push(data.id);
  return data.id;
}

function sessionEvent(metadata: Record<string, string>) {
  const event = structuredClone(checkoutFixture) as unknown as { id: string; data: { object: Record<string, unknown> } };
  const email = `${uniq('buyer')}@example.com`;
  emails.push(email);
  event.id = uniq('evt');
  Object.assign(event.data.object, { id: uniq('cs'), payment_intent: uniq('pi'), metadata, customer_details: { ...(event.data.object.customer_details as object), email } });
  return event;
}

async function postFull(event: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await POST(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: JSON.stringify(event) }) as never);
  return { status: res.status, body: await res.json() };
}
async function post(event: unknown): Promise<number> {
  return (await postFull(event)).status;
}
const logs = () => [...logSpy.mock.calls, ...warnSpy.mock.calls].flat().join(' ');
const errors = () => errorSpy.mock.calls.flat().join(' ');
const failingRpc = (realFactory: AdminFactory) => {
  const real = realFactory();
  return Object.assign(Object.create(real), { rpc: vi.fn(async () => ({ data: null, error: { message: 'connection reset', code: '08006' } })) });
};
const failingReads = () => ({
  from: () => { const q: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'limit', 'in']) q[m] = () => q; q.maybeSingle = async () => ({ data: null, error: { message: 'connection reset' } }); q.then = (r: (v: unknown) => void) => r({ data: null, error: { message: 'connection reset' } }); return q; },
  rpc: vi.fn(),
});
/** Stripe shim that records every top-level resource the handler touches. */
function recordingStripe(touched: string[]): Stripe {
  return new Proxy({}, { get: (_, key) => { if (key === 'then') return undefined; touched.push(String(key)); throw new Error(`Stripe ${String(key)} unavailable in test`); } }) as Stripe;
}
async function createSubscription(productId: string): Promise<string> {
  const stripeSubscriptionId = uniq('sub');
  subscriptionIds.push(stripeSubscriptionId);
  const { error } = await db!.from('subscriptions').insert({ product_id: productId, stripe_customer_id: uniq('cus'), stripe_subscription_id: stripeSubscriptionId, status: 'active' });
  if (error) throw new Error(`createSubscription failed: ${error.message}`);
  return stripeSubscriptionId;
}
async function createTransferAttempt(productId: string): Promise<string> {
  const { data: tx, error } = await db!.from('payment_transactions').insert({ product_id: productId, customer_email: `${uniq('transfer')}@example.com`, amount: 170, currency: 'PLN',
    status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1 }).select('id').single();
  if (error || !tx) throw new Error(`transfer order failed: ${error?.message}`);
  const { data: attempt, error: attemptError } = await db!.from('order_payment_attempts').insert({ transaction_id: tx.id, kind: 'settle', amount: 170, currency: 'PLN',
    status: 'opening', expires_at: new Date(Date.now() + 30 * 60000).toISOString() }).select('id').single();
  if (attemptError || !attempt) throw new Error(`attempt failed: ${attemptError?.message}`);
  return attempt.id;
}
function quickPayEvent(attemptId: string, type = 'checkout.session.completed') {
  const event = structuredClone(quickPayFixture) as unknown as { id: string; type: string; data: { object: Record<string, unknown> } };
  event.id = uniq('evt');
  event.type = type;
  Object.assign(event.data.object, { id: uniq('cs'), payment_intent: uniq('pi'), metadata: { sellf_payment_attempt: attemptId, sellf_order: crypto.randomUUID() } });
  return event;
}
function disputeEvent() {
  const event = structuredClone(disputeFixture) as unknown as { id: string; data: { object: Record<string, unknown> } };
  event.id = uniq('evt');
  const paymentIntent = uniq('pi');
  Object.assign(event.data.object, { id: uniq('du'), charge: uniq('ch'), payment_intent: paymentIntent, metadata: {} });
  return { event, paymentIntent };
}

async function txCount(sessionId: string): Promise<number> {
  const { count, error } = await db!.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('session_id', sessionId);
  if (error) throw error;
  return count ?? 0;
}

describe.skipIf(!hasSupabase)('Stripe webhook — shared Stripe account (instance marker)', () => {
  it('foreign marker on an existing product → 200, nothing saved, logged as foreign', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN });
    expect(await post(event)).toBe(200);
    expect(await txCount(event.data.object.id as string)).toBe(0);
    expect(logSpy.mock.calls.flat().join(' ')).toContain('foreign instance, skipped');
  });

  it('foreign marker on a subscription invoice (parent.subscription_details) → 200 without touching Stripe', async () => {
    const event = structuredClone(invoiceFixture) as unknown as { data: { object: { parent: { subscription_details: { metadata: Record<string, string> } } } } };
    event.data.object.parent.subscription_details.metadata = { [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN };
    h.stripe = {} as Stripe; // any Stripe call would throw
    expect(await post(event)).toBe(200);
    expect(logSpy.mock.calls.flat().join(' ')).toContain('foreign instance, skipped');
  });

  it('no marker + product unknown here (old session from another installation) → 200, skipped', async () => {
    const event = sessionEvent({ product_id: crypto.randomUUID() });
    expect(await post(event)).toBe(200);
    expect(await txCount(event.data.object.id as string)).toBe(0);
  });

  it('no marker + non-UUID product id → 200, skipped', async () => {
    expect(await post(sessionEvent({ product_id: 'not-a-uuid' }))).toBe(200);
  });

  it('our marker → payment processed', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    expect(await post(event)).toBe(200);
    const { data } = await db!.from('payment_transactions').select('status').eq('session_id', event.data.object.id as string).single();
    expect(data?.status).toBe('completed');
  });

  it('no marker + our product (session from before this release) → payment processed', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId });
    expect(await post(event)).toBe(200);
    expect(await txCount(event.data.object.id as string)).toBe(1);
  });

  it('our marker + database failure → 500 so Stripe redelivers', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    h.admin = (realFactory) => {
      const real = realFactory();
      return Object.assign(Object.create(real), { rpc: vi.fn(async () => ({ data: null, error: { message: 'connection reset', code: '08006' } })) });
    };
    expect(await post(event)).toBe(500);
  });

  it('no marker + database failure while checking the product → 500 (not silently skipped)', async () => {
    const event = sessionEvent({ product_id: crypto.randomUUID() });
    h.admin = failingReads;
    expect(await post(event)).toBe(500);
    expect(errors()).toContain('Instance check failed');
  });
});

describe.skipIf(!hasSupabase)('Stripe webhook — delayed payment completion is redelivered on failure', () => {
  it('async_payment_succeeded + completion RPC failure → 500 and nothing granted; the redelivery fulfils the order', async () => {
    const productId = await createProduct();
    const event = { ...sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours }), type: 'checkout.session.async_payment_succeeded' };
    const email = (event.data.object.customer_details as { email: string }).email;
    h.admin = failingRpc;
    expect(await post(event)).toBe(500);
    expect(await txCount(event.data.object.id as string)).toBe(0);
    h.admin = null;
    expect(await post(event)).toBe(200);
    const { data } = await db!.from('payment_transactions').select('status').eq('session_id', event.data.object.id as string).single();
    expect(data?.status).toBe('completed');
    const { count } = await db!.from('guest_purchases').select('id', { count: 'exact', head: true }).eq('customer_email', email).eq('product_id', productId);
    expect(count).toBe(1);
  });

  it('async_payment_succeeded without a marker + product lookup failure → 500, not silently acknowledged', async () => {
    h.admin = failingReads;
    expect(await post({ ...sessionEvent({ product_id: crypto.randomUUID() }), type: 'checkout.session.async_payment_succeeded' })).toBe(500);
    expect(errors()).toContain('Instance check failed');
  });

  it('quick pay: our attempt still waiting for its session + async_payment_succeeded → 500 so Stripe redelivers', async () => {
    const attemptId = await createTransferAttempt(await createProduct());
    expect(await post(quickPayEvent(attemptId, 'checkout.session.async_payment_succeeded'))).toBe(500);
  });
});

describe.skipIf(!hasSupabase)('Stripe webhook — identity changes only explicitly (no acceptance through local records)', () => {
  afterEach(() => vi.unstubAllEnvs());

  async function pendingOrderFor(event: ReturnType<typeof sessionEvent>, productId: string) {
    const object = event.data.object;
    const { error } = await db!.from('payment_transactions').insert({ session_id: object.id as string, product_id: productId, amount: 49.99, currency: 'usd',
      customer_email: (object.customer_details as { email: string }).email, status: 'pending' });
    expect(error).toBeNull();
  }
  const statusOf = async (sessionId: string) => (await db!.from('payment_transactions').select('status').eq('session_id', sessionId).single()).data?.status;

  it('rehearsal copy (own SELLF_INSTANCE_ID, no aliases) with a copied pending order does NOT fulfil the original\'s event', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    await pendingOrderFor(event, productId);
    vi.stubEnv('SELLF_INSTANCE_ID', 'rehearsal-copy');
    expect(await postFull(event)).toEqual({ status: 200, body: { received: true, skipped: 'foreign instance, skipped' } });
    expect(await statusOf(event.data.object.id as string)).toBe('pending');
  });

  it('moved installation (new SELLF_INSTANCE_ID + previous marker in SELLF_INSTANCE_ALIASES) fulfils events with the previous marker', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    await pendingOrderFor(event, productId);
    vi.stubEnv('SELLF_INSTANCE_ID', 'moved-server');
    vi.stubEnv('SELLF_INSTANCE_ALIASES', ours);
    expect(await post(event)).toBe(200);
    expect(await statusOf(event.data.object.id as string)).toBe('completed');
  });

  it('moved installation: invoice.paid with the previous marker for a local subscription is handled (renewal not cut off)', async () => {
    const stripeSubscriptionId = await createSubscription(await createProduct());
    const event = structuredClone(invoiceFixture) as unknown as { data: { object: { parent: { subscription_details: Record<string, unknown> } } } };
    event.data.object.parent.subscription_details = { metadata: { [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN }, subscription: stripeSubscriptionId };
    vi.stubEnv('SELLF_INSTANCE_ALIASES', FOREIGN);
    const touched: string[] = [];
    h.stripe = recordingStripe(touched);
    const { body } = await postFull(event);
    expect(body.skipped).toBeUndefined();
    expect(touched).toContain('subscriptions');
  });

  it('foreign marker + a local order bound to the same session → still skipped, order untouched', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN });
    await pendingOrderFor(event, productId);
    expect(await post(event)).toBe(200);
    expect(await statusOf(event.data.object.id as string)).toBe('pending');
    expect(logs()).not.toContain('marker mismatch');
  });

  it('foreign marker + a local subscription → invoice.paid skipped without touching Stripe', async () => {
    const stripeSubscriptionId = await createSubscription(await createProduct());
    const event = structuredClone(invoiceFixture) as unknown as { data: { object: { parent: { subscription_details: Record<string, unknown> } } } };
    event.data.object.parent.subscription_details = { metadata: { [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN }, subscription: stripeSubscriptionId };
    const touched: string[] = [];
    h.stripe = recordingStripe(touched);
    expect(await postFull(event)).toEqual({ status: 200, body: { received: true, skipped: 'foreign instance, skipped' } });
    expect(touched).toEqual([]);
  });

  it('foreign subscription whose metadata names a local pay-link attempt of another order → skipped, no subscription and no access', async () => {
    const productId = await createProduct();
    const attemptId = await createTransferAttempt(productId);
    const subscription = { ...structuredClone(subscriptionFixture), id: uniq('sub'), metadata: { [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN, sellf_payment_attempt: attemptId, product_id: productId } };
    subscriptionIds.push(subscription.id);
    const event = { id: uniq('evt'), type: 'customer.subscription.created', data: { object: subscription } };
    h.stripe = recordingStripe([]);
    expect(await postFull(event)).toEqual({ status: 200, body: { received: true, skipped: 'foreign instance, skipped' } });
    const { count: subs } = await db!.from('subscriptions').select('id', { count: 'exact', head: true }).eq('stripe_subscription_id', subscription.id);
    expect(subs).toBe(0);
    const { count: access } = await db!.from('user_product_access').select('id', { count: 'exact', head: true }).eq('product_id', productId);
    expect(access).toBe(0);
  });

  it('foreign marker is decided without reading the database (a failing database still acknowledges)', async () => {
    const event = { id: uniq('evt'), type: 'customer.subscription.created', data: { object: { ...structuredClone(subscriptionFixture), metadata: { [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN } } } };
    h.admin = failingReads;
    expect(await post(event)).toBe(200);
  });

  it('malformed SELLF_INSTANCE_ALIASES → 500 (configuration error is not guessed)', async () => {
    vi.stubEnv('SELLF_INSTANCE_ALIASES', 'bad;alias');
    expect(await post(sessionEvent({ product_id: crypto.randomUUID(), [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN }))).toBe(500);
    expect(errors()).toContain('Instance check failed');
  });
});

describe.skipIf(!hasSupabase)('Stripe webhook — disputes and refunds resolved through the payment', () => {
  function stripeFor(paymentIntent: string, piMetadata: Record<string, string> | Error) {
    return {
      charges: { retrieve: vi.fn(async (id: string) => ({ id, payment_intent: paymentIntent, amount_refunded: 0 })) },
      paymentIntents: { retrieve: vi.fn(async () => { if (piMetadata instanceof Error) throw piMetadata; return { id: paymentIntent, metadata: piMetadata }; }) },
      checkout: { sessions: { list: vi.fn(async () => ({ data: [] })) } },
    } as unknown as Stripe;
  }

  it('dispute whose payment carries a foreign marker and no local payment → 200, acknowledged', async () => {
    const productId = await createProduct();
    const { event, paymentIntent } = disputeEvent();
    h.stripe = stripeFor(paymentIntent, { product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: FOREIGN });
    expect(await post(event)).toBe(200);
  });

  it('dispute whose payment carries our marker but is not stored yet → 500 (wait for the payment)', async () => {
    const productId = await createProduct();
    const { event, paymentIntent } = disputeEvent();
    h.stripe = stripeFor(paymentIntent, { product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    expect(await post(event)).toBe(500);
  });

  it('dispute + failure fetching the payment → 500', async () => {
    const { event, paymentIntent } = disputeEvent();
    h.stripe = stripeFor(paymentIntent, new Error('Stripe unavailable'));
    expect(await post(event)).toBe(500);
  });
});

describe.skipIf(!hasSupabase)('Stripe webhook — old quick pay of another installation', () => {
  it('unmarked quick pay for an attempt this database never had → 200, acknowledged', async () => {
    expect(await postFull(quickPayEvent(crypto.randomUUID()))).toEqual({ status: 200, body: { received: true, skipped: 'unmarked quick pay attempt unknown here, skipped' } });
  });

  it('unmarked quick pay + failure reading the attempt → 500', async () => {
    h.admin = failingReads;
    expect(await post(quickPayEvent(crypto.randomUUID()))).toBe(500);
    expect(errors()).toContain('Instance check failed');
  });
});

describe.skipIf(!hasSupabase)('Stripe webhook — our payment for a deleted product', () => {
  it('records the payment for reconciliation (amount, payment id) visible to the admin, acknowledges, and stays one record on redelivery', async () => {
    const productId = await createProduct();
    const { error } = await db!.from('products').delete().eq('id', productId);
    expect(error).toBeNull();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    const paymentIntent = event.data.object.payment_intent as string;
    reconciliationTargets.push(paymentIntent);
    expect(await post(event)).toBe(200);
    expect(await post(event)).toBe(200);
    const { data: rows } = await db!.from('admin_actions').select('details').eq('action', PAYMENT_RECONCILIATION_ACTION).eq('target_id', paymentIntent);
    expect(rows).toHaveLength(1);
    expect(rows![0].details).toMatchObject({ reason: 'product_deleted', product_id: productId, amount: 4999, currency: 'usd', payment_intent_id: paymentIntent, session_id: event.data.object.id });
    const listed = await listPaymentsNeedingReconciliation(db as never);
    expect(listed.find((item) => item.paymentId === paymentIntent)).toMatchObject({ amount: 4999, currency: 'usd', productId, reason: 'product_deleted' });
  });

  it('the same payment reported by both the Checkout Session and its PaymentIntent, delivered in parallel → one record (database-enforced)', async () => {
    const productId = crypto.randomUUID();
    const paymentIntentId = uniq('pi');
    reconciliationTargets.push(paymentIntentId);
    const base = { productId, paymentIntentId, amount: 4999, currency: 'usd', customerEmail: 'buyer@example.com' };
    const results = await Promise.all([
      reconcilePaymentForMissingProduct(db as never, { ...base, sessionId: uniq('cs'), eventType: 'checkout.session' }),
      reconcilePaymentForMissingProduct(db as never, { ...base, sessionId: null, eventType: 'payment_intent' }),
      reconcilePaymentForMissingProduct(db as never, { ...base, sessionId: null, eventType: 'payment_intent' }),
    ]);
    expect(results.every((r) => r?.processed === true)).toBe(true);
    const { count } = await db!.from('admin_actions').select('id', { count: 'exact', head: true }).eq('action', PAYMENT_RECONCILIATION_ACTION).eq('target_id', paymentIntentId);
    expect(count).toBe(1);
    const duplicate = await db!.from('admin_actions').insert({ action: PAYMENT_RECONCILIATION_ACTION, target_type: 'stripe_payment', target_id: paymentIntentId, details: {} });
    expect(duplicate.error?.code).toBe('23505');
  });

  it('log retention (cleanup_old_admin_actions) keeps a payment waiting for reconciliation, even 100 days old', async () => {
    const paymentIntentId = uniq('pi');
    const oldAction = uniq('old_action');
    reconciliationTargets.push(paymentIntentId, oldAction);
    const created_at = new Date(Date.now() - 100 * 86400000).toISOString();
    const { error } = await db!.from('admin_actions').insert([
      { action: PAYMENT_RECONCILIATION_ACTION, target_type: 'stripe_payment', target_id: paymentIntentId, details: { reason: 'product_deleted' }, created_at },
      { action: 'test_old_action', target_type: 'test', target_id: oldAction, details: {}, created_at },
    ]);
    expect(error).toBeNull();
    const cleanup = await db!.rpc('cleanup_old_admin_actions', { retention_days: 90 });
    expect(cleanup.error).toBeNull();
    const { data } = await db!.from('admin_actions').select('target_id').in('target_id', [paymentIntentId, oldAction]);
    expect(data?.map((row) => row.target_id)).toEqual([paymentIntentId]);
  });
});

describe.skipIf(!hasSupabase)('Stripe webhook — our paid session for an existing but inactive product', () => {
  async function guestPurchases(event: ReturnType<typeof sessionEvent>, productId: string) {
    const email = (event.data.object.customer_details as { email: string }).email;
    const { count } = await db!.from('guest_purchases').select('id', { count: 'exact', head: true }).eq('customer_email', email).eq('product_id', productId);
    return count;
  }
  const statusOf = async (sessionId: string) => (await db!.from('payment_transactions').select('status').eq('session_id', sessionId).maybeSingle()).data?.status;

  it('product deactivated after checkout, no local order row → fulfilled (completed + access), not recorded for reconciliation', async () => {
    const productId = await createProduct(false);
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    reconciliationTargets.push(event.data.object.payment_intent as string);
    expect(await post(event)).toBe(200);
    expect(await statusOf(event.data.object.id as string)).toBe('completed');
    expect(await guestPurchases(event, productId)).toBe(1);
    const { count } = await db!.from('admin_actions').select('id', { count: 'exact', head: true }).eq('target_id', event.data.object.payment_intent as string);
    expect(count).toBe(0);
  });

  it('old-format pending order (no price snapshot), product deactivated before payment → fulfilled', async () => {
    const productId = await createProduct();
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    const object = event.data.object;
    const { error } = await db!.from('payment_transactions').insert({ session_id: object.id as string, product_id: productId, amount: 49.99, currency: 'usd',
      customer_email: (object.customer_details as { email: string }).email, status: 'pending' });
    expect(error).toBeNull();
    expect((await db!.from('products').update({ is_active: false }).eq('id', productId)).error).toBeNull();
    expect(await post(event)).toBe(200);
    expect(await statusOf(object.id as string)).toBe('completed');
    expect(await guestPurchases(event, productId)).toBe(1);
  });

  it('inactive product keeps the amount check: a paid amount below the price is not fulfilled', async () => {
    const productId = await createProduct(false);
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    Object.assign(event.data.object, { amount_total: 100, amount_subtotal: 100 });
    expect(await post(event)).toBe(500);
    expect(await txCount(event.data.object.id as string)).toBe(0);
    expect(await guestPurchases(event, productId)).toBe(0);
  });

  it('inactive product keeps the currency check', async () => {
    const productId = await createProduct(false);
    const event = sessionEvent({ product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours });
    Object.assign(event.data.object, { currency: 'eur' });
    expect(await post(event)).toBe(500);
    expect(await txCount(event.data.object.id as string)).toBe(0);
  });

  it('payment_intent.succeeded with our marker for an inactive product → fulfilled', async () => {
    const productId = await createProduct(false);
    const email = `${uniq('buyer')}@example.com`;
    emails.push(email);
    const paymentIntentId = uniq('pi');
    const event = { id: uniq('evt'), type: 'payment_intent.succeeded', data: { object: { id: paymentIntentId, object: 'payment_intent', amount: 4999, currency: 'usd', receipt_email: email,
      metadata: { product_id: productId, [STRIPE_INSTANCE_METADATA_KEY]: ours } } } };
    expect(await post(event)).toBe(200);
    const { data } = await db!.from('payment_transactions').select('status').eq('stripe_payment_intent_id', paymentIntentId).single();
    expect(data?.status).toBe('completed');
  });

  it('no marker (session from before this release) + inactive product → unchanged: not fulfilled, Stripe retries', async () => {
    const productId = await createProduct(false);
    const event = sessionEvent({ product_id: productId });
    expect(await post(event)).toBe(500);
    expect(await txCount(event.data.object.id as string)).toBe(0);
  });
});
