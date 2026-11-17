/**
 * A paid payment always settles, whatever order the cart change, the Stripe update and the
 * payment happen in (W219b). Real route, real database and the real webhook handler; only
 * Stripe is replaced by an in-memory double whose update and expire steps can fail, time out
 * or race with the buyer's payment.
 * @see src/app/api/create-payment-intent/route.ts
 * @see src/app/api/update-payment-metadata/route.ts
 * @see src/lib/stripe/checkout-session-update.ts
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface FakeSession {
  id: string; object: 'checkout.session'; status: 'open' | 'complete' | 'expired'; mode: 'payment'; ui_mode: 'elements';
  locale: string; livemode: boolean; expires_at: number; client_secret: string; payment_intent: string | null;
  metadata: Record<string, string>; amount_subtotal: number; amount_total: number; currency: string;
  customer_details?: { email: string };
}
/** A cart update carries line items; a buyer-details save sends metadata only. */
type UpdateParams = { line_items?: Array<{ price_data: { unit_amount: number }; quantity: number }>; metadata: Record<string, string> };

const stripe = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  created: 0,
  /** Runs instead of the default update; receives the default as `apply`. */
  onUpdate: null as null | ((id: string, params: unknown, apply: () => unknown) => Promise<unknown>),
  expireFails: false,
  paid: [] as unknown[],
}));

vi.mock('@/lib/stripe/server', () => {
  const sum = (items: Array<{ price_data: { unit_amount: number }; quantity: number }>) =>
    items.reduce((total, item) => total + item.price_data.unit_amount * item.quantity, 0);
  const get = (id: string) => {
    const session = stripe.sessions.get(id) as FakeSession | undefined;
    if (!session) throw new Error(`No such checkout.session: ${id}`);
    return session;
  };
  const client = {
    checkout: {
      sessions: {
        create: async (params: { metadata: Record<string, string>; locale: string; line_items: UpdateParams['line_items'] }) => {
          const id = `cs_test_fake${++stripe.created}x${Date.now()}`;
          const amount = sum(params.line_items);
          const session: FakeSession = {
            id, object: 'checkout.session', status: 'open', mode: 'payment', ui_mode: 'elements', locale: params.locale,
            livemode: false, expires_at: Math.floor(Date.now() / 1000) + 3600, client_secret: `${id}_secret_fake`,
            payment_intent: null, metadata: { ...params.metadata }, amount_subtotal: amount, amount_total: amount, currency: 'pln',
          };
          stripe.sessions.set(id, session);
          return { ...session };
        },
        retrieve: async (id: string) => ({ ...get(id) }),
        update: async (id: string, params: UpdateParams) => {
          const apply = () => {
            const session = get(id);
            if (session.status !== 'open') throw new Error('This Checkout Session is no longer open');
            // Stripe merges metadata keys; an empty string removes the key.
            const metadata = { ...session.metadata, ...params.metadata };
            for (const [key, value] of Object.entries(params.metadata ?? {})) if (value === '') delete metadata[key];
            session.metadata = metadata;
            if (params.line_items) {
              const amount = sum(params.line_items);
              Object.assign(session, { amount_subtotal: amount, amount_total: amount });
            }
            return { ...session };
          };
          return stripe.onUpdate ? stripe.onUpdate(id, params, apply) : apply();
        },
        expire: async (id: string) => {
          if (stripe.expireFails) throw new Error('Stripe unavailable');
          const session = get(id);
          if (session.status !== 'open') throw new Error('Checkout Session is not open');
          session.status = 'expired';
          return { ...session };
        },
      },
    },
    paymentIntents: { retrieve: async (id: string) => ({ id, status: 'requires_payment_method' }) },
  };
  return { getStripeServer: async () => client };
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) }, rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/telemetry/identity', () => ({ readInstanceId: async () => 'consistency-test-installation' }));
vi.mock('@/lib/security/checkout-binding', () => ({ signCheckoutBinding: () => 'binding', verifyCheckoutBinding: () => true }));
vi.mock('@/lib/stripe/checkout-config', () => ({
  getCheckoutConfig: async () => ({ tax_mode: 'local', collect_terms_of_service: false, automatic_tax: { enabled: false }, tax_id_collection: { enabled: false }, billing_address_collection: 'auto', expires_hours: 24 }),
}));
vi.mock('@/lib/stripe/tax-rate-manager', () => ({ getOrCreateStripeTaxRate: async () => undefined, resolveLocalSubscriptionTaxRateId: async () => undefined }));
vi.mock('@/lib/services/fulfill-paid-order', () => ({ fulfillStripeOrder: async () => undefined }));
vi.mock('@/lib/payment/buyer-details', () => ({ backfillBuyerDetails: async () => undefined }));
vi.mock('@/lib/services/product-validation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/product-validation')>();
  return { ...actual, ProductValidationService: {
    validateEmail: async () => true,
    validateTemporalAvailability: actual.ProductValidationService.validateTemporalAvailability,
  } };
});

