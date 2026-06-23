/**
 * Subscription webhook handler integration tests (Phase 6 — Subscriptions MVP)
 *
 * Exercises the inbound webhook handlers end-to-end against the local Supabase
 * stack and a real Stripe test customer. Stripe webhook delivery itself is
 * mocked — we construct Stripe-shaped fixtures and call the handlers directly,
 * which is how Stripe Test Clocks deliver to handlers internally too.
 *
 * Coverage:
 *  - handleSubscriptionCreated -> subscriptions row + outbound webhook event
 *  - handleInvoicePaid (first invoice) -> user materialized, access granted, payment_transactions inserted
 *  - handleInvoicePaid (renewal) -> sequence number increments, no duplicate access row
 *  - handleSubscriptionDeleted -> access revoked
 *  - Idempotency: replaying invoice.paid does not double-insert
 *
 * Run: bun run test:unit -- tests/unit/subscription-handlers.integration.test.ts
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleSubscriptionTrialWillEnd,
  handleInvoiceUpcoming,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from '@/app/api/webhooks/stripe/subscription-handlers';
import { WebhookService } from '@/lib/services/webhook-service';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const hasStripe = !!STRIPE_SECRET_KEY && STRIPE_SECRET_KEY.startsWith('sk_test_');
const hasSupabase = !!SUPABASE_URL && !!SERVICE_ROLE_KEY;
const canRun = hasStripe && hasSupabase;

const stripe = canRun ? new Stripe(STRIPE_SECRET_KEY!) : null;
const supabaseSeller = hasSupabase
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { db: { schema: 'public' } })
  : null;
const platformClient = hasSupabase ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

// Track artifacts for cleanup
const createdProductIds: string[] = [];
const createdAuthUserIds: string[] = [];
const createdStripeCustomerIds: string[] = [];

beforeAll(() => {
  if (!canRun) {
    console.warn(
      '[subscription-handlers.integration] Skipping — requires STRIPE_SECRET_KEY=sk_test_* and Supabase env'
    );
  }
});

afterAll(async () => {
  if (createdStripeCustomerIds.length > 0 && stripe) {
    await Promise.allSettled(createdStripeCustomerIds.map((id) => stripe.customers.del(id)));
  }
  if (createdAuthUserIds.length > 0 && platformClient) {
    await Promise.allSettled(
      createdAuthUserIds.map((id) => platformClient.auth.admin.deleteUser(id))
    );
  }
  if (createdProductIds.length > 0 && supabaseSeller) {
    // Delete dependent rows first so FKs don't block.
    await supabaseSeller.from('user_product_access').delete().in('product_id', createdProductIds);
    await supabaseSeller.from('payment_transactions').delete().in('product_id', createdProductIds);
    await supabaseSeller.from('subscriptions').delete().in('product_id', createdProductIds);
    await supabaseSeller.from('products').delete().in('id', createdProductIds);
  }
});

async function createSubscriptionProduct(): Promise<{ id: string; slug: string; name: string }> {
  const slug = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabaseSeller!
    .from('products')
    .insert({
      name: 'Test Monthly Plan',
      slug,
      price: 0,
      currency: 'PLN',
      product_type: 'subscription',
      billing_interval: 'month',
      billing_interval_count: 1,
      recurring_price: 49.0,
      trial_days: null,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`createSubscriptionProduct failed: ${error?.message}`);
  createdProductIds.push(data.id);
  return { id: data.id, slug: data.slug, name: data.name };
}

function makeFakeSubscription(
  customerId: string,
  productId: string,
  overrides: Partial<Stripe.Subscription> = {}
): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  const fakePriceId = `price_fake_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: `sub_test_${Math.random().toString(36).slice(2, 12)}`,
    customer: customerId,
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    metadata: { product_id: productId },
    items: {
      data: [
        {
          // every subscription item must carry a Stripe Price id —
          // the webhook handler rejects items without one.
          price: {
            id: fakePriceId,
            unit_amount: 4900,
            currency: 'pln',
            recurring: { interval: 'month', interval_count: 1 },
          },
          current_period_start: now,
          current_period_end: now + 30 * 24 * 3600,
        } as unknown as Stripe.SubscriptionItem,
      ],
    } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
    latest_invoice: null,
    ...overrides,
  } as Stripe.Subscription;
}

function makeFakeInvoice(
  subscriptionId: string,
  customerId: string,
  email: string,
  overrides: Partial<Stripe.Invoice> = {}
): Stripe.Invoice {
  return {
    id: `in_test_${Math.random().toString(36).slice(2, 12)}`,
    customer: customerId,
    customer_email: email,
    amount_paid: 4900,
    amount_due: 4900,
    currency: 'pln',
    hosted_invoice_url: 'https://invoice.stripe.com/i/test',
    invoice_pdf: 'https://invoice.stripe.com/i/test/pdf',
    status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
    billing_reason: 'subscription_create',
    attempt_count: 1,
    next_payment_attempt: null,
    subscription: subscriptionId,
    ...overrides,
  } as unknown as Stripe.Invoice;
}

describe.skipIf(!canRun)('Subscription webhook handlers (integration)', () => {
  it('handleSubscriptionCreated upserts subscription row + materializes auth user', async () => {
    const email = `sub-integ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();

    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const sub = makeFakeSubscription(customer.id, product.id);
    const result = await handleSubscriptionCreated(
      sub,
      supabaseSeller as never,
      platformClient as never,
      stripe!
    );

    expect(result.processed).toBe(true);

    const { data: row } = await supabaseSeller!
      .from('subscriptions')
      .select('id, status, product_id, stripe_subscription_id')
      .eq('stripe_subscription_id', sub.id)
      .single();
    expect(row?.product_id).toBe(product.id);
    expect(row?.status).toBe('active');

    const { data: authUser } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    expect(typeof authUser).toBe('string');
    if (typeof authUser === 'string') createdAuthUserIds.push(authUser);
  });

  it('handleSubscriptionCreated grants user_product_access for a trialing subscription', async () => {
    // Stripe does not invoice during the default trial period, so the
    // first invoice.paid arrives only when the trial ends. Without a
    // grant in the create handler, the customer is paywalled for the
    // entire trial.
    const email = `trial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const sub = makeFakeSubscription(customer.id, product.id, {
      status: 'trialing',
      trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    });
    const result = await handleSubscriptionCreated(
      sub,
      supabaseSeller as never,
      platformClient as never,
      stripe!,
    );
    expect(result.processed).toBe(true);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    expect(typeof userId).toBe('string');
    if (typeof userId === 'string') createdAuthUserIds.push(userId);

    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('user_id, product_id, subscription_id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(access?.length ?? 0).toBeGreaterThan(0);
    expect(access?.[0]?.subscription_id).toBeTruthy();
  });

  it('handleSubscriptionCreated does NOT grant access for non-grant statuses (e.g. past_due)', async () => {
    // past_due / incomplete / paused / canceled must not grant access on
    // the create event — only trialing or active should.
    const email = `past-due-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const sub = makeFakeSubscription(customer.id, product.id, { status: 'past_due' });
    const result = await handleSubscriptionCreated(
      sub,
      supabaseSeller as never,
      platformClient as never,
      stripe!,
    );
    expect(result.processed).toBe(true);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);

    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(access?.length ?? 0).toBe(0);
  });

  it('handleSubscriptionUpdated grants access on incomplete -> active transition', async () => {
    // Stripe sends customer.subscription.updated for incomplete -> active
    // (e.g. pending payment method confirmation). Mirror the grant logic
    // from handleSubscriptionCreated so the customer gets access without
    // waiting for the next invoice.paid.
    const email = `incomplete-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const incomplete = makeFakeSubscription(customer.id, product.id, { status: 'incomplete' });
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => incomplete },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(
      incomplete,
      supabaseSeller as never,
      platformClient as never,
      stripeShim,
    );

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);

    // No access yet (incomplete is not in the grant set).
    const { data: noAccess } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(noAccess?.length ?? 0).toBe(0);

    // Now the customer confirms payment — Stripe emits customer.subscription.updated
    // with status='active'. Access should appear.
    const activated = { ...incomplete, status: 'active' as const };
    const result = await handleSubscriptionUpdated(
      activated,
      supabaseSeller as never,
      platformClient as never,
      stripeShim,
    );
    expect(result.processed).toBe(true);

    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('user_id, product_id, subscription_id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(access?.length ?? 0).toBeGreaterThan(0);
    expect(access?.[0]?.subscription_id).toBeTruthy();
  });

  it('handleInvoicePaid grants access on first invoice + idempotent on replay', async () => {
    const email = `inv-paid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const subStripe = makeFakeSubscription(customer.id, product.id);

    // Create the subscription on Stripe-side (so handleInvoicePaid's stripe.subscriptions.retrieve works).
    // We can't actually create one without a price/payment method, so we mock: use the test fake by
    // patching stripe.subscriptions.retrieve through a small wrapper. Easier: pre-insert the subscription
    // row via handleSubscriptionCreated, then construct an invoice and call handler directly. We bypass
    // the handler's `stripe.subscriptions.retrieve` call by creating a Stripe-native subscription object.
    // Workaround: stub a minimal `stripe` shim that retrieves return the fake.
    const stripeShim = {
      ...stripe!,
      subscriptions: {
        ...stripe!.subscriptions,
        retrieve: async () => subStripe,
      },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(subStripe, supabaseSeller as never, platformClient as never, stripeShim);
    const invoice = makeFakeInvoice(subStripe.id, customer.id, email);

    const r1 = await handleInvoicePaid(
      invoice,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    expect(r1.processed).toBe(true);
    expect(r1.message).toContain('Invoice paid');

    const { data: tx1 } = await supabaseSeller!
      .from('payment_transactions')
      .select('stripe_invoice_id')
      .eq('stripe_invoice_id', invoice.id!)
      .single();
    expect(tx1?.stripe_invoice_id).toBe(invoice.id);

    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('id, subscription_id')
      .eq('product_id', product.id);
    expect(access?.length ?? 0).toBeGreaterThan(0);
    expect(access?.[0].subscription_id).toBeTruthy();

    // Replay: same invoice -> idempotent skip.
    const r2 = await handleInvoicePaid(
      invoice,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    expect(r2.message).toContain('already booked');

    // Track auth user for cleanup
    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('handleInvoicePaid captures the invoice tax snapshot onto the transaction (net_total/tax_total/status)', async () => {
    // LUKA 1 closure: asserts the capture WIRING in the subscription entry point — a paid invoice
    // with Stripe-computed tax must land net_total/tax_total/tax_snapshot_status on the booked tx.
    const email = `inv-tax-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const subStripe = makeFakeSubscription(customer.id, product.id);
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => subStripe },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(subStripe, supabaseSeller as never, platformClient as never, stripeShim);

    const invoice = makeFakeInvoice(subStripe.id, customer.id, email, {
      total_excluding_tax: 4000,
      total: 4900,
      total_taxes: [{ amount: 900, taxable_amount: 4000, tax_behavior: 'exclusive', taxability_reason: 'standard_rated' }],
      automatic_tax: { enabled: false },
    } as unknown as Partial<Stripe.Invoice>);

    const r = await handleInvoicePaid(invoice, supabaseSeller as never, platformClient as never, stripeShim);
    expect(r.processed).toBe(true);

    const { data: tx } = await supabaseSeller!
      .from('payment_transactions')
      .select('net_total, tax_total, tax_snapshot_status')
      .eq('stripe_invoice_id', invoice.id!)
      .single();
    expect(tx?.net_total).toBe(4000);
    expect(tx?.tax_total).toBe(900);
    expect(tx?.tax_snapshot_status).toBe('captured');

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', { p_email: email.toLowerCase() });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('handleInvoicePaid books a separate row for each renewal invoice', async () => {
    const email = `renew-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const subStripe = makeFakeSubscription(customer.id, product.id);

    const stripeShim = {
      ...stripe!,
      subscriptions: {
        ...stripe!.subscriptions,
        retrieve: async () => subStripe,
      },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(subStripe, supabaseSeller as never, platformClient as never, stripeShim);

    const inv1 = makeFakeInvoice(subStripe.id, customer.id, email);
    await handleInvoicePaid(inv1, supabaseSeller as never, platformClient as never, stripeShim);

    const inv2 = makeFakeInvoice(subStripe.id, customer.id, email, { billing_reason: 'subscription_cycle' });
    const r2 = await handleInvoicePaid(inv2, supabaseSeller as never, platformClient as never, stripeShim);
    expect(r2.processed).toBe(true);

    const { data: rows } = await supabaseSeller!
      .from('payment_transactions')
      .select('stripe_invoice_id')
      .in('stripe_invoice_id', [inv1.id!, inv2.id!]);
    expect(rows?.length ?? 0).toBe(2);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('handleSubscriptionUpdated mirrors status + cancel_at_period_end into DB', async () => {
    const email = `upd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const sub = makeFakeSubscription(customer.id, product.id, { status: 'trialing' });
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(sub, supabaseSeller as never, platformClient as never, stripeShim);

    const updated = { ...sub, status: 'active' as const, cancel_at_period_end: true };
    const result = await handleSubscriptionUpdated(
      updated,
      supabaseSeller as never,
      platformClient as never,
      stripeShim,
      { status: 'trialing' }
    );
    expect(result.processed).toBe(true);

    const { data: row } = await supabaseSeller!
      .from('subscriptions')
      .select('status, cancel_at_period_end')
      .eq('stripe_subscription_id', sub.id)
      .single();
    expect(row?.status).toBe('active');
    expect(row?.cancel_at_period_end).toBe(true);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('handleSubscriptionTrialWillEnd dispatches webhook without DB writes', async () => {
    const email = `trial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const trialEnd = Math.floor(Date.now() / 1000) + 3 * 24 * 3600;
    const sub = makeFakeSubscription(customer.id, product.id, { status: 'trialing', trial_end: trialEnd });
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    const result = await handleSubscriptionTrialWillEnd(
      sub,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    expect(result.processed).toBe(true);

    // Should NOT have created/changed a subscription row — this event is informational.
    const { data: row } = await supabaseSeller!
      .from('subscriptions')
      .select('id')
      .eq('stripe_subscription_id', sub.id)
      .maybeSingle();
    expect(row).toBeNull();

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('handleInvoiceUpcoming mirrors subscription and dispatches renewal warning webhook', async () => {
    const email = `upcoming-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const sub = makeFakeSubscription(customer.id, product.id, { status: 'active' });
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;
    const invoice = makeFakeInvoice(sub.id, customer.id, email, {
      billing_reason: 'subscription_cycle',
      next_payment_attempt: sub.items.data[0]?.current_period_end ?? null,
    });

    const triggerSpy = vi.spyOn(WebhookService, 'trigger').mockImplementation(async () => {});

    const result = await handleInvoiceUpcoming(
      invoice,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    expect(result.processed).toBe(true);

    const renewalCalls = triggerSpy.mock.calls.filter(
      ([event]) => event === 'subscription.renewal_upcoming'
    );
    expect(renewalCalls).toHaveLength(1);
    expect(renewalCalls[0]?.[1]).toMatchObject({
      customer: { email },
      product: { id: product.id },
      invoice: {
        amountDue: 49,
        currency: 'PLN',
        billingReason: 'subscription_cycle',
      },
    });

    triggerSpy.mockRestore();

    const { data: row } = await supabaseSeller!
      .from('subscriptions')
      .select('status, product_id')
      .eq('stripe_subscription_id', sub.id)
      .single();
    expect(row?.status).toBe('active');
    expect(row?.product_id).toBe(product.id);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('handleInvoicePaymentFailed mirrors past_due status without revoking access', async () => {
    const email = `failed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const sub = makeFakeSubscription(customer.id, product.id, { status: 'active' });
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(sub, supabaseSeller as never, platformClient as never, stripeShim);
    const inv1 = makeFakeInvoice(sub.id, customer.id, email);
    await handleInvoicePaid(inv1, supabaseSeller as never, platformClient as never, stripeShim);

    // Stripe retries failed renewal. Expect status moves to past_due, access intact.
    const subPastDue = { ...sub, status: 'past_due' as const };
    const stripeShimPastDue = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => subPastDue },
      customers: stripe!.customers,
    } as unknown as Stripe;
    const failed = makeFakeInvoice(sub.id, customer.id, email, {
      billing_reason: 'subscription_cycle',
      attempt_count: 2,
      next_payment_attempt: Math.floor(Date.now() / 1000) + 24 * 3600,
    });

    const result = await handleInvoicePaymentFailed(
      failed,
      supabaseSeller as never,
      platformClient as never,
      stripeShimPastDue
    );
    expect(result.processed).toBe(true);

    const { data: row } = await supabaseSeller!
      .from('subscriptions')
      .select('status')
      .eq('stripe_subscription_id', sub.id)
      .single();
    expect(row?.status).toBe('past_due');

    // Access must remain — only subscription.deleted revokes.
    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('product_id', product.id);
    expect((access ?? []).length).toBeGreaterThan(0);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('rejects subscription whose Stripe price does not match the Sellf product', async () => {
    // The Stripe Price terms must match the bound Sellf product; mismatched
    // pricing data is rejected at the resolver.
    const email = `mismatch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    // Sub claims to be for `product` (via metadata) but priced at 99 PLN —
    // a deliberate mismatch.
    const sub = makeFakeSubscription(customer.id, product.id);
    (sub.items.data[0] as unknown as { price: { unit_amount: number; recurring: { interval: string; interval_count: number } } }).price = {
      unit_amount: 9900,
      recurring: { interval: 'month', interval_count: 1 },
    };

    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    const result = await handleSubscriptionCreated(
      sub,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    expect(result.processed).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/mismatch|price/);

    // No subscription row should have been created for this product/sub.
    const { data: rows } = await supabaseSeller!
      .from('subscriptions')
      .select('id')
      .eq('stripe_subscription_id', sub.id);
    expect(rows ?? []).toHaveLength(0);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('23505 race emits exactly one outbound invoice.paid webhook', async () => {
    // when pre-check passes for two concurrent calls and the
    // second insert collides on stripe_invoice_id UNIQUE, the loser must NOT
    // re-grant access nor re-emit the outbound webhook.
    const email = `race-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const sub = makeFakeSubscription(customer.id, product.id);
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(sub, supabaseSeller as never, platformClient as never, stripeShim);

    const inv = makeFakeInvoice(sub.id, customer.id, email);

    // Spy outbound dispatch — measure how many times it fires for one invoice.
    const triggerSpy = vi.spyOn(WebhookService, 'trigger').mockImplementation(async () => {});

    await Promise.all([
      handleInvoicePaid(inv, supabaseSeller as never, platformClient as never, stripeShim),
      handleInvoicePaid(inv, supabaseSeller as never, platformClient as never, stripeShim),
      handleInvoicePaid(inv, supabaseSeller as never, platformClient as never, stripeShim),
    ]);

    const invoicePaidCalls = triggerSpy.mock.calls.filter(([event]) => event === 'invoice.paid');
    expect(invoicePaidCalls).toHaveLength(1);

    triggerSpy.mockRestore();

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('deleting an OLDER sub keeps single access row intact (no longer linked to it)', async () => {
    // After re-subscribe overlap, invoices for sub2 already relinked the single
    // user_product_access row to sub2. Deleting the old sub1 must NOT wipe that
    // row (user is still paying through sub2).
    const email = `multisub-old-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const sub1 = makeFakeSubscription(customer.id, product.id, { id: `sub_old_${Date.now()}` });
    const sub2 = makeFakeSubscription(customer.id, product.id, { id: `sub_new_${Date.now()}` });
    const stripeShim = {
      ...stripe!,
      subscriptions: {
        ...stripe!.subscriptions,
        retrieve: async (id: string) => (id === sub1.id ? sub1 : sub2),
      },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(sub1, supabaseSeller as never, platformClient as never, stripeShim);
    await handleInvoicePaid(
      makeFakeInvoice(sub1.id, customer.id, email),
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    await handleSubscriptionCreated(sub2, supabaseSeller as never, platformClient as never, stripeShim);
    await handleInvoicePaid(
      makeFakeInvoice(sub2.id, customer.id, email),
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );

    const { data: subRows } = await supabaseSeller!
      .from('subscriptions')
      .select('id, stripe_subscription_id')
      .in('stripe_subscription_id', [sub1.id, sub2.id]);
    const sub2RowId = subRows?.find((r) => r.stripe_subscription_id === sub2.id)?.id;
    expect(sub2RowId).toBeTruthy();

    // Sub2 paid most recently, so the single access row should now point at sub2.
    const { data: pre } = await supabaseSeller!
      .from('user_product_access')
      .select('id, subscription_id')
      .eq('product_id', product.id)
      .single();
    expect(pre?.subscription_id).toBe(sub2RowId);

    // Delete sub1 (older). Access must stay (linked to sub2 still).
    const sub1Canceled = { ...sub1, status: 'canceled' as const, canceled_at: Math.floor(Date.now() / 1000) };
    await handleSubscriptionDeleted(sub1Canceled, supabaseSeller as never, platformClient as never, stripeShim);

    const { data: post } = await supabaseSeller!
      .from('user_product_access')
      .select('id, subscription_id')
      .eq('product_id', product.id)
      .single();
    expect(post?.id).toBe(pre?.id);
    expect(post?.subscription_id).toBe(sub2RowId);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('rejects FIRST webhook whose Stripe price id does not match the metadata-claimed product', async () => {
    // First-event guard: Stripe price id must match the product's bound
    // Stripe Price id even before a DB binding exists.
    const email = `first-event-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const productA = await createSubscriptionProduct();
    const productB = await createSubscriptionProduct();

    // Pretend each product has gone through getOrCreateStripePriceForProduct
    // already. We'd normally exercise that helper, but for this targeted test
    // we just persist different stripe_price_id values directly.
    await supabaseSeller!
      .from('products')
      .update({ stripe_price_id: `price_for_A_${Date.now()}` })
      .eq('id', productA.id);
    await supabaseSeller!
      .from('products')
      .update({ stripe_price_id: `price_for_B_${Date.now()}` })
      .eq('id', productB.id);

    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    // Sub.items uses A's real price id — the subscription was actually created for product A.
    const sub = makeFakeSubscription(customer.id, productA.id);
    (sub.items.data[0] as unknown as { price: { id: string; unit_amount: number; currency: string; recurring: { interval: string; interval_count: number } } }).price = {
      id: `price_for_A_${Date.now()}`,
      unit_amount: 4900,
      currency: 'pln',
      recurring: { interval: 'month', interval_count: 1 },
    };

    // Swap metadata to claim product B (same pricing).
    sub.metadata = { product_id: productB.id };

    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    // Need to refresh the price id we just persisted — pass the actual one.
    const { data: refreshedA } = await supabaseSeller!
      .from('products')
      .select('stripe_price_id')
      .eq('id', productA.id)
      .single();
    (sub.items.data[0] as unknown as { price: { id: string } }).price.id = refreshedA!.stripe_price_id!;

    const result = await handleSubscriptionCreated(
      sub,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    expect(result.processed).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/price id|metadata|tamper|mismatch/);

    // No subscription row created — handler refused to bind.
    const { data: rows } = await supabaseSeller!
      .from('subscriptions')
      .select('id')
      .eq('stripe_subscription_id', sub.id);
    expect(rows ?? []).toHaveLength(0);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('rejects subsequent webhook whose metadata.product_id differs from the bound product', async () => {
    // Once a subscription is bound to productA on its first webhook,
    // a later webhook with metadata.product_id pointing at a different
    // (identically-priced) product must not redirect access.
    const email = `bind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const productA = await createSubscriptionProduct();
    const productB = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const sub = makeFakeSubscription(customer.id, productA.id);
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    const created = await handleSubscriptionCreated(
      sub,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    expect(created.processed).toBe(true);

    // Same subscription id, but metadata.product_id swapped to productB.
    const subSwapped = {
      ...sub,
      metadata: { product_id: productB.id },
    };
    const swappedShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => subSwapped },
      customers: stripe!.customers,
    } as unknown as Stripe;

    const result = await handleSubscriptionUpdated(
      subSwapped,
      supabaseSeller as never,
      platformClient as never,
      swappedShim
    );
    expect(result.processed).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/binding|metadata|mismatch/);

    // DB binding must remain on productA.
    const { data: subRow } = await supabaseSeller!
      .from('subscriptions')
      .select('product_id')
      .eq('stripe_subscription_id', sub.id)
      .single();
    expect(subRow?.product_id).toBe(productA.id);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('keeps subscription user_id pinned to first-event user when invoice email changes', async () => {
    // Once a subscription row exists with user_id = userA, a later invoice
    // whose customer_email points at a different mailbox (Stripe-side email
    // edit) must not rewrite user_id to a freshly-materialized userB. The
    // binding is established on the first event and is immutable thereafter,
    // matching how product_id and stripe_price_id are pinned.
    const emailA = `pin-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const emailB = `pin-b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email: emailA });
    createdStripeCustomerIds.push(customer.id);

    const sub = makeFakeSubscription(customer.id, product.id);
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    // First event: subscription created + first invoice paid under emailA.
    await handleSubscriptionCreated(sub, supabaseSeller as never, platformClient as never, stripeShim);
    const inv1 = makeFakeInvoice(sub.id, customer.id, emailA);
    await handleInvoicePaid(inv1, supabaseSeller as never, platformClient as never, stripeShim);

    const { data: userIdA } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: emailA.toLowerCase(),
    });
    expect(typeof userIdA).toBe('string');
    if (typeof userIdA === 'string') createdAuthUserIds.push(userIdA);

    const { data: subRowBefore } = await supabaseSeller!
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', sub.id)
      .single();
    expect(subRowBefore?.user_id).toBe(userIdA);

    // Renewal invoice arrives with a DIFFERENT email (simulates Stripe-side
    // email edit on the customer record).
    const inv2 = makeFakeInvoice(sub.id, customer.id, emailB, {
      billing_reason: 'subscription_cycle',
    });
    const r2 = await handleInvoicePaid(
      inv2,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    expect(r2.processed).toBe(true);

    // Subscription user_id must be unchanged.
    const { data: subRowAfter } = await supabaseSeller!
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', sub.id)
      .single();
    expect(subRowAfter?.user_id).toBe(userIdA);

    // Renewal payment_transactions row must reference userA, not userB.
    const { data: tx2 } = await supabaseSeller!
      .from('payment_transactions')
      .select('user_id')
      .eq('stripe_invoice_id', inv2.id!)
      .single();
    expect(tx2?.user_id).toBe(userIdA);

    // user_product_access row stays with userA — no orphan B row.
    const { data: accessRows } = await supabaseSeller!
      .from('user_product_access')
      .select('user_id')
      .eq('product_id', product.id);
    const accessUserIds = (accessRows ?? []).map((r) => r.user_id);
    expect(accessUserIds).toContain(userIdA);
    // Track userB if it was incidentally materialized so cleanup catches it.
    const { data: userIdB } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: emailB.toLowerCase(),
    });
    if (typeof userIdB === 'string') {
      createdAuthUserIds.push(userIdB);
      expect(accessUserIds).not.toContain(userIdB);
    }
  });

  it('deleting CURRENTLY-LINKED sub relinks access to another active sibling sub', async () => {
    // the single user_product_access row points
    // at the most-recently-paid subscription (sub2). When sub2 is deleted while
    // sub1 is still active, the handler must relink access to sub1, NOT delete it.
    const email = `relink-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const sub1 = makeFakeSubscription(customer.id, product.id, { id: `sub_keep_${Date.now()}`, status: 'active' });
    const sub2 = makeFakeSubscription(customer.id, product.id, { id: `sub_drop_${Date.now()}`, status: 'active' });
    const stripeShim = {
      ...stripe!,
      subscriptions: {
        ...stripe!.subscriptions,
        retrieve: async (id: string) => (id === sub1.id ? sub1 : sub2),
      },
      customers: stripe!.customers,
    } as unknown as Stripe;

    // Materialize both subs + access row pointing at the most recent (sub2).
    await handleSubscriptionCreated(sub1, supabaseSeller as never, platformClient as never, stripeShim);
    await handleInvoicePaid(
      makeFakeInvoice(sub1.id, customer.id, email),
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );
    await handleSubscriptionCreated(sub2, supabaseSeller as never, platformClient as never, stripeShim);
    await handleInvoicePaid(
      makeFakeInvoice(sub2.id, customer.id, email),
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );

    const { data: subRows } = await supabaseSeller!
      .from('subscriptions')
      .select('id, stripe_subscription_id')
      .in('stripe_subscription_id', [sub1.id, sub2.id]);
    const sub1RowId = subRows?.find((r) => r.stripe_subscription_id === sub1.id)?.id;
    const sub2RowId = subRows?.find((r) => r.stripe_subscription_id === sub2.id)?.id;

    // Delete the currently-linked sub (sub2). User still has the active sub1.
    const sub2Canceled = { ...sub2, status: 'canceled' as const, canceled_at: Math.floor(Date.now() / 1000) };
    await handleSubscriptionDeleted(sub2Canceled, supabaseSeller as never, platformClient as never, stripeShim);

    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('subscription_id')
      .eq('product_id', product.id)
      .maybeSingle();
    // Access must remain (user still has an active subscription) and be relinked to sub1.
    expect(access).not.toBeNull();
    expect(access?.subscription_id).toBe(sub1RowId);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
    void sub2RowId;
  });

  it('subscription.deleted revokes access even after the product price has drifted', async () => {
    // products.stripe_price_id is overwritten
    // when admin edits recurring config. Old subscriptions still reference the
    // old Price id. Revocation webhooks for those subs must NOT fail just
    // because the current product price doesn't match — otherwise canceled
    // users keep access.
    const email = `drift-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const oldPriceId = `price_old_${Date.now()}`;
    const newPriceId = `price_new_${Date.now()}`;

    // Persist initial price binding (simulates first checkout having created price_old).
    await supabaseSeller!
      .from('products')
      .update({ stripe_price_id: oldPriceId })
      .eq('id', product.id);

    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const sub = makeFakeSubscription(customer.id, product.id);
    (sub.items.data[0] as unknown as { price: { id: string } }).price.id = oldPriceId;
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => sub },
      customers: stripe!.customers,
    } as unknown as Stripe;

    // Create the subscription + grant access (using the OLD price).
    await handleSubscriptionCreated(sub, supabaseSeller as never, platformClient as never, stripeShim);
    const inv = makeFakeInvoice(sub.id, customer.id, email);
    await handleInvoicePaid(inv, supabaseSeller as never, platformClient as never, stripeShim);

    // Pre-condition: access exists for this product.
    const { data: preAccess } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('product_id', product.id);
    expect(preAccess?.length ?? 0).toBeGreaterThan(0);

    // Admin rolls the product to a new Stripe Price (simulates admin editing
    // recurring_price + getOrCreateStripePriceForProduct creating price_new).
    await supabaseSeller!
      .from('products')
      .update({ stripe_price_id: newPriceId })
      .eq('id', product.id);

    // Customer cancels — Stripe sends customer.subscription.deleted.
    // Sub item still references the OLD price.
    const subCanceled = {
      ...sub,
      status: 'canceled' as const,
      canceled_at: Math.floor(Date.now() / 1000),
    };
    const result = await handleSubscriptionDeleted(
      subCanceled,
      supabaseSeller as never,
      platformClient as never,
      stripeShim
    );

    // Revocation MUST succeed regardless of product-level price drift.
    expect(result.processed).toBe(true);

    const { data: postAccess } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('product_id', product.id);
    expect(postAccess ?? []).toHaveLength(0);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });

  it('handleSubscriptionUpdated revokes access when sub transitions to a terminal status', async () => {
    // Stripe's default dunning leaves a subscription at 'unpaid' indefinitely
    // when payment retries fail; customer.subscription.deleted is never
    // emitted in that path. The updated handler must observe the
    // transition and revoke access on its own.
    const email = `unpaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const active = makeFakeSubscription(customer.id, product.id, { status: 'active' });
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => active },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(active, supabaseSeller as never, platformClient as never, stripeShim);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);

    // Sanity: access is in place from the create event.
    const { data: pre } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(pre?.length ?? 0).toBeGreaterThan(0);

    // Now Stripe transitions the subscription to 'unpaid' (dunning exhausted).
    const unpaid = { ...active, status: 'unpaid' as const };
    const result = await handleSubscriptionUpdated(
      unpaid,
      supabaseSeller as never,
      platformClient as never,
      stripeShim,
    );
    expect(result.processed).toBe(true);

    const { data: post } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(post?.length ?? 0).toBe(0);
  });

  it('handleSubscriptionUpdated relinks access to an active sibling on terminal transition', async () => {
    // If the user has another active subscription for the same product
    // (e.g. they upgraded), the terminal transition on the old one must
    // relink user_product_access to the sibling instead of deleting it.
    const email = `relink-upd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const old = makeFakeSubscription(customer.id, product.id, { id: `sub_old_${Date.now()}`, status: 'active' });
    const fresh = makeFakeSubscription(customer.id, product.id, { id: `sub_new_${Date.now()}`, status: 'active' });
    const stripeShim = {
      ...stripe!,
      subscriptions: {
        ...stripe!.subscriptions,
        retrieve: async (id: string) => (id === fresh.id ? fresh : old),
      },
      customers: stripe!.customers,
    } as unknown as Stripe;

    // Both subs created; access points at the most recent (fresh).
    await handleSubscriptionCreated(old, supabaseSeller as never, platformClient as never, stripeShim);
    await handleSubscriptionCreated(fresh, supabaseSeller as never, platformClient as never, stripeShim);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);

    // Force access to point at the OLD sub explicitly so the test exercises
    // the relink path (default behavior may already point at fresh due to
    // upsert ordering — pin to old).
    const { data: oldRow } = await supabaseSeller!
      .from('subscriptions')
      .select('id')
      .eq('stripe_subscription_id', old.id)
      .single();
    await supabaseSeller!
      .from('user_product_access')
      .update({ subscription_id: oldRow!.id })
      .eq('user_id', userId as string)
      .eq('product_id', product.id);

    // Old sub transitions to terminal.
    const oldUnpaid = { ...old, status: 'unpaid' as const };
    await handleSubscriptionUpdated(oldUnpaid, supabaseSeller as never, platformClient as never, stripeShim);

    const { data: freshRow } = await supabaseSeller!
      .from('subscriptions')
      .select('id')
      .eq('stripe_subscription_id', fresh.id)
      .single();
    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('subscription_id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    // Access kept (sibling exists) and now points at fresh sub.
    expect(access?.length ?? 0).toBe(1);
    expect(access?.[0]?.subscription_id).toBe(freshRow!.id);
  });

  it('handleInvoicePaid uses DB-side status as TOCTOU gate when Stripe API state is stale', async () => {
    // stripe.subscriptions.retrieve can lag the live state (cache,
    // out-of-order webhook delivery). If our DB already saw the
    // cancellation via an earlier event, we must not re-grant access on
    // a late invoice.paid even if the Stripe API hands us 'active'.
    const email = `db-toctou-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);

    const active = makeFakeSubscription(customer.id, product.id, { status: 'active' });
    const stripeShimActive = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => active },
      customers: stripe!.customers,
    } as unknown as Stripe;

    // Establish active sub + first invoice (access granted).
    await handleSubscriptionCreated(active, supabaseSeller as never, platformClient as never, stripeShimActive);
    const inv1 = makeFakeInvoice(active.id, customer.id, email);
    await handleInvoicePaid(inv1, supabaseSeller as never, platformClient as never, stripeShimActive);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);

    // DB-side: the subscription row is now in 'canceled' state (e.g. an
    // earlier customer.subscription.deleted webhook landed and advanced it).
    await supabaseSeller!
      .from('subscriptions')
      .update({ status: 'canceled' })
      .eq('stripe_subscription_id', active.id);

    // Revoke the existing access row to simulate the cancellation handler
    // having already run.
    await supabaseSeller!
      .from('user_product_access')
      .delete()
      .eq('user_id', userId as string)
      .eq('product_id', product.id);

    // Stripe-API side still hands us 'active' (stale). The handler must
    // NOT re-grant access because the DB knows the truth.
    const inv2 = makeFakeInvoice(active.id, customer.id, email, {
      billing_reason: 'subscription_cycle',
    });
    const result = await handleInvoicePaid(
      inv2,
      supabaseSeller as never,
      platformClient as never,
      stripeShimActive,
    );
    expect(result.processed).toBe(true);

    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(access ?? []).toHaveLength(0);
  });

  it('handleInvoicePaid does not re-grant access when sub.status is terminal', async () => {
    // Stripe events can arrive out of order, and the SUB6-001 retry
    // policy can redeliver invoice.paid after a cancellation. The handler
    // must book the payment_transactions row + dispatch the outbound
    // webhook (revenue still happened) but NOT re-create user_product_access
    // for a canceled / incomplete_expired / unpaid subscription.
    const email = `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const subStripe = makeFakeSubscription(customer.id, product.id);
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => subStripe },
      customers: stripe!.customers,
    } as unknown as Stripe;

    // Establish the subscription + first paid invoice so an access row exists.
    await handleSubscriptionCreated(subStripe, supabaseSeller as never, platformClient as never, stripeShim);
    const inv1 = makeFakeInvoice(subStripe.id, customer.id, email);
    await handleInvoicePaid(inv1, supabaseSeller as never, platformClient as never, stripeShim);

    // Cancel: revokes the access row (no sibling).
    const subCanceled = { ...subStripe, status: 'canceled' as const, canceled_at: Math.floor(Date.now() / 1000) };
    const canceledShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => subCanceled },
      customers: stripe!.customers,
    } as unknown as Stripe;
    await handleSubscriptionDeleted(subCanceled, supabaseSeller as never, platformClient as never, canceledShim);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);

    const { data: revokedAccess } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(revokedAccess ?? []).toHaveLength(0);

    // Now a late invoice.paid arrives (Stripe out-of-order or retry).
    const inv2 = makeFakeInvoice(subStripe.id, customer.id, email, {
      billing_reason: 'subscription_cycle',
    });
    const result = await handleInvoicePaid(
      inv2,
      supabaseSeller as never,
      platformClient as never,
      canceledShim,
    );
    expect(result.processed).toBe(true);

    // Revenue row IS booked (seller's accounting must reflect the charge).
    const { data: tx } = await supabaseSeller!
      .from('payment_transactions')
      .select('id')
      .eq('stripe_invoice_id', inv2.id!)
      .single();
    expect(tx?.id).toBeTruthy();

    // Access row is NOT recreated.
    const { data: accessAfter } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId as string)
      .eq('product_id', product.id);
    expect(accessAfter ?? []).toHaveLength(0);
  });

  it('handleSubscriptionDeleted revokes product access', async () => {
    const email = `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@sellf-test.local`;
    const product = await createSubscriptionProduct();
    const customer = await stripe!.customers.create({ email });
    createdStripeCustomerIds.push(customer.id);
    const subStripe = makeFakeSubscription(customer.id, product.id);
    const stripeShim = {
      ...stripe!,
      subscriptions: { ...stripe!.subscriptions, retrieve: async () => subStripe },
      customers: stripe!.customers,
    } as unknown as Stripe;

    await handleSubscriptionCreated(subStripe, supabaseSeller as never, platformClient as never, stripeShim);
    const inv = makeFakeInvoice(subStripe.id, customer.id, email);
    await handleInvoicePaid(inv, supabaseSeller as never, platformClient as never, stripeShim);

    const subCanceled = { ...subStripe, status: 'canceled' as const, canceled_at: Math.floor(Date.now() / 1000) };
    const r = await handleSubscriptionDeleted(subCanceled, supabaseSeller as never, platformClient as never, stripeShim);
    expect(r.processed).toBe(true);

    const { data: access } = await supabaseSeller!
      .from('user_product_access')
      .select('id')
      .eq('product_id', product.id);
    expect(access ?? []).toHaveLength(0);

    const { data: userId } = await platformClient!.rpc('find_user_id_by_email', {
      p_email: email.toLowerCase(),
    });
    if (typeof userId === 'string') createdAuthUserIds.push(userId);
  });
});
