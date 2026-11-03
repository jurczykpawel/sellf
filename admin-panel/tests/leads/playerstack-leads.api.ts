/** Owned-stack HTTP acceptance for the PlayerStack lead endpoints. */
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { solveChallenge } from 'altcha-lib/v1';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalLeadsStack, leadsAppUrl, leadsOrigin } from './stack';

const base = leadsAppUrl;
const origin = leadsOrigin;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const productIds: string[] = [];
const emails: string[] = [];
const endpointIds: string[] = [];
let product: { id: string; slug: string };
let other: { id: string; slug: string };
let paid: { id: string; slug: string };
async function makeProduct(price = 0) {
  const id = randomUUID(); productIds.push(id);
  const { data, error } = await db.from('products').insert({ id, slug: `api-lead-${id}`, name: 'API lead guide', price, currency: 'USD', embed_enabled: true, is_active: true }).select('id,slug').single();
  expect(error).toBeNull(); return data!;
}
function call(path: string, body?: unknown, requestOrigin = origin, method = body === undefined ? 'GET' : 'POST') {
  return fetch(`${base}${path}`, { method, headers: { origin: requestOrigin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function challenge(id?: string) {
  const r = await call(`/api/leads/challenge${id ? `?product=${id}` : ''}`); expect(r.status).toBe(200);
  const c = await r.json(); const solved = await solveChallenge(c.altcha.challenge, c.altcha.salt, c.altcha.algorithm, c.altcha.maxnumber).promise;
  return { nonce: c.nonce, altcha: { ...c.altcha, number: solved!.number } };
}
const post = (body: unknown, requestOrigin = origin) => call('/api/leads/submit', body, requestOrigin);
const body = (c: unknown) => ({ ...c as object, product: product.id, email: 'api-invalid@example.com', src: 'https://files.example.com/video.mp4' });
beforeAll(async () => {
  assertLocalLeadsStack((actual, expected) => expect(actual).toBe(expected));
  product = await makeProduct(); other = await makeProduct(); paid = await makeProduct(10);
  await db.from('application_rate_limits').delete().in('action_type', ['leads_submit', 'leads_challenge', 'leads_config']);
});
afterAll(async () => {
  for (const id of endpointIds) { await db.from('webhook_logs').delete().eq('endpoint_id', id); await db.from('webhook_endpoints').delete().eq('id', id); }
  if (productIds.length) { await db.from('lead_submissions').delete().in('product_id', productIds); await db.from('products').delete().in('id', productIds); }
  for (const email of emails) {
    await db.from('lead_submissions').delete().eq('email', email);
    const { data } = await db.auth.admin.listUsers(); const user = data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
  }
});
describe('PlayerStack lead HTTP contract', () => {
  it('serves a full configuration and credentialed CORS for slug and UUID', async () => {
    for (const id of [product.id, product.slug]) {
      const r = await call(`/api/products/${id}/playerstack?locale=pl`); expect(r.status).toBe(200);
      expect(r.headers.get('access-control-allow-credentials')).toBe('true');
      const config = await r.json(); expect(config.emailGate.product).toBe(product.slug);
      expect(config.emailGate.marketingConsent).toMatchObject({ required: false, version: '1:pl' });
      expect(config.marketingConsent.en.version).toBe('1:en');
    }
  });
  it('responds to preflight and rejects a domain outside the allowlist', async () => {
    for (const path of ['/api/leads/challenge', '/api/leads/submit', `/api/products/${product.id}/playerstack`]) {
      const r = await call(`${path}?product=${product.id}`, undefined, origin, 'OPTIONS'); expect(r.status).toBe(204);
      expect((await call(path, path.endsWith('/submit') ? {} : undefined, 'https://other.example')).status).toBe(403);
    }
  });
  it('consumes nonce before email validation', async () => {
    const c = await challenge(product.slug);
    expect((await post({ ...body(c), email: 'invalid' })).status).toBe(400);
    expect((await post(body(c))).status).toBe(400);
  });
  it('consumes wrong-product and expired nonces', async () => {
    const c = await challenge(product.id);
    expect((await post({ ...body(c), product: other.id })).status).toBe(400);
    expect((await post(body(c))).status).toBe(400);
    const expired = await challenge(product.id);
    await db.from('lead_nonces').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('nonce_hash', createHash('sha256').update(expired.nonce).digest('hex'));
    expect((await post(body(expired))).status).toBe(400);
  });
  it('rejects paid products and missing product-required consent', async () => {
    expect((await call(`/api/leads/challenge?product=${paid.id}`)).status).toBe(404);
    await db.from('products').update({ lead_consent_required: true }).eq('id', product.id);
    expect((await post(body(await challenge(product.id)))).status).toBe(400);
    await db.from('products').update({ lead_consent_required: false }).eq('id', product.id);
    expect((await post({ ...body(await challenge()), product: undefined })).status).toBe(400);
  });
  it('requires the configured consent version', async () => {
    expect((await post({ ...body(await challenge(product.id)), marketingConsent: true, consentVersion: 'old:en' })).status).toBe(400);
  });
  it('accepts object and base64 ALTCHA while preserving pending canonical consent', async () => {
    for (const format of ['object', 'base64']) {
      const email = `api-lead-${randomUUID()}@example.com`; emails.push(email);
      const c = await challenge(product.id);
      const r = await post({ ...body(c), email, altcha: format === 'base64' ? Buffer.from(JSON.stringify(c.altcha)).toString('base64') : c.altcha, marketingConsent: true, consentVersion: '1:en', consentText: 'Supplemental display text' });
      expect(r.status).toBe(200); expect(await r.json()).toEqual({ status: 'check_email' });
      const { data, error } = await db.from('lead_submissions').select('*').eq('email', email).single();
      expect(error).toBeNull(); expect(data!.confirmed_at).toBeNull(); expect(data!.consent_text).toContain('unsubscribe'); expect(data!.client_consent_text).toBe('Supplemental display text');
    }
  });
  it('returns 413 for an oversized body', async () => {
    expect((await post({ padding: 'x'.repeat(20_000) })).status).toBe(413);
  });
  it('persists consent settings through the authenticated v1 write path', async () => {
    const settings = { lead_consent_required: true, lead_consent_version: 'v2', lead_consent_text_pl: 'Nowa zgoda', lead_consent_text_en: 'Updated consent' };
    const r = await fetch(`${base}/api/v1/products/${product.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TEST_API_KEY_PLAINTEXT}` }, body: JSON.stringify(settings) });
    expect(r.status).toBe(200); expect((await r.json()).data).toMatchObject(settings);
    const publicConfig = await (await call(`/api/products/${product.id}/playerstack`)).json();
    expect(publicConfig.emailGate.marketingConsent).toEqual({ required: true, text: 'Updated consent', version: 'v2:en' });
    const { error } = await db.from('products').update({ lead_consent_required: false }).eq('id', product.id);
    expect(error).toBeNull();
  });
  it('confirms only the matching signed-in email and delivers one webhook', async () => {
    const email = `confirm-${randomUUID()}@example.com`; emails.push(email);
    const password = randomUUID();
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true }); expect(created.error).toBeNull();
    const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    const signed = await auth.auth.signInWithPassword({ email, password }); expect(signed.error).toBeNull();
    const key = `sb-${new URL(process.env.SUPABASE_URL!).hostname.split('.')[0]}-auth-token`;
    const cookie = `${key}=base64-${Buffer.from(JSON.stringify(signed.data.session)).toString('base64url')}`;
    const token = createHash('sha256').update(randomUUID()).digest('hex');
    const lead = await db.from('lead_submissions').insert({ token_hash: createHash('sha256').update(token).digest('hex'), email, source: 'https://files.example.com/test.mp4', marketing_consent: true, consent_version: '1:en', consent_text: 'Canonical consent' }).select('id').single(); expect(lead.error).toBeNull();
    const endpoint = await db.from('webhook_endpoints').insert({ url: 'https://w103-receiver.example/hook', secret: 'whsec_local_lead_fixture', events: ['lead.captured'], is_active: true }).select('id').single(); expect(endpoint.error).toBeNull(); endpointIds.push(endpoint.data!.id);
    const url = `${base}/auth/lead?token=${token}`;
    expect((await fetch(url, { redirect: 'manual' })).status).toBe(401);
    const result = await fetch(url, { headers: { cookie }, redirect: 'manual' }); expect(result.status).toBe(307);
    const logs = await db.from('webhook_logs').select('status,error_message,payload').eq('endpoint_id', endpoint.data!.id);
    expect(logs.data).toHaveLength(1); expect(logs.data![0].error_message).toBeNull(); expect(logs.data![0].status).toBe('success');
    expect((logs.data![0].payload as {data:{leadId:string}}).data.leadId).toBe(lead.data!.id);
    await fetch(url, { headers: { cookie }, redirect: 'manual' });
    const repeated = await db.from('webhook_logs').select('id').eq('endpoint_id', endpoint.data!.id); expect(repeated.data).toHaveLength(1);
  });
  it('enforces the email limit independently of the IP bucket', async () => {
    const email = `limit-${randomUUID()}@example.com`;
    for (let i = 0; i < 6; i++) {
      await db.from('application_rate_limits').delete().eq('action_type', 'leads_submit');
      const c = await challenge(product.id);
      expect((await post({ ...body(c), email, altcha: 'invalid' })).status).toBe(i < 5 ? 400 : 429);
      expect((await post({ ...body(c), email })).status).toBe(400);
    }
  });
});