import { POST } from '@/app/api/create-payment-intent/route';
import { POST as saveBuyerDetails } from '@/app/api/update-payment-metadata/route';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';
import { handleCheckoutSessionCompleted } from '@/app/api/webhooks/stripe/onetime-handlers';
import { createAdminClient } from '@/lib/supabase/admin';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const EMAIL = `consistency-${crypto.randomUUID()}@example.com`;
let productId: string;

beforeAll(async () => {
  const slug = `consistency-${crypto.randomUUID()}`;
  const { data, error } = await db.from('products').insert({
    name: slug, slug, price: 100, currency: 'PLN', is_active: true, price_includes_vat: true, vat_rate: null,
    checkout_profile: { v: 1, modules: [{ id: 'quantity', mode: 'checkout', min: 1, max: 5 }] },
    custom_checkout_fields: [{ id: 'note', type: 'text', label: 'Note', required: true, max_length: 100 }],
  }).select('id').single();
  if (error) throw error;
  productId = data.id;
});
afterAll(async () => {
  const { data: txs } = await db.from('payment_transactions').select('id').eq('product_id', productId);
  const ids = (txs ?? []).map(t => t.id);
  await db.from('guest_purchases').delete().in('transaction_id', ids);
  await db.from('user_product_access').delete().eq('product_id', productId);
  await db.from('payment_transactions').delete().in('id', ids);
  await db.from('products').delete().eq('id', productId);
});
beforeEach(() => {
  stripe.onUpdate = null;
  stripe.expireFails = false;
});

const post = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/create-payment-intent', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ productId, email: EMAIL, locale: 'en', ...body }),
}));

/** Open a session for one item (10000) and return what the browser keeps. */
async function openCheckout() {
  const response = await post({ quantity: 1 });
  expect(response.status).toBe(200);
  const body = await response.json() as { clientSecret: string; bindingToken: string; checkoutSessionId: string };
  return { clientSecret: body.clientSecret, bindingToken: body.bindingToken, id: body.checkoutSessionId };
}

/** The buyer pays the session in its current Stripe state. */
function pay(id: string): FakeSession {
  const session = stripe.sessions.get(id) as FakeSession;
  session.status = 'complete';
  session.payment_intent = `pi_test_${crypto.randomUUID().replaceAll('-', '')}`;
  session.customer_details = { email: EMAIL };
  return structuredClone(session);
}

/** The checkout form saves the buyer's answers right before confirming the payment. */
const submitForm = (open: { clientSecret: string; bindingToken: string }, quantity: number, note: string) =>
  saveBuyerDetails(new NextRequest('http://localhost/api/update-payment-metadata', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: getCanonicalOriginOrNull()! },
    body: JSON.stringify({
      clientSecret: open.clientSecret, bindingToken: open.bindingToken, productId, email: EMAIL, locale: 'en',
      termsAccepted: true, moduleValues: { quantity }, customFieldValues: { note },
    }),
  }));

const settle = (paid: FakeSession) =>
  handleCheckoutSessionCompleted(paid as unknown as Parameters<typeof handleCheckoutSessionCompleted>[0], createAdminClient());

async function savedOrder(sessionId: string) {
  const { data } = await db.from('payment_transactions').select('status,amount,custom_field_values,payment_line_items(quantity)').eq('session_id', sessionId).single();
  return data as { status: string; amount: number; custom_field_values: Record<string, string>; payment_line_items: Array<{ quantity: number }> };
}

