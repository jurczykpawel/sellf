/** Real test-mode events through the local webhook and persisted outgoing deliveries. */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { APIRequestContext } from '@playwright/test';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { insertTestApiKey } from '../helpers/api-key';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function insert(table: string, value: object) {
  const { data, error } = await db.from(table).insert(value).select().single();
  if (error) throw new Error(error.message);
  return data;
}
async function eventFor(type: Stripe.Event.Type, id: string): Promise<Stripe.Event> {
  let found: Stripe.Event | undefined;
  await expect.poll(async () => {
    found = (await stripe.events.list({ type, limit: 100 })).data.find(event => event.data.object.id === id);
    return !!found;
  }, { timeout: 60000 }).toBe(true);
  return found!;
}
async function deliver(request: APIRequestContext, event: Stripe.Event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  const response = await request.post('/api/webhooks/stripe', { data: payload,
    headers: { 'content-type': 'application/json', 'stripe-signature': signature } });
  expect(response.status(), await response.text()).toBe(200);
}
let receiverSecret = '';
async function outgoing(endpointId: string, eventType: string, reference?: string) {
  let payloads: Array<Record<string, any>> = [];
  await expect.poll(async () => {
    const { data, error } = await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type', eventType);
    if (error) throw new Error(error.message);
    payloads = (data ?? []).map(row => row.payload).filter(payload => !reference
      || payload.data.payment?.id === reference || payload.data.invoice?.stripeInvoiceId === reference || payload.data.subscription?.stripeSubscriptionId === reference);
    const received = readFileSync(`${process.env.STRIPE_LIVE_ARTIFACTS}/deliveries.jsonl`, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const payload of payloads) {
      const delivery = received.find(row => row.body.id === payload.id);
      if (!delivery) return 0;
      const signature = delivery.headers['x-sellf-signature'];
      const timestamp = signature.match(/(?:^|,)t=(\d+)/)?.[1];
      const mac = createHmac('sha256', receiverSecret).update(`${timestamp}.${delivery.rawBody}`).digest('hex');
      expect(signature).toBe(`t=${timestamp},v1=${mac}`);
      expect(delivery.body).toEqual(payload);
    }
    return payloads.length;
  }, { timeout: 30000 }).toBeGreaterThan(0);
  return payloads;
}

