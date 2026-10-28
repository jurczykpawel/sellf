/** HTTP-only acceptance through real API authentication, SQL changes and signed delivery. */
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { supabaseAdmin as db } from './helpers/admin-auth';
import { insertTestApiKey } from './helpers/api-key';
import { webhookReceiver } from './helpers/webhook-receiver';
import { webhookTunnel } from './helpers/webhook-tunnel';
import { waitForEmail, extractMagicLink } from './helpers/mailpit';
import card from './fixtures/business-events/card-purchase.json';
import type { APIRequestContext } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
let receiver: Awaited<ReturnType<typeof webhookReceiver>> | undefined;
let tunnel: Awaited<ReturnType<typeof webhookTunnel>> | undefined;
let endpointId: string, keyId: string, key: string;
const users: string[] = [], products: string[] = [];
const headers = () => ({ Authorization: `Bearer ${key}` });
async function drain(request: APIRequestContext) {
  const response = await request.get('/api/cron?job=business-events', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(response.status()).toBe(200); expect((await response.json()).errors).toBe(0);
}
async function product(price = 19, event = false) {
  const r = await db.from('products').insert({ name: 'Money/access HTTP contract', slug: `http-contract-${crypto.randomUUID()}`, price, currency: 'PLN', is_active: true, event_mode: event, auto_grant_duration_days: 7 }).select('id,slug').single();
  expect(r.error).toBeNull(); products.push(r.data!.id);
  expect((await db.from('webhook_endpoint_products').insert({ webhook_endpoint_id: endpointId, product_id: r.data!.id })).error).toBeNull(); return r.data!;
}
test.beforeAll(async ({ request }) => {
  test.setTimeout(120000);
  expect(['localhost', '127.0.0.1']).toContain(new URL(process.env.SUPABASE_URL!).hostname);
  await db.from('business_events').update({ dispatched_at: new Date().toISOString(), leased_until: null }).is('dispatched_at', null);
  const secret = crypto.randomUUID(); receiver = await webhookReceiver(secret); tunnel = await webhookTunnel(receiver.url);
  await expect.poll(async () => { try { return (await request.get(tunnel!.url, { timeout: 5000 })).status(); } catch (error) { if (process.env.WEBHOOK_TUNNEL_LOG) appendFileSync(process.env.WEBHOOK_TUNNEL_LOG, `Probe: ${error instanceof Error ? error.message.split('\n')[0] : 'unavailable'}\n`); return 0; } }, { timeout: 60000 }).toBe(401);
  const owner = await db.from('admin_users').select('id').limit(1).single(); expect(owner.error).toBeNull();
  key = `sf_test_${randomBytes(32).toString('hex')}`;
  const saved = await insertTestApiKey(db, key, { name: 'HTTP money/access fixture', admin_user_id: owner.data!.id, scopes: ['users:read', 'users:write', 'payments:read'], is_active: true, rate_limit_per_minute: 1000 }); keyId = saved.data.id;
  const endpoint = await db.from('webhook_endpoints').insert({ url: tunnel.url, secret, events: ['access.granted', 'access.updated', 'access.revoked', 'access.expired', 'order.abandoned', 'seats.held', 'seats.confirmed', 'seats.released'], is_active: true, product_filter_mode: 'selected' }).select('id').single();
  expect(endpoint.error).toBeNull(); endpointId = endpoint.data!.id;
});
test.afterAll(async () => {
  if (endpointId) { await db.from('webhook_logs').delete().eq('endpoint_id', endpointId); await db.from('webhook_endpoints').delete().eq('id', endpointId); }
  if (keyId) await db.from('api_keys').delete().eq('id', keyId);
  for (const id of users) await db.auth.admin.deleteUser(id);
  for (const id of products) { await db.from('payment_transactions').delete().eq('product_id', id); await db.from('product_sessions').delete().eq('product_id', id); await db.from('products').delete().eq('id', id); }
  await tunnel?.close(); await receiver?.close();
});
test('an API consumer receives grant, extension and revocation with the actual API-key actor', async ({ request }) => {
  const p = await product(), email = `http-access-${crypto.randomUUID()}@example.com`;
  const user = await db.auth.admin.createUser({ email, email_confirm: true }); expect(user.error).toBeNull(); const uid = user.data.user!.id; users.push(uid);
  const granted = await request.post(`/api/v1/users/${uid}/access`, { headers: headers(), data: { product_id: p.id, access_duration_days: 7 } });
  expect(granted.status()).toBe(201); const accessId = (await granted.json()).data.id;
  expect((await request.patch(`/api/v1/users/${uid}/access/${accessId}`, { headers: headers(), data: { extend_days: 3 } })).status()).toBe(200);
  expect((await request.delete(`/api/v1/users/${uid}/access/${accessId}`, { headers: headers() })).status()).toBe(204);
  await drain(request); await drain(request);
  const changes = receiver!.received.filter(e => e.data.customer?.userId === uid);
  expect(changes.map(e => e.event)).toEqual(['access.granted', 'access.updated', 'access.revoked']);
  expect(changes.every(e => e.data.actor.type === 'api_key' && e.data.actor.id === keyId)).toBe(true);
  expect(changes[2].data.access).toMatchObject({ id: accessId, statusAfter: 'revoked', revokedAt: expect.any(String) });
});
test('a new buyer follows the delivered signup link and receives a claim event for the recorded order', async ({ request }) => {
  test.setTimeout(90000);
  const p = await product(card.payload.data.order.amount / 100), email = `http-claim-${crypto.randomUUID()}@example.com`;
  const tx = await db.from('payment_transactions').insert({ product_id: p.id, customer_email: email, amount: card.payload.data.order.amount, currency: 'PLN', status: 'completed', session_id: `cs_test_${crypto.randomUUID().replaceAll('-', '')}` }).select('id').single(); expect(tx.error).toBeNull();
  expect((await db.from('guest_purchases').insert({ product_id: p.id, customer_email: email, transaction_id: tx.data!.id, transaction_amount: card.payload.data.order.amount })).error).toBeNull();
  expect((await request.post('/api/auth/magic-link', { data: { flow: 'login', email, locale: 'en', captchaToken: 'local-fixture' } })).status()).toBe(200);
  const mail = await waitForEmail(email); const link = extractMagicLink(mail.HTML!)!;
  let completed = false;
  try { completed = (await request.get(link, { timeout: 30000 })).ok(); } catch { throw Error('Delivered signup link did not complete'); }
  expect(completed).toBe(true);
  const buyer = await db.rpc('find_user_id_by_email', { p_email: email }); expect(buyer.error).toBeNull(); expect(buyer.data).toBeTruthy(); users.push(buyer.data!);
  await drain(request);
  const events = receiver!.received.filter(e => e.event === 'access.granted' && e.data.customer?.email === email);
  expect(events).toHaveLength(1); expect(events[0].data).toMatchObject({ reason: 'guest_purchase_claimed', sourceOrder: { id: tx.data!.id }, access: { statusAfter: 'active', expiresAt: expect.any(String) } });
  const detail = await request.get(`/api/v1/payments/${tx.data!.id}`, { headers: headers() }); expect(detail.status()).toBe(200);
  expect((await detail.json()).data).toMatchObject({ id: tx.data!.id, payment_provider: 'stripe', order_number: expect.any(Number), line_items: expect.any(Array) });
});
test('a committed hold and abandonment are delivered with the reservation, order and minor amount', async ({ request }) => {
  const p = await product(19, true), sessionId = `cs_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const session = await db.from('product_sessions').insert({ product_id: p.id, starts_at: '2099-06-01T12:00:00Z', capacity: 10 }).select('id').single(); expect(session.error).toBeNull();
  expect((await db.from('product_price_tiers').insert({ session_id: session.data!.id, price: 19, sort: 0 })).error).toBeNull();
  const placed = await db.rpc('place_order', { p_order: { product_id: p.id, currency: 'PLN', customer_email: `http-seats-${crypto.randomUUID()}@example.com`, session_id: sessionId, metadata: { event_ip: crypto.randomUUID() } }, p_lines: [{ product_id: p.id, item_type: 'main_product', quantity: 2, unit_price: 19, total_price: 38, discounted_total: 38, currency: 'PLN', product_name: 'Workshop', session_id: session.data!.id }] });
  expect(placed.error).toBeNull(); const id = placed.data.transaction_id;
  expect((await db.from('payment_transactions').update({ status: 'abandoned' }).eq('id', id).eq('status', 'pending')).error).toBeNull();
  await drain(request); await drain(request);
  const changes = receiver!.received.filter(e => e.data.order?.orderId === id);
  expect(changes.filter(e => e.event === 'seats.held')).toHaveLength(1); expect(changes.filter(e => e.event === 'seats.released')).toHaveLength(1); expect(changes.filter(e => e.event === 'order.abandoned')).toHaveLength(1);
  expect(changes.find(e => e.event === 'seats.released')!.data).toMatchObject({ reason: 'order_abandoned', reservation: { quantity: 2, sessionId: session.data!.id } });
  expect(changes.find(e => e.event === 'order.abandoned')!.data).toMatchObject({ amountUnit: 'minor', order: { amount: 3800, statusBefore: 'pending', statusAfter: 'abandoned' } });
});