describe('paid payments settle whatever the order of cart change, Stripe update and payment (W219b)', () => {
  it.each([
    ['Stripe did not apply the update', false, 10000],
    ['Stripe applied the update before failing', true, 20000],
  ])('update fails and expiring fails too (%s): the payment Stripe takes settles', async (_label, applied, amount) => {
    const open = await openCheckout();
    stripe.onUpdate = async (_id, _params, apply) => { if (applied) apply(); throw new Error('Stripe API error'); };
    stripe.expireFails = true;
    const response = await post({ quantity: 2, clientSecret: open.clientSecret, bindingToken: open.bindingToken });
    expect(response.status).toBe(503);
    const paid = pay(open.id);
    expect(paid.amount_total).toBe(amount);
    expect(await settle(paid)).toMatchObject({ processed: true });
    expect(await savedOrder(open.id)).toMatchObject({ status: 'completed', amount, payment_line_items: [{ quantity: amount / 10000 }] });
  });

  it('the old session is paid between the cart change and the Stripe update: old 10000 and the new session both settle', async () => {
    const open = await openCheckout();
    let oldPayment: FakeSession | null = null;
    stripe.onUpdate = async (id) => { oldPayment = pay(id); throw new Error('This Checkout Session is no longer open'); };
    const response = await post({ quantity: 2, clientSecret: open.clientSecret, bindingToken: open.bindingToken });
    expect(response.status).toBe(200);
    const next = await response.json() as { checkoutSessionId: string };
    expect(next.checkoutSessionId).not.toBe(open.id);
    expect(oldPayment!.amount_total).toBe(10000);
    expect(await settle(oldPayment!)).toMatchObject({ processed: true });
    expect(await savedOrder(open.id)).toMatchObject({ status: 'completed', amount: 10000, payment_line_items: [{ quantity: 1 }] });
    const newPayment = pay(next.checkoutSessionId);
    expect(newPayment.amount_total).toBe(20000);
    expect(await settle(newPayment)).toMatchObject({ processed: true });
  });

  it.each([
    ['the request never reached Stripe', false, 10000],
    ['Stripe applied it', true, 20000],
  ])('the Stripe update times out (%s) and the buyer pays right after: the payment settles', async (_label, applied, amount) => {
    const open = await openCheckout();
    let payment: FakeSession | null = null;
    stripe.onUpdate = async (id, _params, apply) => {
      if (applied) apply();
      payment = pay(id);
      throw Object.assign(new Error('Request timed out'), { type: 'StripeConnectionError' });
    };
    const response = await post({ quantity: 2, clientSecret: open.clientSecret, bindingToken: open.bindingToken });
    expect(response.status).toBe(200);
    expect(payment!.amount_total).toBe(amount);
    expect(await settle(payment!)).toMatchObject({ processed: true });
    expect(await savedOrder(open.id)).toMatchObject({ status: 'completed', amount });
  });

  it('two interleaved cart changes end with the same cart in the database and in Stripe, and that payment settles', async () => {
    const open = await openCheckout();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    stripe.onUpdate = async (_id, _params, apply) => {
      if (++calls === 1) await gate; // request A is held inside its Stripe update
      return apply();
    };
    const first = post({ quantity: 2, clientSecret: open.clientSecret, bindingToken: open.bindingToken });
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = await post({ quantity: 3, clientSecret: open.clientSecret, bindingToken: open.bindingToken });
    release();
    const statuses = [(await first).status, second.status];
    expect(statuses.every(status => status === 200 || status === 409)).toBe(true);
    const stripeState = stripe.sessions.get(open.id) as FakeSession;
    const saved = await savedOrder(open.id);
    if (stripeState.status === 'open') {
      expect(saved.amount).toBe(stripeState.amount_total);
      const paid = pay(open.id);
      expect(await settle(paid)).toMatchObject({ processed: true });
    }
  });

  it('a late buyer-details save never rolls back the cart version Stripe charges (W219c)', async () => {
    const open = await openCheckout();
    expect((await post({ quantity: 2, clientSecret: open.clientSecret, bindingToken: open.bindingToken })).status).toBe(200);
    // The form has read the session with cart version 2 and is held before its Stripe write.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let formWrites = 0;
    stripe.onUpdate = async (_id, params, apply) => {
      if (!(params as UpdateParams).line_items && ++formWrites === 1) await gate;
      return apply();
    };
    const form = submitForm(open, 2, 'Workshop');
    await vi.waitFor(() => expect(formWrites).toBe(1));
    expect((await post({ quantity: 3, clientSecret: open.clientSecret, bindingToken: open.bindingToken })).status).toBe(200);
    release();
    expect((await form).status).toBe(200);
    const paid = pay(open.id);
    expect(paid.amount_total).toBe(30000);
    expect(paid.metadata.sellf_cart_version).toBe('3');
    expect(await settle(paid)).toMatchObject({ processed: true });
    expect(await savedOrder(open.id)).toMatchObject({ status: 'completed', amount: 30000, payment_line_items: [{ quantity: 3 }] });
  });

  it('answers the buyer gave after a cart change survive settlement (W219c)', async () => {
    const open = await openCheckout();
    expect((await post({ quantity: 2, clientSecret: open.clientSecret, bindingToken: open.bindingToken })).status).toBe(200);
    expect((await submitForm(open, 2, 'Workshop')).status).toBe(200);
    expect((await savedOrder(open.id)).custom_field_values).toEqual({ note: 'Workshop' });
    const paid = pay(open.id);
    expect(await settle(paid)).toMatchObject({ processed: true });
    expect(await savedOrder(open.id)).toMatchObject({ status: 'completed', amount: 20000, custom_field_values: { note: 'Workshop' } });
  });
});
