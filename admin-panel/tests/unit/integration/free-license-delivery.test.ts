/** Free registered-tier licenses reach new and existing buyers through the shared grant path. */
import { createServer } from 'node:http';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient, adminId: '' }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw Error(`NEXT_REDIRECT:${url}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, checkRateLimitForIdentifier: async () => true }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApiWithRequest: async () => ({ user: { id: state.adminId } }) }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken: async () => ({ success: true }) }));
vi.mock('@/lib/actions/validate-email', () => ({ validateEmailAction: async () => ({ isValid: true }) }));
vi.mock('@/lib/embed/checkout-embed', () => ({ getSellfBaseUrl: () => process.env.SITE_URL }));
vi.mock('@/lib/tracking', () => ({ trackServerSideConversion: async () => {} }));
vi.mock('@/lib/utils/canonical-url', () => ({ getCanonicalOriginOrNull: () => 'https://license-fixture.example.test', getCanonicalOrigin: () => process.env.SITE_URL }));
vi.mock('@/lib/validations/webhook', async original => ({ ...await original<typeof import('@/lib/validations/webhook')>(), validateWebhookUrlAsync: async (url: string) => ({ valid: url.startsWith('http://127.0.0.1:') }) }));
vi.mock('@/lib/security/safe-fetch', async original => ({ ...await original<typeof import('@/lib/security/safe-fetch')>(), getSsrfSafeAgent: () => undefined }));

import { GET as productAccess } from '@/app/[locale]/auth/product-access/route';
import { POST as grantAccess } from '@/app/api/public/products/[slug]/grant-access/route';
import { POST as magicRequest } from '@/app/api/auth/magic-link/route';
import { POST as manualIssue } from '@/app/api/admin/licenses/route';
import { GET as publicKeys } from '@/app/api/licenses/jwks/route';
import { claimPendingFreeGrants } from '@/lib/services/pending-free-grants';
import { issueLicense } from '@/lib/license-keys/issue';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { signLicense } from '@/lib/license-keys/format';
import { verifySellfLicense } from '@/lib/license-keys/sdk';
import { resolveCurrentTier } from '@/lib/license/resolve';
import { verifyWebhookSignature } from '@/lib/services/webhook-queue/signature';
import { waitForEmail, extractMagicLink, searchMessages } from '../../helpers/mailpit';

interface LeadMessage {
  id: string;
  event: string;
  data: { customer: { email: string }; license?: { token: string; kid: string; jwksUrl: string } };
}
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const platformKey = generateSellerKeypair(), sellerKey = generateSellerKeypair();
const users: string[] = [], products: string[] = [], messages: LeadMessage[] = [];
const secret = crypto.randomUUID();
let sellerId: string, endpointId: string, server: Server, savedPlatformLicense: string | null;

beforeAll(async () => {
  expect(new URL(process.env.SUPABASE_URL!).hostname).toBe('127.0.0.1');
  server = createServer(async (request, response) => {
    if (request.url === '/platform-jwks') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [{ kid: platformKey.kid, alg: 'ES256', pem: platformKey.publicKeyPem }] })); return;
    }
    let raw = ''; for await (const chunk of request) raw += chunk;
    if (!verifyWebhookSignature(secret, raw, String(request.headers['x-sellf-signature']))) { response.writeHead(401).end(); return; }
    messages.push(JSON.parse(raw)); response.writeHead(200).end('ok');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Receiver port unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('E2E_MODE', 'false'); vi.stubEnv('DEMO_MODE', 'false');
  vi.stubEnv('SELLF_PLATFORM_JWKS_URL', `${origin}/platform-jwks`);
  vi.stubEnv('SELLF_LICENSE_KEY', signLicense({ v: 1, kid: platformKey.kid, product: 'sellf-pro', email: 'seller@example.com', order: 'local-platform-fixture', tier: 'pro', iat: Math.floor(Date.now() / 1000), exp: null, domain: 'license-fixture.example.test' }, platformKey.privateKeyPem));
  const config = await db.from('integrations_config').select('sellf_license').eq('id', 1).single(); expect(config.error).toBeNull(); savedPlatformLicense = config.data!.sellf_license;
  expect((await db.from('integrations_config').update({ sellf_license: null }).eq('id', 1)).error).toBeNull();
  expect(await resolveCurrentTier({ dataClient: db })).toBe('pro');
  const seller = await db.auth.admin.createUser({ email: `free-license-seller-${crypto.randomUUID()}@example.com`, email_confirm: true }); expect(seller.error).toBeNull(); sellerId = seller.data.user!.id; state.adminId = sellerId;
  await storeSellerKey(db, { sellerId, ...sellerKey, custody: 'managed' });
  const endpoint = await db.from('webhook_endpoints').insert({ url: `${origin}/lead`, secret, events: ['lead.captured'], is_active: true, product_filter_mode: 'selected' }).select('id').single(); expect(endpoint.error).toBeNull(); endpointId = endpoint.data!.id;
});
afterAll(async () => {
  if (endpointId) { await db.from('webhook_logs').delete().eq('endpoint_id', endpointId); await db.from('webhook_endpoints').delete().eq('id', endpointId); }
  if (products.length) { await db.from('issued_licenses').delete().in('product_id', products); await db.from('products').delete().in('id', products); }
  if (sellerId) { await db.from('seller_license_keys').delete().eq('seller_id', sellerId); users.push(sellerId); }
  for (const id of users) { await db.from('audit_log').delete().eq('user_id', id); await db.auth.admin.deleteUser(id); }
  if (savedPlatformLicense !== undefined) await db.from('integrations_config').update({ sellf_license: savedPlatformLicense }).eq('id', 1);
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
});

it.each((['magic-link', 'signed-in', 'pending'] as const).flatMap(flow => [false, true].map(requiredDomain => ({ flow, requiredDomain }))))('issues one registered license via $flow with requiredDomain=$requiredDomain @J13 @J14 @J15 @J16 @J17 @J18 @J233 @J234', async ({ flow, requiredDomain }) => {
  const email = `free-license-${crypto.randomUUID()}@example.com`, slug = `registered-${crypto.randomUUID()}`;
  const product = await db.from('products').insert({ name: 'Registered access', slug, price: 0, currency: 'PLN', is_active: true, seller_id: sellerId, auto_grant_duration_days: 3, issue_license_on_purchase: true, license_tier: 'registered', custom_checkout_fields: requiredDomain ? [{ id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain', pl: 'Domena' }, required: true, max_length: 253 }] : [] }).select('id').single(); expect(product.error).toBeNull(); const productId = product.data!.id; products.push(productId);
  expect((await db.from('webhook_endpoint_products').insert({ webhook_endpoint_id: endpointId, product_id: productId })).error).toBeNull();
  const customFieldValues = requiredDomain ? { _sellf_license_domain: 'https://www.buyer-license.example.org/path' } : {};
  let productReturn = `${process.env.SITE_URL}/pl/auth/product-access?product=${slug}`;
  state.client = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  if (flow === 'signed-in') {
    const password = 'Local-license-test-123';
    const user = await db.auth.admin.createUser({ email, password, email_confirm: true }); expect(user.error).toBeNull(); users.push(user.data.user!.id);
    expect((await state.client.auth.signInWithPassword({ email, password })).error).toBeNull();
  } else {
    const request = await magicRequest(new Request(`${process.env.SITE_URL}/api/auth/magic-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, flow: 'free_product', productSlug: slug, locale: 'pl', captchaToken: 'owned-fixture', customFieldValues }) }));
    expect(request.status).toBe(200);
    const mail = await waitForEmail(email), link = new URL(extractMagicLink(mail.HTML!)!);
    expect(mail.HTML?.includes('buyer-license.example.org')).toBe(false);
    expect(mail.Subject).toBe('Potwierdź swój email: Registered access');
    expect(mail.HTML).toContain('Registered access');
    productReturn = new URL(link.searchParams.get('redirect_to')!, process.env.SITE_URL).href;
    const verified = await state.client.auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: 'signup' }); expect(verified.error).toBeNull(); users.push(verified.data.user!.id);
  }
  if (flow !== 'signed-in') {
    expect((await state.client.auth.updateUser({ data: { _sellf_license_domain: 'unrelated.example.net' } })).error).toBeNull();
  }
  const user = (await state.client.auth.getUser()).data.user!;
  const submit = async () => {
    if (flow === 'magic-link') await expect(productAccess(new Request(productReturn))).rejects.toThrow('NEXT_REDIRECT');
    else if (flow === 'pending') await claimPendingFreeGrants({ userClient: state.client, user });
    else expect((await grantAccess(new NextRequest(`${process.env.SITE_URL}/api/public/products/${slug}/grant-access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customFieldValues }) }), { params: Promise.resolve({ slug }) })).status).toBe(200);
  };
  await submit();
  const licenses = await db.from('issued_licenses').select('id,license_key,order_id,user_id,email,product_id').eq('product_id', productId);
  expect(licenses.error).toBeNull(); expect(licenses.data?.length).toBe(1);
  const row = licenses.data![0], orderId = `free_${user.id}_${productId}`;
  expect({ orderId: row.order_id, userId: row.user_id, email: row.email, productId: row.product_id }).toEqual({ orderId, userId: user.id, email, productId });
  await expect.poll(async () => (await waitForEmail(email)).HTML ?? '', { timeout: 15000 }).toContain(row.license_key);
  const keyMail = await waitForEmail(email);
  expect(keyMail.Subject).toContain('Registered access');
  expect(decodeURIComponent(extractMagicLink(keyMail.HTML!)!)).toContain(`product=${slug}`);
  const jwks = await publicKeys(new NextRequest(`${process.env.SITE_URL}/api/licenses/jwks?seller=${sellerId}`)); expect(jwks.status).toBe(200);
  const verified = verifySellfLicense(row.license_key, { keys: (await jwks.json()).keys });
  expect(verified.valid).toBe(true);
  if (verified.valid) expect(verified.claims).toMatchObject({ product: slug, email, order: orderId, tier: 'registered', ...(requiredDomain ? { domain: 'buyer-license.example.org' } : {}), kid: sellerKey.kid, exp: null });
  if (verified.valid && !requiredDomain) expect(Object.hasOwn(verified.claims, 'domain')).toBe(false);
  await expect.poll(() => messages.filter(message => message.data.customer.email === email).length).toBe(1);
  const message = messages.find(entry => entry.data.customer.email === email)!;
  expect(message.event).toBe('lead.captured'); expect(message.data.license?.token === row.license_key).toBe(true);
  expect(message.data.license?.jwksUrl).toContain(`seller=${sellerId}`);
  const access = await db.from('user_product_access').select('custom_field_values').eq('user_id', user.id).eq('product_id', productId).single();
  expect(access.error).toBeNull(); expect(access.data!.custom_field_values).toEqual(requiredDomain ? { _sellf_license_domain: 'buyer-license.example.org' } : {});
  expect((message.data as unknown as { customFieldValues: unknown }).customFieldValues).toEqual(access.data!.custom_field_values);
  const event = await db.from('business_events').select('payload').eq('event_type', 'access.granted').eq('product_id', productId);
  expect(event.error).toBeNull();
  expect((event.data![0].payload as { customFieldValues: unknown }).customFieldValues).toEqual(access.data!.custom_field_values);
  const mailCount = (await searchMessages(email)).length;
  await submit();
  expect((await searchMessages(email)).length).toBe(mailCount);
  await Promise.all([0, 1].map(() => issueLicense(db, { productId, userId: user.id, email, orderId, customFieldValues: requiredDomain ? { _sellf_license_domain: 'buyer-license.example.org' } : {} })));
  const repeated = await db.from('issued_licenses').select('id').eq('product_id', productId);
  expect(repeated.data).toEqual([{ id: row.id }]); expect(messages.filter(entry => entry.data.customer.email === email).length).toBe(1);
});

it('mails the key to a buyer who signed in by magic link moments before claiming the free licensed product (W147-8) @J291', async () => {
  const email = `free-license-fresh-${crypto.randomUUID()}@example.com`, slug = `registered-fresh-${crypto.randomUUID()}`;
  const product = await db.from('products').insert({ name: 'Fresh login license', slug, price: 0, currency: 'PLN', is_active: true, seller_id: sellerId, issue_license_on_purchase: true, license_tier: 'registered' }).select('id').single();
  expect(product.error).toBeNull(); products.push(product.data!.id);
  state.client = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const login = await magicRequest(new Request(`${process.env.SITE_URL}/api/auth/magic-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, flow: 'login', locale: 'pl', captchaToken: 'owned-fixture' }) }));
  expect(login.status).toBe(200);
  const link = new URL(extractMagicLink((await waitForEmail(email)).HTML!)!);
  const verified = await state.client.auth.verifyOtp({ token_hash: link.searchParams.get('token_hash')!, type: 'signup' });
  expect(verified.error).toBeNull(); users.push(verified.data.user!.id);
  const before = (await searchMessages(email)).length;
  const granted = await grantAccess(new NextRequest(`${process.env.SITE_URL}/api/public/products/${slug}/grant-access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }), { params: Promise.resolve({ slug }) });
  expect(granted.status).toBe(200);
  const row = (await db.from('issued_licenses').select('license_key').eq('product_id', product.data!.id).single()).data!;
  await expect.poll(async () => (await searchMessages(email)).length, { timeout: 15000 }).toBeGreaterThan(before);
  await expect.poll(async () => (await waitForEmail(email)).HTML ?? '', { timeout: 15000 }).toContain(row.license_key);
});

it.each([false, true])('manual issuance follows the product domain policy: required=%s @J20 @J21', async required => {
  const p = await db.from('products').insert({ name: 'Manual domain policy', slug: `manual-${crypto.randomUUID()}`, price: 0, currency: 'PLN', seller_id: sellerId, issue_license_on_purchase: true, license_tier: 'registered', custom_checkout_fields: required ? [{ id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain', pl: 'Domena' }, required: true, max_length: 253 }] : [] }).select('id').single();
  expect(p.error).toBeNull(); products.push(p.data!.id);
  const result = await manualIssue(new NextRequest(`${process.env.SITE_URL}/api/admin/licenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: p.data!.id, email: 'manual-buyer@example.com' }) }));
  expect(result.status).toBe(required ? 400 : 201);
  if (!required) { const body = await result.json(); expect(Object.hasOwn(body.license.claims, 'domain')).toBe(false); }
});

