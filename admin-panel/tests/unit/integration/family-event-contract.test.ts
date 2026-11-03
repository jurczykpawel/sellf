/** Invoice, partner, refund-request and catalogue changes observed by a signed external receiver. */
import { execFileSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const ctx = vi.hoisted(() => ({ client: undefined as unknown, actor: 'a1340000-0000-4000-a000-000000000001' }));
vi.mock('@/lib/api', async original => {
  const api = await original<typeof import('@/lib/api')>();
  return { ...api, authenticate: async () => ({ method: 'api_key', apiKey: { id: ctx.actor }, admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, scopes: [api.API_SCOPES.PRODUCTS_WRITE, api.API_SCOPES.REFUND_REQUESTS_WRITE], supabase: ctx.client }) };
});
vi.mock('@/lib/rate-limiting', async original => ({ ...await original<typeof import('@/lib/rate-limiting')>(), checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/validations/webhook', async original => ({ ...await original<typeof import('@/lib/validations/webhook')>(), validateWebhookUrlAsync: async (url: string) => ({ valid: url.startsWith('http://127.0.0.1:') }) }));
vi.mock('@/lib/stripe/affiliate-mode', () => ({ getAffiliateLivemode: async () => true }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (c: unknown) => unknown) => fn({ user: { id: 'dddddddd-0000-4000-a000-000000000000' }, dataClient: ctx.client }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/security/safe-fetch', async original => ({ ...await original<typeof import('@/lib/security/safe-fetch')>(), getSsrfSafeAgent: () => undefined }));

import { GET as cron } from '@/app/api/cron/route';
import { PATCH as patchProduct } from '@/app/api/v1/products/[id]/route';
import { PATCH as decideRefund } from '@/app/api/v1/refund-requests/[id]/route';
import { reservePayout, markPayoutPaid, cancelPayout } from '@/lib/affiliates/payouts/actions';
import { webhookReceiver } from '../../helpers/webhook-receiver';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
ctx.client = db;
const FAMILY = ['invoicing.issued', 'invoicing.failed', 'invoicing.corrected', 'commission.accrued', 'commission.reversed',
  'payout.reserved', 'payout.paid', 'payout.cancelled', 'refund.requested', 'refund.request_approved', 'refund.request_rejected',
  'refund.request_cancelled', 'product.published', 'product.unpublished', 'product.price_changed', 'product.sold_out'];
const cronSecret = crypto.randomUUID();
const users: string[] = [], products: string[] = [];
let endpointId: string, receiver: Awaited<ReturnType<typeof webhookReceiver>>;
function sql(query: string): string {
  return execFileSync('docker', ['exec', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim();
}
const drain = () => cron(new NextRequest('http://localhost/api/cron?job=business-events', { headers: { Authorization: `Bearer ${cronSecret}` } }));
const events = (name: string, match: (data: Record<string, any>) => boolean) => receiver.received.filter(e => e.event === name && match(e.data));

beforeAll(async () => {
  vi.stubEnv('CRON_SECRET', cronSecret);
  await db.from('business_events').update({ dispatched_at: new Date().toISOString(), leased_until: null }).is('dispatched_at', null);
  const secret = crypto.randomUUID(); receiver = await webhookReceiver(secret);
  const endpoint = await db.from('webhook_endpoints').insert({ url: receiver.url, secret, is_active: true, product_filter_mode: 'all', events: FAMILY }).select('id').single();
  expect(endpoint.error).toBeNull(); endpointId = endpoint.data!.id;
});
afterAll(async () => {
  await db.from('webhook_logs').delete().eq('endpoint_id', endpointId);
  await db.from('webhook_endpoints').delete().eq('id', endpointId);
  for (const id of users) await db.auth.admin.deleteUser(id);
  await receiver.close(); vi.unstubAllEnvs();
});
async function product(values: Record<string, unknown> = {}) {
  const r = await db.from('products').insert({ name: 'Family contract', slug: `family-${crypto.randomUUID()}`, price: 49, currency: 'PLN', is_active: true, is_refundable: true, refund_period_days: 30, ...values }).select('id,slug').single();
  expect(r.error).toBeNull(); products.push(r.data!.id); return r.data!;
}
async function buyer() {
  const email = `family-${crypto.randomUUID()}@example.com`, password = crypto.randomUUID();
  const r = await db.auth.admin.createUser({ email, password, email_confirm: true }); expect(r.error).toBeNull(); users.push(r.data.user!.id);
  return { id: r.data.user!.id, email, password };
}
async function order(productId: string, userId: string | null, email: string, amount = 4900) {
  const r = await db.from('payment_transactions').insert({ product_id: productId, user_id: userId, customer_email: email, amount, currency: 'PLN', status: 'completed', session_id: `cs_family_${crypto.randomUUID().replaceAll("-", "")}` }).select('id,order_number').single();
  expect(r.error).toBeNull(); return r.data!;
}

it('tells the receiver when a sales invoice is issued, fails per attempt and is corrected, once per transition @J160', async () => {
  const p = await product(), tx = await order(p.id, null, 'invoice-buyer@example.com', 12300);
  const id = sql(`INSERT INTO public.invoices(transaction_id,provider,external_key,provider_domain) VALUES('${tx.id}','fakturownia','w134:${tx.id}','w134.fakturownia.pl') RETURNING id`);
  sql(`UPDATE public.invoices SET status='failed',error='Provider timeout' WHERE id='${id}'`);
  sql(`UPDATE public.invoices SET status='issuing',attempts=2 WHERE id='${id}'`);
  sql(`UPDATE public.invoices SET status='issued',provider_invoice_id='998877',number='FV/1/2026',view_url='https://w134.fakturownia.pl/invoice/998877',error=NULL WHERE id='${id}'`);
  sql(`UPDATE public.invoices SET updated_at=now() WHERE id='${id}'`); // no status change, no event
  sql(`UPDATE public.invoices SET status='corrected' WHERE id='${id}'`);
  await drain(); await drain();
  const mine = (e: Record<string, any>) => e.invoice?.id === id;
  const [failed] = events('invoicing.failed', mine), [issued] = events('invoicing.issued', mine), [corrected] = events('invoicing.corrected', mine);
  expect(events('invoicing.failed', mine)).toHaveLength(1);
  expect(failed.data).toMatchObject({ amountUnit: 'minor', invoice: { statusBefore: 'issuing', statusAfter: 'failed', attempt: 1, error: 'Provider timeout', willRetry: true }, order: { orderId: tx.id, orderNumber: tx.order_number, amount: 12300, currency: 'PLN' }, product: { id: p.id } });
  expect(issued.data).toMatchObject({ invoice: { statusAfter: 'issued', attempt: 2, providerInvoiceId: '998877', number: 'FV/1/2026', viewUrl: expect.stringContaining('998877') }, customer: { email: 'invoice-buyer@example.com' } });
  expect(issued.data.invoice.error).toBeNull();
  expect(corrected.data.invoice).toMatchObject({ statusBefore: 'issued', statusAfter: 'corrected', number: 'FV/1/2026' });
});

it('tells the receiver about a submitted, rejected and approved refund request with amounts in minor units @J161', async () => {
  const p = await product(), u = await buyer(), tx = await order(p.id, u.id, u.email);
  const session = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  expect((await session.auth.signInWithPassword({ email: u.email, password: u.password })).error).toBeNull();
  const created = await session.rpc('create_refund_request', { transaction_id_param: tx.id, reason_param: 'Not what I expected' });
  expect(created.data?.success).toBe(true);
  const requestId = created.data.request_id as string;
  const rejected = await decideRefund(new NextRequest(`http://localhost/api/v1/refund-requests/${requestId}`, { method: 'PATCH', body: JSON.stringify({ action: 'reject', admin_response: 'Course already consumed' }) }), { params: Promise.resolve({ id: requestId }) });
  expect(rejected.status).toBe(200);
  const tx2 = await order(p.id, u.id, u.email, 2500);
  const second = await session.rpc('create_refund_request', { transaction_id_param: tx2.id, reason_param: null });
  sql(`UPDATE public.refund_requests SET status='approved',processed_at=now() WHERE id='${second.data.request_id}'`);
  await drain(); await drain();
  const mine = (id: string) => (e: Record<string, any>) => e.refundRequest?.id === id;
  const [submitted] = events('refund.requested', mine(requestId)), [decided] = events('refund.request_rejected', mine(requestId));
  expect(submitted.data).toMatchObject({ amountUnit: 'minor', refundRequest: { statusBefore: 'none', statusAfter: 'pending', requestedAmount: 4900, currency: 'PLN', reason: 'Not what I expected' }, order: { orderId: tx.id, orderNumber: tx.order_number }, customer: { userId: u.id, email: u.email }, product: { id: p.id, slug: p.slug } });
  expect(decided.data).toMatchObject({ refundRequest: { statusBefore: 'pending', statusAfter: 'rejected', adminResponse: 'Course already consumed', processedAt: expect.any(String) }, actor: { type: expect.any(String) } });
  expect(events('refund.request_approved', mine(second.data.request_id))[0].data.refundRequest).toMatchObject({ statusAfter: 'approved', requestedAmount: 2500 });
  expect(events('refund.requested', mine(requestId))).toHaveLength(1);
});

it('tells the receiver when a partner commission accrues, is reserved, paid, reversed after a refund and a payout is cancelled @J162', async () => {
  const user = await buyer();
  const member = crypto.randomUUID(), coupon = crypto.randomUUID(), p = await product({ price: 123, refund_period_days: 60 });
  sql(`INSERT INTO public.affiliate_memberships(id,user_id,code,status,display_name,accepted_terms_version,accepted_at,created_at)
       SELECT '${member}','${user.id}','w134-${member.slice(0, 8)}','approved','W134 Partner',terms_version,'2026-01-01','2026-01-01' FROM public.affiliate_programs LIMIT 1;
       INSERT INTO public.affiliate_membership_events(member_id,version,status,created_at) VALUES('${member}',1,'approved','2026-01-01');
       INSERT INTO public.affiliate_rules(product_id,revision,enabled,percentage_bps,created_at) VALUES('${p.id}',1,true,2000,'2026-01-01');
       INSERT INTO public.coupons(id,code,name,discount_type,discount_value,is_active) VALUES('${coupon}','W134${member.slice(0, 6).toUpperCase()}','W134','percentage',10,true);
       INSERT INTO public.affiliate_coupon_bindings(coupon_id,member_id,version,created_at) VALUES('${coupon}','${member}',1,'2026-01-01');`);
  const payments = [await order(p.id, null, 'partner-customer@example.com', 12300), await order(p.id, null, 'partner-customer@example.com', 12300)];
  for (const tx of payments) sql(`INSERT INTO public.payment_line_items(transaction_id,product_id,item_type,quantity,unit_price,total_price,currency,net_amount,tax_amount) VALUES('${tx.id}','${p.id}','main_product',1,123,123,'PLN',10000,2300);
    INSERT INTO public.coupon_redemptions(coupon_id,transaction_id,customer_email,discount_amount,redeemed_at) VALUES('${coupon}','${tx.id}','partner-customer@example.com',10,now()-interval '90 days');`);
  const sync = () => sql("SELECT count(public.affiliate_apply_sync(payment_id,lease_token,requested_generation,'2026-01-02',true)) FROM public.affiliate_claim_work(100)");
  sync();
  const cutoff = () => new Date(sql('SELECT clock_timestamp()')).toISOString();
  const base = { member_id: member, currency: 'PLN', member_version: '1', program_version: sql('SELECT version FROM public.affiliate_programs LIMIT 1'), payee_reference: 'w134-payee' };
  // First reservation is cancelled without a transfer, the second is paid.
  const first = await reservePayout({ ...base, cutoff: cutoff() });
  expect(first.success).toBe(true);
  expect((await cancelPayout({ payout_id: first.data!.id, version: first.data!.version, no_transfer: true, reason: 'Bank checked' })).success).toBe(true);
  const reserved = await reservePayout({ ...base, cutoff: cutoff() });
  expect(reserved.success).toBe(true);
  const paidResult = await markPayoutPaid({ payout_id: reserved.data!.id, version: reserved.data!.version, bank_reference: `bank-${member.slice(0, 8)}`, invoice_reference: `invoice-${member.slice(0, 8)}`, bank_amount_minor: reserved.data!.earnings_minor, currency: 'PLN', paid_at: '2026-10-01T12:00:00Z', full_settlement: true });
  expect(paidResult, JSON.stringify(paidResult)).toMatchObject({ success: true });
  sql(`UPDATE public.payment_transactions SET refunded_amount=12300 WHERE id='${payments[1].id}'`); sync();
  await drain(); await drain();
  const ofMember = (e: Record<string, any>) => e.partner?.memberId === member;
  const accrued = events('commission.accrued', ofMember);
  expect(accrued).toHaveLength(2);
  expect(accrued[0].data).toMatchObject({ amountUnit: 'minor', partner: { memberId: member, code: expect.any(String), displayName: 'W134 Partner' }, commission: { id: expect.any(String), amount: 2000, currency: 'PLN', eligibleAt: expect.any(String) }, order: { orderId: expect.any(String) }, product: { id: p.id } });
  const reservedEvents = events('payout.reserved', ofMember);
  expect(reservedEvents.map(e => e.data.payout.id)).toEqual([first.data!.id, reserved.data!.id]);
  expect(reservedEvents[1].data.payout).toMatchObject({ statusBefore: 'none', statusAfter: 'reserved', amount: 4000, currency: 'PLN', commissionIds: expect.arrayContaining(accrued.map(e => e.data.commission.id)) });
  expect(events('payout.cancelled', ofMember).map(e => e.data.payout)).toEqual([expect.objectContaining({ id: first.data!.id, statusBefore: 'reserved', statusAfter: 'cancelled' })]);
  expect(events('payout.paid', ofMember)[0].data.payout).toMatchObject({ id: reserved.data!.id, statusBefore: 'reserved', statusAfter: 'paid', bankReference: `bank-${member.slice(0, 8)}`, invoiceReference: `invoice-${member.slice(0, 8)}`, bankAmount: 4000, paidAt: expect.any(String) });
  const [reversed] = events('commission.reversed', ofMember);
  expect(reversed.data).toMatchObject({ order: { orderId: payments[1].id }, commission: { currency: 'PLN', amount: -2000 } });
  const paidDeliveries = await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type', 'payout.paid');
  expect(paidDeliveries.data!.filter(r => (r.payload as any).data.partner.memberId === member)).toHaveLength(1);
});

it('tells the receiver when a product is published, withdrawn, repriced and sold out, without duplicates on retry @J163', async () => {
  const p = await product({ is_active: false, price: 100 });
  const call = (body: unknown) => patchProduct(new NextRequest(`http://localhost/api/v1/products/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: p.id }) });
  expect((await call({ is_active: true })).status).toBe(200);
  expect((await call({ price: 120 })).status).toBe(200);
  expect((await call({ description: 'Same price, new copy' })).status).toBe(200);
  expect((await call({ is_active: false })).status).toBe(200);
  const ev = await product({ event_mode: true, price: 10 });
  const session = sql(`INSERT INTO public.product_sessions(product_id,starts_at,capacity,title) VALUES('${ev.id}',now()+interval '10 days',3,'W134 workshop') RETURNING id`);
  const tier = sql(`INSERT INTO public.product_price_tiers(session_id,label,price,sort) VALUES('${session}','Standard',10,0) RETURNING id`);
  const tx = await order(ev.id, null, 'seat-buyer@example.com', 3000);
  sql(`INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,expires_at) VALUES('${session}','${tier}','${tx.id}',2,'held',now()+interval '15 minutes')`);
  const tx2 = await order(ev.id, null, 'seat-buyer2@example.com', 1000);
  sql(`INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,expires_at) VALUES('${session}','${tier}','${tx2.id}',1,'held',now()+interval '15 minutes')`);
  sql(`UPDATE public.seat_reservations SET status='confirmed',confirmed_at=now() WHERE transaction_id='${tx2.id}'`);
  await drain();
  // A redelivered queue entry must not reach the receiver twice.
  sql(`UPDATE public.business_events SET dispatched_at=NULL,leased_until=NULL WHERE product_id IN ('${p.id}','${ev.id}')`);
  await drain();
  const mine = (id: string) => (e: Record<string, any>) => e.product?.id === id;
  expect(events('product.published', mine(p.id))).toHaveLength(1);
  expect(events('product.published', mine(p.id))[0].data).toMatchObject({ product: { id: p.id, slug: p.slug, isActive: true }, availability: { before: 'unpublished', after: 'published' }, actor: { type: expect.any(String) } });
  const priced = events('product.price_changed', mine(p.id));
  expect(priced).toHaveLength(1);
  expect(priced[0].data).toMatchObject({ amountUnit: 'minor', price: { before: { price: 10000, salePrice: null, currency: 'PLN' }, after: { price: 12000, currency: 'PLN' } } });
  expect(events('product.unpublished', mine(p.id))[0].data.availability).toEqual({ before: 'published', after: 'unpublished' });
  const sold = events('product.sold_out', mine(ev.id));
  expect(sold).toHaveLength(1);
  expect(sold[0].data).toMatchObject({ session: { id: session, capacity: 3, remaining: 0, label: 'W134 workshop' } });
  for (const [name, id] of [['product.published', p.id], ['product.price_changed', p.id], ['product.sold_out', ev.id]]) {
    const rows = await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type', name);
    expect(rows.data!.filter(r => (r.payload as any).data.product.id === id)).toHaveLength(1);
  }
});
