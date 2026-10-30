/** Consumer contract from recorded card/transfer deliveries and authoritative local orders. */
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/invoicing/service', () => ({ issuedInvoice: async () => null, issueInvoiceForTransaction: async () => null }));
vi.mock('@/lib/validations/webhook', async original => ({ ...await original<typeof import('@/lib/validations/webhook')>(), validateWebhookUrlAsync: async (url: string) => ({ valid: url.startsWith('http://127.0.0.1:') }) }));
vi.mock('@/lib/security/safe-fetch', async original => ({ ...await original<typeof import('@/lib/security/safe-fetch')>(), getSsrfSafeAgent: () => undefined }));
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>();
  return { ...actual, authenticate: async () => ({ method: 'api_key', scopes: [actual.API_SCOPES.PAYMENTS_READ], supabase: createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }) };
});

import { fulfillPaidOrder } from '@/lib/services/fulfill-paid-order';
import { dispatchTransferEvent } from '@/lib/orders/bank-transfer-service';
import { GET as paymentList } from '@/app/api/v1/payments/route';
import { GET as paymentDetail } from '@/app/api/v1/payments/[id]/route';
import card from '../../fixtures/business-events/card-purchase.json';
import transfer from '../../fixtures/business-events/transfer-placed.json';
import { webhookReceiver } from '../../helpers/webhook-receiver';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const products: string[] = [], transactions: string[] = [], users: string[] = [];
let endpointId: string, receiver: Awaited<ReturnType<typeof webhookReceiver>>;
beforeAll(async () => {
  const secret = crypto.randomUUID(); receiver = await webhookReceiver(secret);
  const r = await db.from('webhook_endpoints').insert({ url: receiver.url, secret, events: ['purchase.completed', 'order.placed'], product_filter_mode: 'selected', is_active: true }).select('id').single();
  expect(r.error).toBeNull(); endpointId = r.data!.id;
});
afterAll(async () => {
  await db.from('webhook_logs').delete().eq('endpoint_id', endpointId);
  await db.from('webhook_endpoints').delete().eq('id', endpointId);
  if (transactions.length) await db.from('payment_transactions').delete().in('id', transactions);
  if (products.length) { await db.from('bundle_items').delete().in('bundle_product_id', products); await db.from('products').delete().in('id', products); }
  for (const id of users) await db.auth.admin.deleteUser(id);
  await receiver.close();
});
async function order(offline: boolean, onPlacement = false) {
  const recorded = offline ? transfer.payload.data.order : card.payload.data.order;
  const email = `money-contract-${crypto.randomUUID()}@example.com`;
  const p = await db.from('products').insert({ name: offline ? 'Recorded transfer' : card.payload.data.product.name, slug: `money-${crypto.randomUUID()}`, price: recorded.amount / 100, currency: recorded.currency.toUpperCase(), is_active: true }).select('id').single();
  expect(p.error).toBeNull(); const productId = p.data!.id; products.push(productId);
  expect((await db.from('webhook_endpoint_products').insert({ webhook_endpoint_id: endpointId, product_id: productId })).error).toBeNull();
  const t = await db.from('payment_transactions').insert({ product_id: productId, customer_email: email, amount: recorded.amount, currency: recorded.currency.toUpperCase(), pricing_snapshot_version: offline ? 1 : null, status: offline ? 'awaiting_payment' : 'completed', fulfillment_pending: true, payment_provider: offline ? 'bank_transfer' : 'stripe', session_id: offline ? null : card.payload.data.order.sessionId, stripe_payment_intent_id: offline ? null : card.payload.data.order.paymentIntentId, tax_snapshot_status: offline ? 'local' : 'unavailable', net_total: offline ? 10000 : null, tax_total: offline ? 2300 : null, payment_due_at: offline ? transfer.payload.data.order.dueAt : null, transfer_details: offline ? transfer.payload.data.order.transfer : null, order_details: offline ? transfer.payload.data.orderDetails : {}, metadata: { access_on_placement: onPlacement } }).select('*').single();
  expect(t.error).toBeNull(); transactions.push(t.data!.id);
  const line = offline ? transfer.payload.data.lines[0] : null;
  expect((await db.from('payment_line_items').insert({ transaction_id: t.data!.id, product_id: productId, item_type: 'main_product', product_name: 'Recorded product', quantity: 1, currency: recorded.currency.toUpperCase(), unit_price: line?.unit_price ?? recorded.amount / 100, total_price: line?.total_price ?? recorded.amount / 100, discounted_total: line?.discounted_total ?? recorded.amount / 100, net_amount: line?.net_amount ?? null, tax_amount: line?.tax_amount ?? null, vat_rate: line?.vat_rate ?? null, tax_behavior: line?.tax_behavior ?? null })).error).toBeNull();
  return { tx: t.data!, productId, email };
}
it('lets the card consumer reconcile the internal order and distinguish unavailable VAT @J27', async () => {
  const { tx, productId, email } = await order(false);
  // The recorded native PI has no Checkout Session tax source; no provider response is invented.
  const stripe = { checkout: { sessions: { list: async () => { throw Error('No recorded checkout tax source'); } } } } as unknown as Stripe;
  await fulfillPaidOrder({ supabase: db, transactionId: tx.id, productId, customerEmail: email, amount: tx.amount, currency: tx.currency, provider: { kind: 'stripe', stripe, sessionId: tx.session_id!, paymentIntentId: tx.stripe_payment_intent_id } });
  const data = receiver.received.find(event => event.event === 'purchase.completed' && event.data.customer.email === email)!.data;
  expect(data.order.orderId).toBe(tx.id); expect(data.order.orderNumber).toBe(tx.order_number);
  expect(data.amountUnit).toBe('minor'); expect(data.product.price).toBe(2345);
  expect(data.order).toMatchObject({ amount: 2345, grossTotal: 2345, netTotal: null, taxTotal: null, taxSnapshotStatus: 'unavailable' });
});
it('sends minor units, VAT quality and an explicit transfer access policy @J28', async () => {
  const { tx } = await order(true, false);
  await dispatchTransferEvent(db, tx.id, 'order.placed');
  const data = receiver.received.find(event => event.event === 'order.placed' && event.data.order.orderId === tx.id)!.data;
  expect(data.amountUnit).toBe('minor');
  expect(data.order).toMatchObject({ orderId: tx.id, orderNumber: tx.order_number, amount: 12300, grossTotal: 12300, netTotal: 10000, taxTotal: 2300, taxSnapshotStatus: 'local' });
  expect(data.lines[0]).toMatchObject({ unit_price: 12300, total_price: 12300, discounted_total: 12300, net_amount: 10000, tax_amount: 2300, vat_rate: 23 });
  expect(data.access).toMatchObject({ policy: 'after_payment', grants: [{ productId: tx.product_id, status: 'pending_payment', grantedAt: null, expiresAt: null }] });
});
it('returns the same order/provider/line data from a single-payment GET @J30', async () => {
  const { tx } = await order(true);
  const result = await paymentDetail(new NextRequest(`http://localhost/api/v1/payments/${tx.id}`), { params: Promise.resolve({ id: tx.id }) });
  expect(result.status).toBe(200); const { data } = await result.json();
  expect(data).toMatchObject({ order_number: tx.order_number, payment_provider: 'bank_transfer', payment_due_at: tx.payment_due_at, transfer_details: tx.transfer_details, order_details: tx.order_details });
  const listed = (await (await paymentList(new NextRequest(`http://localhost/api/v1/payments?email=${encodeURIComponent(tx.customer_email)}`))).json()).data[0];
  expect(data).toMatchObject(listed);
  expect(data.line_items).toHaveLength(1); expect(data.line_items[0]).toMatchObject({ transaction_id: tx.id, unit_price: 123, net_amount: 10000, tax_amount: 2300 });
});