it('does not let another authenticated account read or consume a checkout context', async () => {
  const targetEmail = `context-owner-${crypto.randomUUID()}@example.com`;
  const p = await db.from('products').insert({ name: 'Context ownership', slug: `context-${crypto.randomUUID()}`, price: 0, currency: 'PLN' }).select('id,slug').single(); expect(p.error).toBeNull(); products.push(p.data!.id);
  const request = await db.rpc('prepare_free_grant', { p_email: targetEmail, p_product_id: p.data!.id, p_values: { _sellf_license_domain: 'owner.example.com' } }); expect(request.error).toBeNull();
  const email = `context-reader-${crypto.randomUUID()}@example.com`, password = 'Local-context-123';
  const reader = await db.auth.admin.createUser({ email, password, email_confirm: true }); expect(reader.error).toBeNull(); users.push(reader.data.user!.id);
  const client = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
  const rows = await client.rpc('free_grant_context', { p_product_id: p.data!.id, p_request_id: request.data! }); expect(rows.error).toBeNull(); expect(rows.data).toEqual([]);
  const grant = await client.rpc('grant_free_with_context', { product_slug_param: p.data!.slug, p_request_id: request.data! }); expect(grant.error).toBeNull(); expect(grant.data).toBe(false);
  expect((await client.from('free_grant_contexts').select('*')).error).not.toBeNull();
});
it('manual issuance accepts the required domain when it is supplied @J21', async () => {
  const p = await db.from('products').insert({ name: 'Manual bound license', slug: `manual-domain-${crypto.randomUUID()}`, price: 0, currency: 'PLN', seller_id: sellerId, issue_license_on_purchase: true, license_tier: 'registered', custom_checkout_fields: [{ id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain', pl: 'Domena' }, required: true, max_length: 253 }] }).select('id').single(); expect(p.error).toBeNull(); products.push(p.data!.id);
  const result = await manualIssue(new NextRequest(`${process.env.SITE_URL}/api/admin/licenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: p.data!.id, email: 'manual-buyer@example.com', domain: 'https://www.manual.example.org/path' }) }));
  expect(result.status).toBe(201); expect((await result.json()).license.claims.domain).toBe('manual.example.org');
});

it('answers a rejected checkout domain with the field to fix, never a generic failure @J230', async () => {
  const slug = `bad-domain-${crypto.randomUUID()}`;
  const product = await db.from('products').insert({ name: 'Domain answer', slug, price: 0, currency: 'PLN', is_active: true, seller_id: sellerId, issue_license_on_purchase: true, license_tier: 'registered', custom_checkout_fields: [{ id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain', pl: 'Domena' }, required: true, max_length: 253 }] }).select('id').single();
  expect(product.error).toBeNull(); products.push(product.data!.id);
  const email = `bad-domain-${crypto.randomUUID()}@example.com`;
  const send = (value: string) => magicRequest(new Request(`${process.env.SITE_URL}/api/auth/magic-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, flow: 'free_product', productSlug: slug, locale: 'pl', captchaToken: 'owned-fixture', customFieldValues: { _sellf_license_domain: value } }) }));
  for (const [value, code] of [['wsparcieirozwoj.orgcasdcvsfdv3r23tgervv', 'invalid_domain'], ['', 'required'], ['x'.repeat(254), 'too_long:253']] as const) {
    const response = await send(value);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: 'invalid_request', fieldErrors: { _sellf_license_domain: code } });
  }
});
