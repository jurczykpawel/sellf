/** Durable access and reservation changes observed by an external HTTP consumer. */
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const actor = vi.hoisted(() => ({ id: 'a1080000-0000-4000-a000-000000000001' }));
vi.mock('@/lib/api', async original => {
  const api = await original<typeof import('@/lib/api')>();
  return { ...api, authenticate: async () => ({ method: 'api_key', apiKey: { id: actor.id }, admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, scopes: [api.API_SCOPES.USERS_WRITE], supabase: createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }) };
});
vi.mock('@/lib/rate-limiting', async original => ({ ...await original<typeof import('@/lib/rate-limiting')>(), checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/validations/webhook', async original => ({ ...await original<typeof import('@/lib/validations/webhook')>(), validateWebhookUrlAsync: async (url: string) => ({ valid: url.startsWith('http://127.0.0.1:') }) }));
vi.mock('@/lib/security/safe-fetch', async original => ({ ...await original<typeof import('@/lib/security/safe-fetch')>(), getSsrfSafeAgent: () => undefined }));

import { GET as cron } from '@/app/api/cron/route';
import { POST as grant } from '@/app/api/v1/users/[id]/access/route';
import { PATCH as update, DELETE as revoke } from '@/app/api/v1/users/[id]/access/[accessId]/route';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';
import { abandonPendingCheckoutSession } from '@/lib/stripe/checkout-expiration';
import { webhookReceiver } from '../../helpers/webhook-receiver';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const users: string[] = [], products: string[] = [];
let endpointId: string, receiver: Awaited<ReturnType<typeof webhookReceiver>>;
const cronSecret = crypto.randomUUID();
beforeAll(async () => {
  vi.stubEnv('CRON_SECRET', cronSecret);
  // Earlier isolated suites may leave committed fixture history after cleanup.
  await db.from('business_events').update({ dispatched_at: new Date().toISOString(), leased_until: null }).is('dispatched_at', null);
  const secret = crypto.randomUUID(); receiver = await webhookReceiver(secret);
  const endpoint = await db.from('webhook_endpoints').insert({ url: receiver.url, secret, is_active: true, product_filter_mode: 'selected', events: ['access.granted', 'access.updated', 'access.revoked', 'access.expired', 'order.abandoned', 'seats.held', 'seats.confirmed', 'seats.released'] }).select('id').single();
  expect(endpoint.error).toBeNull(); endpointId = endpoint.data!.id;
});
afterAll(async () => {
  await db.from('webhook_logs').delete().eq('endpoint_id', endpointId);
  await db.from('webhook_endpoints').delete().eq('id', endpointId);
  for (const id of users) await db.auth.admin.deleteUser(id);
  if (products.length) await db.from('bundle_items').delete().in('bundle_product_id', products);
  for (const id of products) {
    await db.from('payment_transactions').delete().eq('product_id', id);
    await db.from('product_sessions').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
  await receiver.close(); vi.unstubAllEnvs();
});
async function product(event = false) {
  const r = await db.from('products').insert({ name: 'Event contract', slug: `contract-${crypto.randomUUID()}`, price: 19, currency: 'PLN', is_active: true, event_mode: event, auto_grant_duration_days: 7 }).select('id,slug').single();
  expect(r.error).toBeNull(); products.push(r.data!.id);
  expect((await db.from('webhook_endpoint_products').insert({ webhook_endpoint_id: endpointId, product_id: r.data!.id })).error).toBeNull();
  return r.data!;
}
async function user(email = `access-${crypto.randomUUID()}@example.com`) {
  const r = await db.auth.admin.createUser({ email, email_confirm: true }); expect(r.error).toBeNull(); users.push(r.data.user!.id); return r.data.user!;
}
async function drain(job = 'business-events') {
  return cron(new NextRequest(`http://localhost/api/cron?job=${job}`, { headers: { Authorization: `Bearer ${cronSecret}` } }));
}
const context = (id: string, accessId: string) => ({ params: Promise.resolve({ id, accessId }) });
it('delivers admin grant, extension and deletion with actor and before/after state exactly once @J22 @J190', async () => {
  const p = await product(), u = await user();
  const result = await grant(new NextRequest('http://localhost/api/v1/users/access', { method: 'POST', body: JSON.stringify({ product_id: p.id, access_duration_days: 7 }) }), { params: Promise.resolve({ id: u.id }) });
  expect(result.status).toBe(201); const access = (await result.json()).data;
  expect((await update(new NextRequest('http://localhost/access', { method: 'PATCH', body: JSON.stringify({ extend_days: 3 }) }), context(u.id, access.id))).status).toBe(200);
  expect((await revoke(new NextRequest('http://localhost/access', { method: 'DELETE' }), context(u.id, access.id))).status).toBe(204);
  await drain(); await drain();
  const changes = receiver.received.filter(e => e.data.customer?.userId === u.id);
  expect(changes.map(e => e.event)).toEqual(['access.granted', 'access.updated', 'access.revoked']);
  expect(changes.every(e => e.data.actor.type === 'api_key' && e.data.actor.id === actor.id)).toBe(true);
  expect(changes[0].data.access).toMatchObject({ id: access.id, statusAfter: 'active', grantedAt: expect.any(String), expiresAt: expect.any(String) });
  // Exact grant source next to the unchanged legacy reason (W135).
  expect(changes[0].data).toMatchObject({ grantSource: 'manual', reason: 'admin_grant' });
  expect(changes[1].data.grantSource).toBe('manual');
  expect(changes[2].data.grantSource).toBeUndefined();
  expect(changes[1].data.access).toMatchObject({ statusBefore: 'active', statusAfter: 'active' });
  expect(changes[2].data.access).toMatchObject({ statusAfter: 'revoked', revokedAt: expect.any(String) });
  // Requeue the committed changes as after an interrupted acknowledgement.
  await db.from('business_events').update({ dispatched_at: null, leased_until: null }).contains('payload', { customer: { userId: u.id } });
  await drain();
  expect(receiver.received.filter(e => e.data.customer?.userId === u.id)).toHaveLength(3);
});
it('records the paid guest claim and its source order during registration @J23', async () => {
  const p = await product(), email = `claim-${crypto.randomUUID()}@example.com`;
  const tx = await db.from('payment_transactions').insert({ product_id: p.id, customer_email: email, session_id: `cs_test_${crypto.randomUUID().replaceAll('-', '')}`, amount: 1900, currency: 'PLN', status: 'completed' }).select('id').single(); expect(tx.error).toBeNull();
  expect((await db.from('guest_purchases').insert({ product_id: p.id, customer_email: email, transaction_id: tx.data!.id, transaction_amount: 1900 })).error).toBeNull();
  const u = await user(email);
  expect((await db.from('user_product_access').select('id').eq('user_id', u.id).eq('product_id', p.id).single()).error).toBeNull();
  await drain();
  const event = receiver.received.find(e => e.event === 'access.granted' && e.data.customer.userId === u.id);
  expect(event?.data).toMatchObject({ reason: 'guest_purchase_claimed', grantSource: 'purchase', sourceOrder: { id: tx.data!.id }, customer: { email, userId: u.id }, product: { id: p.id } });
});
it('actually dispatches a natural expiry through the cron, without a second notification @J24', async () => {
  const p = await product(), u = await user();
  const access = await db.from('user_product_access').insert({ user_id: u.id, product_id: p.id, access_granted_at: '1999-01-01T00:00:00Z', created_at: '1999-01-01T00:00:00Z', access_expires_at: '2000-01-01T00:00:00Z' }).select('id').single(); expect(access.error).toBeNull();
  expect((await drain('access-expired')).status).toBe(200); expect((await drain('access-expired')).status).toBe(200);
  const expired = receiver.received.filter(e => e.event === 'access.expired' && e.data.customer.userId === u.id);
  expect(expired).toHaveLength(1);
  expect(expired[0].data).toMatchObject({ reason: 'expired', actor: { type: 'system' }, access: { id: access.data!.id, statusAfter: 'expired', expiresAt: '2000-01-01T00:00:00+00:00' } });
});
it('reports confirmed and released reservations plus their abandoned order, once @J25 @J26', async () => {
  const p = await product(true);
  const session = await db.from('product_sessions').insert({ product_id: p.id, starts_at: '2099-06-01T12:00:00Z', capacity: 10, title: 'Recorded workshop' }).select('id').single(); expect(session.error).toBeNull();
  expect((await db.from('product_price_tiers').insert({ session_id: session.data!.id, price: 19, sort: 0 })).error).toBeNull();
  for (const complete of [true, false]) {
    const sessionId = `cs_test_${crypto.randomUUID().replaceAll('-', '')}`;
    const placed = await db.rpc('place_order', { p_order: { product_id: p.id, currency: 'PLN', customer_email: `seats-${crypto.randomUUID()}@example.com`, session_id: sessionId, metadata: { event_ip: crypto.randomUUID() } }, p_lines: [{ product_id: p.id, item_type: 'main_product', quantity: 2, unit_price: 19, total_price: 38, discounted_total: 38, currency: 'PLN', product_name: 'Workshop', session_id: session.data!.id }] });
    expect(placed.error).toBeNull(); const id = placed.data.transaction_id;
    if (complete) expect((await db.rpc('confirm_event_order', { p_transaction_id: id })).error).toBeNull();
    else { expect(await abandonPendingCheckoutSession(db, sessionId)).toEqual({ success: true }); await abandonPendingCheckoutSession(db, sessionId); }
    await drain(); await drain();
    const changes = receiver.received.filter(e => e.data.order?.orderId === id);
    expect(changes.filter(e => e.event === (complete ? 'seats.confirmed' : 'seats.released'))).toHaveLength(1);
    const seat = changes.find(e => e.event === (complete ? 'seats.confirmed' : 'seats.released'))!.data;
    expect(seat).toMatchObject({ product: { id: p.id }, reservation: { sessionId: session.data!.id, quantity: 2, sessionStartsAt: '2099-06-01T12:00:00+00:00' }, reason: complete ? 'payment_confirmed' : 'order_abandoned' });
    if (!complete) expect(changes.filter(e => e.event === 'order.abandoned')).toHaveLength(1);
  }
});

it('reports a free-product grant made by the authenticated buyer without duplicate access events', async () => {
  const p = await product(), u = await user();
  expect((await db.from('products').update({ price: 0 }).eq('id', p.id)).error).toBeNull();
  const link = await db.auth.admin.generateLink({ type: 'magiclink', email: u.email! }); expect(link.error).toBeNull();
  const client = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  expect((await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })).error).toBeNull();
  for (let repeat = 0; repeat < 2; repeat++) expect((await grantFreeProductAccess(client, db, { product: p, user: { id: u.id, email: u.email! } })).accessGranted).toBe(true);
  await drain();
  const events = receiver.received.filter(e => e.event === 'access.granted' && e.data.customer.userId === u.id);
  expect(events).toHaveLength(1);
  expect(events[0].data).toMatchObject({ reason: 'free_product', actor: { type: 'user', id: u.id } });
});

it('identifies the purchase source for a bundle component claimed during registration @J31', async () => {
  const bundle = await product(), component = await product();
  expect((await db.from('products').update({ is_bundle: true }).eq('id', bundle.id)).error).toBeNull();
  expect((await db.from('bundle_items').insert({ bundle_product_id: bundle.id, component_product_id: component.id })).error).toBeNull();
  const email = `bundle-claim-${crypto.randomUUID()}@example.com`;
  const tx = await db.from('payment_transactions').insert({ product_id: bundle.id, customer_email: email, amount: 1900, currency: 'PLN', status: 'completed', session_id: `cs_test_${crypto.randomUUID().replaceAll('-', '')}` }).select('id').single(); expect(tx.error).toBeNull();
  expect((await db.from('guest_purchases').insert({ product_id: bundle.id, customer_email: email, transaction_id: tx.data!.id, transaction_amount: 1900 })).error).toBeNull();
  const u = await user(email); await drain();
  const event = receiver.received.find(e => e.event === 'access.granted' && e.data.customer.userId === u.id && e.data.product.id === component.id);
  expect(event?.data).toMatchObject({ reason: 'guest_purchase_claimed', grantSource: 'bundle', sourceOrder: { id: tx.data!.id } });
});

it('delivers abandonment to an endpoint scoped to an included order line', async () => {
  const main = await product(), bump = await product();
  await db.from('webhook_endpoint_products').delete().eq('webhook_endpoint_id', endpointId).eq('product_id', main.id);
  const tx = await db.from('payment_transactions').insert({ product_id: main.id, customer_email: `line-scope-${crypto.randomUUID()}@example.com`, session_id: `cs_test_${crypto.randomUUID().replaceAll('-', '')}`, amount: 2400, currency: 'PLN', status: 'pending' }).select('id').single(); expect(tx.error).toBeNull();
  expect((await db.from('payment_line_items').insert([
    { transaction_id: tx.data!.id, product_id: main.id, item_type: 'main_product', product_name: 'Main', quantity: 1, unit_price: 19, total_price: 19, discounted_total: 19, currency: 'PLN' },
    { transaction_id: tx.data!.id, product_id: bump.id, item_type: 'order_bump', product_name: 'Bump', quantity: 1, unit_price: 5, total_price: 5, discounted_total: 5, currency: 'PLN' },
  ])).error).toBeNull();
  expect((await db.from('payment_transactions').update({ status: 'abandoned' }).eq('id', tx.data!.id)).error).toBeNull();
  await drain();
  const events = receiver.received.filter(e => e.event === 'order.abandoned' && e.data.order.orderId === tx.data!.id);
  expect(events).toHaveLength(1); expect(events[0].data.lines.map((line: { product_id: string }) => line.product_id)).toContain(bump.id);
});