it('includes the saved entitlement dates when transfer access was granted on placement @J29', async () => {
  const { tx, productId, email } = await order(true, true);
  const u = await db.auth.admin.createUser({ email, email_confirm: true }); expect(u.error).toBeNull(); users.push(u.data.user!.id);
  const access = await db.from('user_product_access').insert({ user_id: u.data.user!.id, product_id: productId, transfer_transaction_id: tx.id, access_expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }).select('access_granted_at,access_expires_at').single();
  expect(access.error).toBeNull();
  await dispatchTransferEvent(db, tx.id, 'order.placed');
  const data = receiver.received.find(e => e.event === 'order.placed' && e.data.order.orderId === tx.id)!.data;
  expect(data.access).toMatchObject({ policy: 'on_placement', grants: [{ productId, status: 'granted', grantedAt: access.data!.access_granted_at, expiresAt: access.data!.access_expires_at }] });
  expect((await db.from('payment_transactions').update({ status: 'completed' }).eq('id', tx.id)).error).toBeNull();
  await fulfillPaidOrder({ supabase: db, transactionId: tx.id, productId, customerEmail: email, amount: tx.amount, currency: tx.currency, provider: { kind: 'offline' } });
  const paid = receiver.received.find(e => e.event === 'purchase.completed' && e.data.order.orderId === tx.id)!.data;
  expect(paid.order).toMatchObject({ orderNumber: tx.order_number, grossTotal: 12300, netTotal: 10000, taxTotal: 2300, taxSnapshotStatus: 'local' });
  expect(paid.product).toMatchObject({ price: 12300, net: 10000, tax: 2300, gross: 12300, vatRate: 23 });
});
it('includes bundle components from the corresponding list entry in the detail response', async () => {
  const { tx, productId } = await order(true);
  const component = await db.from('products').insert({ name: 'Recorded component', slug: `component-${crypto.randomUUID()}`, price: 19, currency: 'PLN' }).select('id').single(); expect(component.error).toBeNull(); products.push(component.data!.id);
  expect((await db.from('products').update({ is_bundle: true }).eq('id', productId)).error).toBeNull();
  expect((await db.from('bundle_items').insert({ bundle_product_id: productId, component_product_id: component.data!.id })).error).toBeNull();
  const data = (await (await paymentDetail(new NextRequest(`http://localhost/api/v1/payments/${tx.id}`), { params: Promise.resolve({ id: tx.id }) })).json()).data;
  expect(data.product).toMatchObject({ is_bundle: true, bundle_components: [{ name: 'Recorded component', slug: expect.stringContaining('component-') }] });
});
