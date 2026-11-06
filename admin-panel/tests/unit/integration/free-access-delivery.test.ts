import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
/** Free access reaches an HTTP consumer through every entry point, once per buyer/product. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { readBuyerPayload } from '@/lib/webhooks/buyer-payload-storage';
import { confirmLead } from '@/lib/leads/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Server } from 'node:http';

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw Error(`NEXT_REDIRECT:${url}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/tracking', () => ({ trackServerSideConversion: async () => {} }));
// Only this owned receiver uses the local transport fixture.
vi.mock('@/lib/validations/webhook', async original => ({
  ...await original<typeof import('@/lib/validations/webhook')>(),
  validateWebhookUrlAsync: async (url: string) => ({ valid: url.startsWith('http://127.0.0.1:') }),
}));
vi.mock('@/lib/security/safe-fetch', async original => ({
  ...await original<typeof import('@/lib/security/safe-fetch')>(), getSsrfSafeAgent: () => undefined,
}));

import { GET as productAccess } from '@/app/[locale]/auth/product-access/route';
import { POST as grantAccess } from '@/app/api/public/products/[slug]/grant-access/route';
import { deliverMagicLink } from '@/lib/auth/magic-link/deliver';
import { emitFreeAccessLead } from '@/lib/services/free-access-events';
import { claimPendingFreeGrants, queuePendingFreeGrant } from '@/lib/services/pending-free-grants';
import { verifyWebhookSignature } from '@/lib/services/webhook-queue/signature';
import { extractMagicLink, waitForEmail } from '../../helpers/mailpit';

interface LeadEnvelope {
  id: string;
  event: string;
  timestamp: string;
  data: { accessGrantedAt: string; accessExpiresAt: string | null; customer: { email: string; userId: string }; product: { id: string; name: string; slug: string; price: number; currency: string } };
}
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const received: Array<{ body: LeadEnvelope; signed: boolean; deliveryId: string | undefined }> = [];
const users: string[] = [], products: string[] = [];
const secret = crypto.randomUUID();
let server: Server, endpointId: string, sellerId: string;

beforeAll(async () => {
  const seller = await db.auth.admin.createUser({ email: `free-owner-${crypto.randomUUID()}@example.com`, email_confirm: true });
  expect(seller.error).toBeNull(); sellerId = seller.data.user!.id;
  await storeSellerKey(db, { sellerId, ...generateSellerKeypair(), custody: 'managed' });
  server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    received.push({ body: JSON.parse(raw), signed: verifyWebhookSignature(secret, raw, String(request.headers['x-sellf-signature'])), deliveryId: request.headers['x-sellf-delivery-id'] as string | undefined });
    response.writeHead(200).end('ok');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Receiver port required');
  const endpoint = await db.from('webhook_endpoints').insert({ url: `http://127.0.0.1:${address.port}`, secret, events: ['lead.captured'], is_active: true, product_filter_mode: 'selected' }).select('id').single();
  expect(endpoint.error).toBeNull(); endpointId = endpoint.data!.id;
});
afterAll(async () => {
  if (endpointId) {
    await db.from('webhook_logs').delete().eq('endpoint_id', endpointId);
    await db.from('webhook_endpoints').delete().eq('id', endpointId);
  }
  if (products.length) await db.from('issued_licenses').delete().in('product_id', products);
  if (sellerId) {
    await db.from('seller_license_keys').delete().eq('original_seller_id', sellerId);
    await db.auth.admin.deleteUser(sellerId);
  }
  for (const id of users) await db.auth.admin.deleteUser(id);
  if (products.length) await db.from('products').delete().in('id', products);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

it.each(['magic-link', 'signed-in', 'pending', 'lead-confirmation', 'lead-no-consent'] as const)('delivers the customer and free product once through %s @J13', async flow => {
  const isLead = flow.startsWith('lead-');
  const email = `free-delivery-${crypto.randomUUID()}@example.com`;
  const slug = `free-delivery-${crypto.randomUUID()}`;
  const product = await db.from('products').insert({ name: 'Three day free guide', slug, price: 0, currency: 'PLN', is_active: true, auto_grant_duration_days: 3, seller_id: sellerId, issue_license_on_purchase: isLead }).select('id').single();
  expect(product.error).toBeNull(); const productId = product.data!.id; products.push(productId);
  expect((await db.from('webhook_endpoint_products').insert({ webhook_endpoint_id: endpointId, product_id: productId })).error).toBeNull();
  state.client = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  if (flow === 'signed-in' || isLead) {
    const password = 'Local-test-password-123';
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull(); users.push(created.data.user!.id);
    expect((await state.client.auth.signInWithPassword({ email, password })).error).toBeNull();
  } else {
    expect(await deliverMagicLink({ email, redirectTo: `${process.env.SITE_URL}/auth/callback?flow=login`, shouldCreateUser: true })).toEqual({ ok: true });
    if (flow === 'pending') await queuePendingFreeGrant(email, slug);
    const mail = await waitForEmail(email);
    const link = new URL(extractMagicLink(mail.HTML!)!);
    const signedIn = await state.client.auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: 'signup' });
    expect(signedIn.error).toBeNull(); users.push(signedIn.data.user!.id);
  }
  const user = (await state.client.auth.getUser()).data.user!;
  if (isLead) {
    const token = crypto.randomUUID().replaceAll('-', '').repeat(2);
    const lead = await db.from('lead_submissions').insert({ token_hash: createHash('sha256').update(token).digest('hex'), email, product_id: productId, product_slug: slug, source: 'https://example.com/guide', locale: 'pl', marketing_consent: flow !== 'lead-no-consent', consent_version: flow === 'lead-no-consent' ? null : '1:pl', consent_text: flow === 'lead-no-consent' ? null : 'Zgoda' }).select('id').single();
    expect(lead.error).toBeNull();
    expect(await confirmLead(token, user, state.client)).toEqual({ ok: true, productSlug: slug });
    expect(await confirmLead(token, user, state.client)).toEqual({ ok: true, productSlug: slug });
  } else if (flow === 'magic-link') {
    await expect(productAccess(new Request(`${process.env.SITE_URL}/pl/auth/product-access?product=${slug}`))).rejects.toThrow('NEXT_REDIRECT');
  } else if (flow === 'pending') {
    expect(await claimPendingFreeGrants({ userClient: state.client, user })).toBe(1);
  } else {
    expect((await grantAccess(new NextRequest(`${process.env.SITE_URL}/api/public/products/${slug}/grant-access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'pl' }) }), { params: Promise.resolve({ slug }) })).status).toBe(200);
  }
  const deliveries = () => received.filter(entry => entry.body.data.customer.email === email);
  await expect.poll(() => deliveries().length, { timeout: 2000 }).toBe(1);
  const delivery = deliveries()[0];
  expect(delivery.signed).toBe(true);
  expect(delivery.deliveryId).toBe(delivery.body.id);
  expect(delivery.body.event).toBe('lead.captured');
  if (isLead) {
    const license = await db.from('issued_licenses').select('license_key').eq('product_id', productId).eq('email', email).single();
    expect(license.error).toBeNull();
    expect(delivery.body.data).toMatchObject({ license: { token: license.data!.license_key, kid: expect.any(String), jwksUrl: expect.stringContaining('/api/licenses/jwks') } });
    const mail = await waitForEmail(email);
    expect(mail.HTML).toContain(license.data!.license_key);
  }
  expect(delivery.body.data.customer).toMatchObject({ email, userId: user.id });
  if (['lead-confirmation', 'lead-no-consent', 'magic-link', 'signed-in'].includes(flow)) expect(delivery.body.data.customer).toMatchObject({ locale: 'pl' });
  if (isLead) expect(delivery.body.data).toMatchObject({ marketingConsent: flow !== 'lead-no-consent', consentVersion: flow === 'lead-no-consent' ? null : '1:pl', leadId: expect.any(String), source: 'https://example.com/guide' });
  expect(delivery.body.data.product).toMatchObject({ id: productId, slug, name: 'Three day free guide', price: 0, currency: 'PLN' });
  expect(Number.isNaN(Date.parse(delivery.body.timestamp))).toBe(false);
  // A repeat via another entry point must not create another delivery.
  expect((await grantAccess(new NextRequest(`${process.env.SITE_URL}/api/public/products/${slug}/grant-access`, { method: 'POST' }), { params: Promise.resolve({ slug }) })).status).toBe(200);
  if (!isLead) await Promise.all([0, 1].map(() => emitFreeAccessLead(db, { product: { id: productId, slug }, user: { id: user.id, email } })));
  expect(deliveries()).toHaveLength(1);
  const logs = await db.from('webhook_logs').select('id,status,payload').eq('endpoint_id', endpointId);
  expect(logs.error).toBeNull();
  const decoded = await Promise.all(logs.data!.map(async row => ({ ...row, payload: await readBuyerPayload(row.payload) as LeadEnvelope })));
  const matching = decoded.filter(row => row.payload.data.customer.email === email);
  expect(matching).toHaveLength(1); expect(matching[0].status).toBe('success');
  const access = await db.from('user_product_access').select('access_granted_at,access_expires_at').eq('user_id', user.id).eq('product_id', productId).single();
  expect(access.error).toBeNull();
  expect(delivery.body.data.accessGrantedAt).toBe(access.data!.access_granted_at);
  expect(delivery.body.data.accessExpiresAt).toBe(access.data!.access_expires_at);
  expect(Date.parse(access.data!.access_expires_at!) - Date.parse(access.data!.access_granted_at)).toBeCloseTo(3 * 86400000, -3);
});
