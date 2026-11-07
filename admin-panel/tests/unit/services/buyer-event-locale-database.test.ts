/** Buyer notifications use their committed order language through the signed queue. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getTestDatabaseContainer } from '../../helpers/database-container';
const received = vi.hoisted(() => [] as Array<{ url: string; body: string; headers: Record<string, string> }>);
vi.mock('undici', async importOriginal => ({ ...await importOriginal<object>(), fetch: vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
  received.push({ url: _url, body: init.body, headers: init.headers }); return new Response('ok');
}) }));
vi.mock('@/lib/validations/webhook', async importOriginal => ({ ...await importOriginal<object>(), validateWebhookUrlAsync: async () => ({ valid: true }) }));
vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
vi.mock('@/lib/auth/magic-link/request', () => ({ sendTrustedMagicLink: async () => ({ ok: true }) }));
import { WebhookService } from '@/lib/services/webhook-service';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import { emitRefundIssuedWebhook } from '@/lib/services/refund-webhook-payload';
import { dispatchTransferEvent } from '@/lib/orders/bank-transfer-service';
import { sendParticipantsNotice } from '@/lib/orders/participants-service';
import { buildLicenseIssuedWebhookData } from '@/lib/services/license-revoke-webhook-payload';
import { emitFreeAccessLead } from '@/lib/services/free-access-events';
import recordedRefund from '../../fixtures/stripe/refund_updated.json';
import { readBuyerPayload } from '@/lib/webhooks/buyer-payload-storage';
import type { RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const productId = randomUUID(), endpointId = randomUUID(), userId = randomUUID();
const email = `buyer-${userId}@example.com`, secret = randomUUID();
const events = ['purchase.completed', 'license.issued', 'order.placed', 'order.payment_reminder', 'order.cancelled', 'order.participants_needed', 'refund.issued', 'lead.captured'];
let shop: { id: string; custom_settings: unknown };
function checked<T extends { error: unknown }>(result: T): T { if (result.error) throw result.error; return result; }
beforeAll(async () => {
  getTestDatabaseContainer();
  shop = checked(await db.from('shop_config').select('id,custom_settings').single()).data!;
  checked(await db.auth.admin.createUser({ id: userId, email, email_confirm: true }));
  const { generateSellerKeypair, storeSellerKey } = await import('@/lib/license-keys/keys');
  await storeSellerKey(db, { sellerId: userId, ...generateSellerKeypair(), custody: 'managed' });
  checked(await db.from('products').insert({ id: productId, name: 'Language workshop', slug: `language-${productId}`, price: 20, currency: 'PLN', seller_id: userId }));
  checked(await db.from('user_product_access').insert({ user_id: userId, product_id: productId }));
  checked(await db.from('webhook_endpoints').insert({ id: endpointId, url: `https://receiver.example/events/${endpointId}`, secret, events: [...events, 'license.updated', 'access.updated'], is_active: true }));
});
afterAll(async () => {
  await db.from('webhook_logs').delete().eq('endpoint_id', endpointId);
  await db.from('webhook_endpoints').delete().eq('id', endpointId);
  await db.from('issued_licenses').delete().eq('product_id', productId);
  await db.from('payment_transactions').delete().eq('product_id', productId);
  await db.from('user_product_access').delete().eq('product_id', productId);
  await db.from('business_events').delete().eq('product_id', productId);
  checked(await db.from('subscriptions').delete().eq('product_id', productId));
  checked(await db.from('products').delete().eq('id', productId));
  await db.from('seller_license_keys').delete().eq('original_seller_id', userId);
  await db.auth.admin.deleteUser(userId);
  if (shop) await db.from('shop_config').update({ custom_settings: shop.custom_settings }).eq('id', shop.id);
});
it.each([['en', 'pl', 'en'], ['pl', 'en', 'pl'], [undefined, 'pl', 'pl']] as const)('delivers every buyer event: saved %s, shop %s → %s @J500', async (saved, shopLocale, expected) => {
  received.length = 0;
  checked(await db.from('webhook_logs').delete().eq('endpoint_id', endpointId).eq('event_type', 'lead.captured'));
  checked(await db.from('shop_config').update({ custom_settings: { ...(shop.custom_settings as object), default_locale: shopLocale } }).eq('id', shop.id));
  const id = randomUUID();
  const tx = checked(await db.from('payment_transactions').insert({ id, product_id: productId, customer_email: email, user_id: userId,
    session_id: null, amount: 2000, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1,
    metadata: saved ? { locale: saved } : {}, release_at: '2099-01-01T00:00:00Z', reminder_at: '2098-01-01T00:00:00Z' }).select('*').single()).data!;
  checked(await db.from('payment_line_items').insert({ transaction_id: id, product_id: productId, item_type: 'main_product', quantity: 1, unit_price: 20, total_price: 20, discounted_total: 20, currency: 'PLN' }));
  await dispatchTransferEvent(db as never, id, 'order.placed');
  await dispatchTransferEvent(db as never, id, 'order.payment_reminder');
  checked(await db.from('payment_transactions').update({ status: 'cancelled', cancel_reason: 'admin', cancel_note: 'Buyer cancelled' }).eq('id', id));
  await dispatchTransferEvent(db as never, id, 'order.cancelled');
  checked(await db.from('payment_transactions').update({ status: 'completed' }).eq('id', id));
  expect(await sendParticipantsNotice(db as never, id)).toBe('sent');
  const purchase = await buildPurchaseWebhookPayload({ supabaseClient: db, productId, customerEmail: email, userId, bumpProductIds: [],
    metadata: saved ? { locale: saved } : {}, amount: 2000, currency: 'PLN', paymentIntentId: null, couponId: null, isGuest: false });
  purchase.order.orderId = id;
  await WebhookService.trigger('purchase.completed', purchase, db, productId);
  const licenseId = randomUUID();
  checked(await db.from('issued_licenses').insert({ id: licenseId, seller_id: userId, original_seller_id: userId, product_id: productId, email, user_id: userId,
    order_id: id, kid: 'local-test', license_key: 'local-test-key', issuance_source: 'purchase' }));
  const captured = checked(await db.from('business_events').select('payload').eq('event_type', 'license.issued').eq('product_id', productId).order('created_at', { ascending: false }).limit(1).single()).data!;
  const row = (captured.payload as { licenseRow: RevokedLicenseRow }).licenseRow;
  expect(row.sellf_order_id).toBe(id);
  await WebhookService.trigger('license.issued', buildLicenseIssuedWebhookData(row, 'https://shop.example'), db, productId, licenseId);
  const refund = recordedRefund.data.object;
  expect(await emitRefundIssuedWebhook({ supabaseClient: db, transaction: { ...tx, status: 'completed' }, stripeRefundId: `${refund.id}_${id.replaceAll('-', '')}`,
    refundAmount: refund.amount, refundCurrency: refund.currency, refundStatus: refund.status, previousRefundedAmount: 0, totalRefunded: refund.amount, isFullRefund: false,
    statusBefore: 'completed', statusAfter: 'refunded', refundedAt: new Date().toISOString(), source: 'admin' })).toBe(true);
  expect(await emitFreeAccessLead(db, { product: { id: productId, slug: `language-${productId}` }, user: { id: userId, email }, locale: saved })).toBe(true);
  const deliveries = received.filter(r => r.url.endsWith(endpointId)).map(r => {
    const signature = r.headers['X-Sellf-Signature'];
    const parts = Object.fromEntries(signature.split(',').map(part => part.split('=')));
    expect(parts.v1).toBe(createHmac('sha256', secret).update(`${parts.t}.${r.body}`).digest('hex'));
    return JSON.parse(r.body);
  });
  for (const event of events) {
    const envelope = deliveries.find(d => d.event === event);
    expect(envelope, event).toBeDefined();
    expect(envelope.data.customer.locale, event).toBe(expected);
    const stored = checked(await db.from('webhook_logs').select('payload').eq('id', envelope.id).single()).data!;
    expect(await readBuyerPayload(stored.payload)).toEqual(envelope);
    if (saved === 'en' && process.env.W176_FIXTURE_DIR) {
      mkdirSync(process.env.W176_FIXTURE_DIR, { recursive: true });
      const redacted = JSON.parse(JSON.stringify(envelope), (key, value) => ['token', 'licenseKey', 'payUrl', 'participantsUrl'].includes(key) ? '[REDACTED]' : value);
      writeFileSync(`${process.env.W176_FIXTURE_DIR}/${event}.json`, JSON.stringify(redacted, null, 2) + '\n');
    }
  }
  const original = deliveries.find(d => d.event === 'refund.issued');
  checked(await db.from('shop_config').update({ custom_settings: { default_locale: expected === 'pl' ? 'en' : 'pl' } }).eq('id', shop.id));
  checked(await db.from('webhook_logs').update({ status: 'failed' }).eq('id', original.id));
  expect((await WebhookService.retry(original.id, db)).success).toBe(true);
  const retried = JSON.parse(received.filter(r => r.url.endsWith(endpointId)).at(-1)!.body);
  expect(retried).toEqual(original);
});

it('preserves PL for subscription, free and manual license events @W180', async () => {
  const { issueLicense } = await import('@/lib/license-keys/issue');
  const { issueRequestedLicense } = await import('@/lib/license-keys/request');
  const { buildLicenseRevokeWebhookData } = await import('@/lib/services/license-revoke-webhook-payload');
  const { enrichBuyerWebhook } = await import('@/lib/webhooks/buyer-notifications');
  checked(await db.from('shop_config').update({ custom_settings: { default_locale: 'en' } }).eq('id', shop.id));
  checked(await db.from('products').update({ issue_license_on_purchase: true }).eq('id', productId));
  const subId = randomUUID(), stripeSub = `sub_w180_${subId}`;
  checked(await db.from('subscriptions').insert({ id: subId, user_id: userId, product_id: productId, stripe_customer_id: `cus_${subId}`, stripe_subscription_id: stripeSub, status: 'active', metadata: { locale: 'pl' } }));
  const tx = checked(await db.from('payment_transactions').insert({ product_id: productId, user_id: userId, customer_email: email, amount: 2000, currency: 'PLN', status: 'completed', subscription_id: subId, session_id: `in_${subId.replaceAll('-', '')}`, stripe_invoice_id: `in_${subId.replaceAll('-', '')}`, metadata: {} }).select('*').single()).data!;
  const license = await issueLicense(db, { productId, userId, email, orderId: stripeSub });
  expect(license?.id).toBeTruthy();
  async function capturedLicense(id: string, event: string) {
    const rows = checked(await db.from('business_events').select('payload').eq('product_id', productId).eq('event_type', event)).data!;
    const row = rows.map(r => (r.payload as { licenseRow: RevokedLicenseRow }).licenseRow).find(r => r.id === id)!;
    expect(row).toBeDefined();
    const payload = event === 'license.issued' ? buildLicenseIssuedWebhookData(row, 'https://shop.example') : buildLicenseRevokeWebhookData(row, 'https://shop.example');
    expect(await enrichBuyerWebhook(event, payload, db as never)).toMatchObject({ customer: { email, locale: 'pl' } });
    await WebhookService.trigger(event, payload, db, productId, `${event}:${id}`);
    const delivered = JSON.parse(received.filter(r => r.url.endsWith(endpointId)).at(-1)!.body);
    expect(delivered).toMatchObject({ event, data: { customer: { email, locale: 'pl' } } });
    const signature = received.filter(r => r.url.endsWith(endpointId)).at(-1)!;
    const parts = Object.fromEntries(signature.headers['X-Sellf-Signature'].split(',').map(part => part.split('=')));
    expect(parts.v1).toBe(createHmac('sha256', secret).update(`${parts.t}.${signature.body}`).digest('hex'));
  }
  await capturedLicense(license!.id!, 'license.issued');
  const invoiceLicense = await issueLicense(db, { productId, userId, email, orderId: tx.stripe_invoice_id! });
  expect(invoiceLicense?.id).toBeTruthy();
  await capturedLicense(invoiceLicense!.id!, 'license.issued');
  checked(await db.from('user_product_access').update({ subscription_id: subId, access_expires_at: '2090-01-01T00:00:00Z' }).eq('user_id', userId).eq('product_id', productId));
  const access = checked(await db.from('business_events').select('payload').eq('event_type', 'access.updated').eq('product_id', productId).order('created_at', { ascending: false }).limit(1).single()).data!;
  expect(await enrichBuyerWebhook('access.updated', access.payload, db as never)).toMatchObject({ customer: { locale: 'pl' } });
  await WebhookService.trigger('access.updated', access.payload, db, productId);
  expect(JSON.parse(received.filter(r => r.url.endsWith(endpointId)).at(-1)!.body)).toMatchObject({ event: 'access.updated', data: { customer: { locale: 'pl' } } });
  checked(await db.from('issued_licenses').update({ expires_at: '2090-01-01T00:00:00Z' }).eq('id', license!.id!));
  await capturedLicense(license!.id!, 'license.updated');
  const refund = recordedRefund.data.object;
  expect(await emitRefundIssuedWebhook({ supabaseClient: db, transaction: tx, stripeRefundId: `${refund.id}_${subId.replaceAll('-', '')}`, refundAmount: refund.amount, refundCurrency: refund.currency, refundStatus: refund.status, previousRefundedAmount: 0, totalRefunded: refund.amount, isFullRefund: false, statusBefore: 'completed', statusAfter: 'partially_refunded', refundedAt: new Date().toISOString(), source: 'admin' })).toBe(true);
  expect(JSON.parse(received.filter(r => r.url.endsWith(endpointId)).at(-1)!.body)).toMatchObject({ event: 'refund.issued', data: { customer: { locale: 'pl' } } });
  expect(await emitFreeAccessLead(db, { product: { id: productId, slug: `language-${productId}` }, user: { id: userId, email }, locale: 'pl' })).toBe(true);
  const free = checked(await db.from('issued_licenses').select('id').eq('order_id', `free_${userId}_${productId}`).single()).data!;
  await capturedLicense(free.id, 'license.issued');
  checked(await db.from('payment_transactions').update({ metadata: { locale: 'pl' } }).eq('id', tx.id));
  const manual = await issueRequestedLicense({ productId, email, sendEmail: false, locale: 'en' }, { actorUserId: userId, source: 'manual', origin: 'https://shop.example' });
  expect(manual.ok).toBe(true);
  if (!manual.ok) throw Error(manual.error);
  await capturedLicense(manual.license.id!, 'license.issued');
  const audit = checked(await db.from('audit_log').select('operation,new_values').eq('new_values->>license_id', manual.license.id!).single()).data!;
  expect(audit).toMatchObject({ operation: 'INSERT', new_values: { action: 'MANUAL_LICENSE_ISSUED' } });
});
it('uses the shop language for a manual buyer without history or submitted language @W180', async () => {
  const { resolveBuyerLocale } = await import('@/lib/license-keys/request');
  checked(await db.from('shop_config').update({ custom_settings: { default_locale: 'pl' } }).eq('id', shop.id));
  expect(await resolveBuyerLocale(db as never, `unknown-${randomUUID()}@example.com`)).toBe('pl');
});

it.each([false, true])('completes and reopens transfer orders with license issuance %s', async licensed => {
  const { fulfillPaidOrder } = await import('@/lib/services/fulfill-paid-order');
  const { data: config, error: configError } = await db.from('bank_transfer_config').select('*').single();
  if (configError) throw configError;
  const actor = checked(await db.from('admin_users').select('user_id').limit(1).single()).data!.user_id;
  checked(await db.from('products').update({ issue_license_on_purchase: licensed, checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] }] } }).eq('id', productId));
  checked(await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Transfer shop',
    bank_account_number: 'PL61109010140000071219812874', bank_transfer_grant_access_on_placement: false }).eq('id', true));
  try {
    for (const reopen of [false, true]) {
      checked(await db.from('user_product_access').delete().eq('user_id', userId).eq('product_id', productId));
      const placed = checked(await db.rpc('bank_transfer_order', {
        p_order: { product_id: productId, currency: 'PLN', customer_email: email, metadata: { locale: 'pl' },
          order_details: { v: 1, buyer: { type: 'organization', terms_accepted: true } } },
        p_lines: [{ product_id: productId, item_type: 'main_product', quantity: 1, unit_price: 20, total_price: 20, discounted_total: 20, currency: 'PLN' }],
      })).data as { transaction_id: string };
      const id = placed.transaction_id;
      if (reopen) {
        const cancelled = checked(await db.rpc('admin_bank_transfer_order', { p_id: id, p_action: 'cancel', p_reason: 'Buyer request', p_actor: actor })).data;
        expect(cancelled).toMatchObject({ success: true });
        expect(checked(await db.from('payment_transactions').select('status').eq('id', id).single()).data!.status).toBe('cancelled');
      } else {
        const attempt = checked(await db.rpc('open_order_payment_attempt', { p_id: id, p_kind: 'settle', p_amount: 2000, p_currency: 'PLN',
          p_expires_at: new Date(Date.now() + 1800000).toISOString(), p_now: new Date().toISOString() })).data as { id: string };
        checked(await db.rpc('attach_order_payment_session', { p_attempt: attempt.id, p_session_id: `cs_test_${randomUUID()}` }));
      }
      expect(checked(await db.from('user_product_access').select('id').eq('user_id', userId).eq('product_id', productId)).data).toHaveLength(0);
      const paidAt = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
      const marked = checked(await db.rpc('admin_bank_transfer_order', { p_id: id, p_action: 'mark-paid', p_amount: 2000,
        p_paid_at: paidAt, p_actor: actor, p_accept_cancelled: reopen, ...(reopen ? { p_reason: 'Transfer received' } : {}) })).data;
      expect(marked, JSON.stringify(marked)).toMatchObject({ success: true, ...(reopen ? { reopened: true } : {}) });
      const tx = checked(await db.from('payment_transactions').select('status,paid_at,reopened_at').eq('id', id).single()).data!;
      expect(tx.status).toBe('completed');
      expect(Date.parse(tx.paid_at!)).toBe(Date.parse(paidAt));
      expect(!!tx.reopened_at).toBe(reopen);
      if (!reopen) expect(checked(await db.from('order_payment_attempts').select('status').eq('transaction_id', id).single()).data!.status).toBe('superseded');
      await fulfillPaidOrder({ supabase: db, transactionId: id, provider: { kind: 'offline' }, productId,
        customerEmail: email, amount: 2000, currency: 'PLN', isGuest: false });
      expect(checked(await db.from('user_product_access').select('id').eq('user_id', userId).eq('product_id', productId)).data).toHaveLength(1);
      const licenses = checked(await db.from('issued_licenses').select('id,order_id,customer_locale').eq('order_id', id)).data!;
      expect(licenses).toHaveLength(licensed ? 1 : 0);
      if (licensed) {
        const snapshot = checked(await db.from('business_events').select('payload').eq('event_type', 'license.issued').eq('payload->licenseRow->>id', licenses[0].id).single()).data!;
        expect(snapshot.payload).toMatchObject({ licenseRow: { sellf_order_id: id } });
        const { enrichBuyerWebhook } = await import('@/lib/webhooks/buyer-notifications');
        const row = (snapshot.payload as { licenseRow: RevokedLicenseRow }).licenseRow;
        expect(await enrichBuyerWebhook('license.issued', buildLicenseIssuedWebhookData(row, 'https://shop.example'), db as never))
          .toMatchObject({ customer: { email, locale: 'pl' } });
      }
      expect(checked(await db.from('payment_transactions').select('fulfillment_pending').eq('id', id).single()).data!.fulfillment_pending).toBe(false);
    }
  } finally { checked(await db.from('bank_transfer_config').upsert(config)); }
});