test('receiver can confirm a full refund, preserve a partial refund and renew the paid invoice period @J34 @J35 @J36 @J37 @J38', async ({ request }) => {
  test.setTimeout(900000);
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  expect(new URL(process.env.SUPABASE_URL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  const run = randomUUID();
  receiverSecret = run;
  const product = await insert('products', { name: 'Refund invoice contract', slug: `contract-${run}`, price: 11,
    currency: 'PLN', is_active: true, issue_license_on_purchase: false, product_type: 'subscription', recurring_price: 11,
    billing_interval: 'month', billing_interval_count: 1 });
  const endpoint = await insert('webhook_endpoints', { url: `${process.env.STRIPE_LIVE_RECEIVER_URL}/${run}`, secret: run,
    events: ['refund.issued', 'refund.updated', 'invoice.paid', 'subscription.updated', 'subscription.canceled', 'dispute.created', 'dispute.closed'], is_active: true, product_filter_mode: 'selected' });
  await insert('webhook_endpoint_products', { webhook_endpoint_id: endpoint.id, product_id: product.id });
  let clock: Stripe.TestHelpers.TestClock | undefined;
  let stripeProduct: Stripe.Product | undefined;
  let price: Stripe.Price | undefined;
  const visaIntents: string[] = [];
  let buyerId: string | undefined;
  let apiUserId: string | undefined;
  let apiKeyId: string | undefined;
  let apiAdminId: string | undefined;
  try {
    const { data: apiUser, error: apiUserError } = await db.auth.admin.createUser({ email: `api-${run}@example.com`, email_confirm: true });
    if (apiUserError) throw apiUserError;
    apiUserId = apiUser.user!.id;
    const admin = await insert('admin_users', { user_id: apiUserId }); apiAdminId = admin.id;
    const apiKey = `sf_test_${randomBytes(32).toString('hex')}`;
    const apiKeyRow = await insertTestApiKey(db, apiKey, { admin_user_id: admin.id, name: 'Refund contract',
      scopes: [API_SCOPES.PAYMENTS_READ, API_SCOPES.PAYMENTS_REFUND], is_active: true }); apiKeyId = apiKeyRow.data.id;
    const apiHeaders = { Authorization: `Bearer ${apiKey}` };
    for (const refundAmount of [1000, 2345]) {
      const intent = await stripe.paymentIntents.create({ amount: 2345, currency: 'pln', payment_method: 'pm_card_visa',
        payment_method_types: ['card'], confirm: true });
      visaIntents.push(intent.id);
      const transaction = await insert('payment_transactions', { product_id: product.id, amount: intent.amount,
        currency: 'PLN', customer_email: `contract-${run}@example.com`, session_id: intent.id,
        stripe_payment_intent_id: intent.id, status: 'completed' });
      await insert('guest_purchases', { product_id: product.id, customer_email: `contract-${run}@example.com`,
        transaction_amount: intent.amount, session_id: intent.id, transaction_id: transaction.id });
      const refund = await stripe.refunds.create({ payment_intent: intent.id, amount: refundAmount });
      const event = await eventFor('charge.refunded', String(intent.latest_charge));
      expect((event.data.object as Stripe.Charge).refunds).toBeUndefined();
      const payloads = await outgoing(endpoint.id, 'refund.issued', transaction.id);
      const payload = payloads.find(item => item.data.payment.id === transaction.id)!.data;
      expect(payload.refund).toMatchObject({ stripeRefundId: refund.id, status: refund.status,
        amount: refundAmount, totalRefunded: refundAmount, isFullRefund: refundAmount === intent.amount });
      const confirmedFull = payload.refund.status === 'succeeded' && !!payload.refund.stripeRefundId
        && payload.payment.amount > 0 && payload.refund.isFullRefund && payload.refund.totalRefunded >= payload.payment.amount;
      expect(confirmedFull).toBe(refundAmount === intent.amount);
      const guestAccess = await db.from('guest_purchases').select('id').eq('session_id', intent.id);
      expect(guestAccess.error).toBeNull();
      expect(guestAccess.data).toHaveLength(refundAmount === intent.amount ? 0 : 1);
      const { data: stored } = await db.from('payment_transactions').select('refund_id,refund_status,refunded_amount').eq('id', transaction.id).single();
      expect(stored).toEqual({ refund_id: refund.id, refund_status: refund.status, refunded_amount: refundAmount });
      await deliver(request, event);
      expect((await outgoing(endpoint.id, 'refund.issued')).filter(item => item.data.payment.id === transaction.id)).toHaveLength(1);
      if (refundAmount < intent.amount) {
        expect(payload.payment.statusAfter).toBe('partially_refunded');
        const detail = await request.get(`/api/v1/payments/${transaction.id}`, { headers: apiHeaders });
        expect(detail.status()).toBe(200);
        expect((await detail.json()).data).toMatchObject({ status: 'partially_refunded', refund: { id: refund.id, status: 'succeeded', amount: refundAmount } });
        const filtered = await request.get(`/api/v1/payments?status=partially_refunded&search=${encodeURIComponent(transaction.customer_email)}`, { headers: apiHeaders });
        expect(filtered.status()).toBe(200);
        expect((await filtered.json()).data.map((item: { id: string }) => item.id)).toContain(transaction.id);
        const remaining = await request.post(`/api/v1/payments/${transaction.id}/refund`, { headers: apiHeaders, data: { reason: 'requested_by_customer' } });
        expect(remaining.status(), await remaining.text()).toBe(200);
        expect((await remaining.json()).data.refund.amount).toBe(intent.amount - refundAmount);
        await expect.poll(async () => (await outgoing(endpoint.id, 'refund.issued', transaction.id)).length).toBe(2);
        const bothRefunds = await outgoing(endpoint.id, 'refund.issued', transaction.id);
        expect(new Set(bothRefunds.map(item => item.data.refund.stripeRefundId)).size).toBe(2);
      }
    }
    const asyncRefunds: { method: string; transaction: Awaited<ReturnType<typeof insert>>; refund: Stripe.Refund }[] = [];
    for (const method of ['pm_card_pendingRefund', 'pm_card_refundFail']) {
      const intent = await stripe.paymentIntents.create({ amount: 1100, currency: 'pln', payment_method: method,
        payment_method_types: ['card'], confirm: true });
      const transaction = await insert('payment_transactions', { product_id: product.id, amount: intent.amount,
        currency: 'PLN', customer_email: `status-${run}@example.com`, session_id: intent.id,
        stripe_payment_intent_id: intent.id, status: 'completed' });
      const refund = await stripe.refunds.create({ payment_intent: intent.id });
      asyncRefunds.push({ method, transaction, refund });
    }
    for (const { method, transaction, refund } of asyncRefunds) {
      const issued = await outgoing(endpoint.id, 'refund.issued', transaction.id);
      expect(issued).toHaveLength(1);
      expect(issued[0].data.refund).toMatchObject({ stripeRefundId: refund.id, amount: refund.amount, status: refund.status, statusVersion: 1 });
      const finalStatus = method === 'pm_card_pendingRefund' ? 'succeeded' : 'failed';
      await expect.poll(async () => (await stripe.refunds.retrieve(refund.id)).status, { timeout: 300000 }).toBe(finalStatus);
      const updates = await outgoing(endpoint.id, 'refund.updated', transaction.id);
      expect(updates).toHaveLength(1);
      expect(updates[0].data.refund).toMatchObject({ stripeRefundId: refund.id, amount: refund.amount,
        previousStatus: refund.status, status: finalStatus, statusVersion: 2 });
      const finalEvent = await eventFor(finalStatus === 'failed' ? 'refund.failed' : 'refund.updated', refund.id);
      await deliver(request, finalEvent);
      expect(await outgoing(endpoint.id, 'refund.issued', transaction.id)).toHaveLength(1);
      expect(await outgoing(endpoint.id, 'refund.updated', transaction.id)).toHaveLength(1);
    }
    for (const outcome of ['won', 'lost']) {
      const intent = await stripe.paymentIntents.create({ amount: 1100, currency: 'pln', payment_method: 'pm_card_createDispute',
        payment_method_types: ['card'], confirm: true });
      const transaction = await insert('payment_transactions', { product_id: product.id, amount: intent.amount,
        currency: 'PLN', customer_email: `dispute-${run}@example.com`, session_id: intent.id,
        stripe_payment_intent_id: intent.id, status: 'completed' });
      await insert('guest_purchases', { product_id: product.id, customer_email: `dispute-${run}@example.com`,
        transaction_amount: intent.amount, session_id: intent.id, transaction_id: transaction.id });
      const created = (await stripe.events.list({ type: 'charge.dispute.created', limit: 100 })).data
        .find(item => (item.data.object as Stripe.Dispute).charge === intent.latest_charge);
      let dispute: Stripe.Dispute | undefined = created?.data.object as Stripe.Dispute | undefined;
      await expect.poll(async () => {
        dispute = (await stripe.disputes.list({ charge: String(intent.latest_charge) })).data[0];
        return !!dispute;
      }, { timeout: 60000 }).toBe(true);
      await eventFor('charge.dispute.created', dispute!.id);
      const issued = (await outgoing(endpoint.id, 'dispute.created', transaction.id)).find(item => item.data.payment.id === transaction.id)!.data;
      expect(issued.dispute).toMatchObject({ stripeDisputeId: dispute!.id, amount: 1100, currency: 'PLN', accessRevoked: true, accessRestored: false });
      expect(issued.payment.paymentIntentId).toBe(intent.id);
      expect(issued.product.id).toBe(product.id);
      const accessAfterDispute = await db.from('guest_purchases').select('id').eq('session_id', intent.id);
      expect(accessAfterDispute.error).toBeNull();
      expect(accessAfterDispute.data).toHaveLength(0);
      await stripe.disputes.update(dispute!.id, { evidence: { uncategorized_text: outcome === 'won' ? 'winning_evidence' : 'losing_evidence' }, submit: true });
      const closed = await eventFor('charge.dispute.closed', dispute!.id);
      const result = (await outgoing(endpoint.id, 'dispute.closed', transaction.id)).find(item => item.data.payment.id === transaction.id)!.data;
      expect(result.dispute).toMatchObject({ status: outcome, accessRevoked: outcome === 'lost', accessRestored: false });
      await deliver(request, closed);
      expect((await outgoing(endpoint.id, 'dispute.closed')).filter(item => item.data.payment.id === transaction.id)).toHaveLength(1);
    }
    clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
    const email = `renewal-${run}@example.com`;
    const { data: buyer, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    buyerId = buyer.user!.id;
    const customer = await stripe.customers.create({ test_clock: clock.id, email });
    const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
    stripeProduct = await stripe.products.create({ name: 'Recorded renewal contract' });
    price = await stripe.prices.create({ product: stripeProduct.id, currency: 'pln', unit_amount: 1100, recurring: { interval: 'month' } });
    expect((await db.from('products').update({ stripe_product_id: stripeProduct.id, stripe_price_id: price.id }).eq('id', product.id)).error).toBeNull();
    const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }],
      metadata: { product_id: product.id, user_id: buyerId }, default_payment_method: pm.id });
    const advance = async (time: number) => {
      await stripe.testHelpers.testClocks.advance(clock!.id, { frozen_time: time });
      await expect.poll(async () => (await stripe.testHelpers.testClocks.retrieve(clock!.id)).status,
        { timeout: 60000, intervals: [1000, 2000] }).toBe('ready');
    };
    const renewal = sub.items.data[0].current_period_end + 1;
    await advance(renewal);
    await advance(renewal + 3700);
    const invoices = await stripe.invoices.list({ subscription: sub.id });
    const invoice = invoices.data.find(item => item.billing_reason === 'subscription_cycle')!;
    expect(invoice.status).toBe('paid');
    const event = await eventFor('invoice.paid', invoice.id);
    const payload = (await outgoing(endpoint.id, 'invoice.paid', invoice.id))[0].data;
    const line = invoice.lines.data.find(item => item.parent?.subscription_item_details?.subscription === sub.id)!;
    expect(payload.subscription).toMatchObject({ stripeSubscriptionId: sub.id,
      currentPeriodStart: new Date(line.period.start * 1000).toISOString(),
      currentPeriodEnd: new Date(line.period.end * 1000).toISOString() });
    expect(payload.invoice).toMatchObject({ stripeInvoiceId: invoice.id, amountPaid: 11,
      paidAt: new Date(invoice.status_transitions.paid_at! * 1000).toISOString(), billingReason: 'subscription_cycle' });
    expect(payload.customer.userId).toBe(buyerId);
    expect(payload.product.id).toBe(product.id);
    await deliver(request, event);
    expect(await outgoing(endpoint.id, 'invoice.paid', invoice.id)).toHaveLength(1);
    const scheduled = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    await expect.poll(async () => {
      const records = await outgoing(endpoint.id, 'subscription.updated', sub.id);
      return records.find(item => item.data.subscription.cancelAtPeriodEnd)?.data.subscription.endsAt;
    }, { timeout: 30000 }).toBe(new Date(line.period.end * 1000).toISOString());
    expect(scheduled.ended_at).toBeNull();
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
    const bad = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: customer.id });
    await stripe.subscriptions.update(sub.id, { default_payment_method: bad.id });
    const nextRenewal = invoice.lines.data[0].period.end + 1;
    await advance(nextRenewal); await advance(nextRenewal + 3700);
    await expect.poll(async () => (await stripe.subscriptions.retrieve(sub.id)).status, { timeout: 60000 }).toBe('past_due');
    const canceled = await stripe.subscriptions.cancel(sub.id);
    const canceledPayload = (await outgoing(endpoint.id, 'subscription.canceled', sub.id))[0].data.subscription;
    expect(canceledPayload).toMatchObject({ endsAt: new Date(canceled.ended_at! * 1000).toISOString(),
      endedAt: new Date(canceled.ended_at! * 1000).toISOString(), canceledAt: new Date(canceled.canceled_at! * 1000).toISOString() });
    expect(Date.parse(canceledPayload.endsAt)).toBeLessThan(canceled.items.data[0].current_period_end * 1000);
    const remainingAccess = await db.from('user_product_access').select('id').eq('user_id', buyerId).eq('product_id', product.id);
    expect(remainingAccess.data).toHaveLength(0);
  } finally {
    for (const id of visaIntents) {
      const intent = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] });
      const charge = intent.latest_charge as Stripe.Charge | null;
      if (charge && !charge.disputed && charge.amount_refunded < charge.amount) await stripe.refunds.create({ payment_intent: id });
    }
    if (clock) await stripe.testHelpers.testClocks.del(clock.id);
    if (price) await stripe.prices.update(price.id, { active: false });
    if (stripeProduct) await stripe.products.update(stripeProduct.id, { active: false });
    await db.from('webhook_logs').delete().eq('endpoint_id', endpoint.id);
    await db.from('webhook_endpoints').delete().eq('id', endpoint.id);
    await db.from('guest_purchases').delete().eq('product_id', product.id);
    await db.from('payment_transactions').delete().eq('product_id', product.id);
    await db.from('subscriptions').delete().eq('product_id', product.id);
    await db.from('products').delete().eq('id', product.id);
    if (buyerId) await db.auth.admin.deleteUser(buyerId);
    if (apiKeyId) await db.from('api_keys').delete().eq('id', apiKeyId);
    if (apiAdminId) await db.from('admin_actions').delete().eq('admin_id', apiUserId);
    if (apiAdminId) await db.from('admin_users').delete().eq('id', apiAdminId);
    if (apiUserId) await db.auth.admin.deleteUser(apiUserId);
  }
});
