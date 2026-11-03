/** Integrator issues, lists and revokes licenses with a scoped API key; the buyer gets the key by mail. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { verifySellfLicense } from '@/lib/license-keys/sdk';
import { API_URL, supabaseAdmin } from './setup';

const db = supabaseAdmin();
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:54324';
let seller: string, adminRow: string, product: string, kid: string;
const keys: Record<string, string> = {};
const keyIds: string[] = [];

async function apiKey(scopes: string[]): Promise<string> {
  const plaintext = `sf_test_${randomBytes(32).toString('hex')}`;
  const { data, error } = await db.from('api_keys').insert({
    name: `w133-${scopes.join('+')}`, key_prefix: plaintext.slice(0, 12), key_hash: createHash('sha256').update(plaintext).digest('hex'),
    admin_user_id: adminRow, scopes, rate_limit_per_minute: 1000, is_active: true,
  }).select('id').single();
  expect(error).toBeNull();
  keyIds.push(data!.id);
  return plaintext;
}
function call(key: string, path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}/api/v1/licenses${path}`, { ...init, headers: { 'X-API-Key': key, 'Content-Type': 'application/json' } });
}
async function mailsTo(email: string): Promise<string[]> {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  return Promise.all((list.messages ?? []).map(async (m: { ID: string }) => (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()).HTML as string));
}
async function waitForMail(email: string): Promise<string[]> {
  for (let i = 0; i < 20; i++) {
    const mails = await mailsTo(email);
    if (mails.length) return mails;
    await new Promise(r => setTimeout(r, 500));
  }
  return [];
}

beforeAll(async () => {
  const user = await db.auth.admin.createUser({ email: `w133-seller-${randomUUID()}@example.com`, email_confirm: true });
  expect(user.error).toBeNull();
  seller = user.data.user!.id;
  const admin = await db.from('admin_users').insert({ user_id: seller }).select('id').single();
  expect(admin.error).toBeNull();
  adminRow = admin.data!.id;
  const pair = generateSellerKeypair();
  kid = pair.kid;
  await storeSellerKey(db, { sellerId: seller, ...pair, custody: 'managed' });
  product = randomUUID();
  expect((await db.from('products').insert({
    id: product, name: 'W133 Plugin', slug: `w133-plugin-${product}`, price: 10, currency: 'PLN',
    seller_id: seller, issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: 365,
  })).error).toBeNull();
  keys.read = await apiKey(['licenses:read']);
  keys.write = await apiKey(['licenses:read', 'licenses:write']);
  keys.none = await apiKey(['products:read']);
});
afterAll(async () => {
  await db.from('api_keys').delete().in('id', keyIds);
  await db.from('issued_licenses').delete().eq('product_id', product);
  await db.from('products').delete().eq('id', product);
  await db.from('seller_license_keys').delete().eq('kid', kid);
  await db.from('admin_users').delete().eq('id', adminRow);
  await db.from('audit_log').delete().eq('performed_by', seller);
  await db.auth.admin.deleteUser(seller);
});

describe('licenses API v1', () => {
  it('issues a verifiable license, mails the buyer the key and announces license.issued @J176', async () => {
    const email = `w133-buyer-${randomUUID()}@example.com`;
    const created = await call(keys.write, '', { method: 'POST', body: JSON.stringify({ productId: product, email }) });
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data).toMatchObject({ productId: product, email, issuanceSource: 'api', status: 'active' });
    const jwks = await (await fetch(`${API_URL}/api/licenses/jwks?seller=${seller}`)).json();
    const verified = verifySellfLicense(data.token, { keys: jwks.keys });
    expect(verified.valid && verified.claims.email === email && verified.claims.tier === 'pro').toBe(true);

    const mails = await waitForMail(email);
    expect(mails.some(html => html.includes(data.token) && html.includes(`w133-plugin-${product}`))).toBe(true);
    const buyer = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    expect(JSON.stringify(buyer?.user_metadata ?? {})).not.toContain(data.token);

    const event = await db.from('business_events').select('event_type,payload').eq('product_id', product).eq('event_type', 'license.issued');
    expect(event.data?.some(e => (e.payload as { licenseRow: { id: string } }).licenseRow.id === data.id)).toBe(true);
    expect(JSON.stringify(event.data)).not.toContain(data.token);
  });

  it('skips the buyer mail on request and lists, reads and revokes through the same API', async () => {
    const email = `w133-quiet-${randomUUID()}@example.com`;
    const created = await call(keys.write, '', { method: 'POST', body: JSON.stringify({ productId: product, email, sendEmail: false }) });
    expect(created.status).toBe(201);
    const { data } = await created.json();
    await new Promise(r => setTimeout(r, 1500));
    expect(await mailsTo(email)).toEqual([]);

    const list = await (await call(keys.read, `?email=${encodeURIComponent(email)}&product_id=${product}`)).json();
    expect(list.data.map((l: { id: string }) => l.id)).toEqual([data.id]);
    expect(list.data[0].token).toBeUndefined();
    const one = await (await call(keys.read, `/${data.id}`)).json();
    expect(one.data).toMatchObject({ id: data.id, token: data.token, status: 'active' });

    expect((await call(keys.read, `/${data.id}`, { method: 'DELETE' })).status).toBe(403);
    const revoked = await call(keys.write, `/${data.id}`, { method: 'DELETE' });
    expect(revoked.status).toBe(200);
    expect((await (await call(keys.read, `/${data.id}`)).json()).data.status).toBe('revoked');
    const events = await db.from('business_events').select('payload').eq('product_id', product).eq('event_type', 'license.revoked');
    expect(events.data?.some(e => (e.payload as { licenseRow: { id: string } }).licenseRow.id === data.id)).toBe(true);
  });

  it('enforces scopes and validates input', async () => {
    expect((await call(keys.none, '')).status).toBe(403);
    expect((await call(keys.read, '', { method: 'POST', body: JSON.stringify({ productId: product, email: 'x@example.com' }) })).status).toBe(403);
    expect((await call(keys.write, '', { method: 'POST', body: JSON.stringify({ productId: product, email: 'not-an-email' }) })).status).toBe(400);
    expect((await call(keys.write, '', { method: 'POST', body: JSON.stringify({ productId: randomUUID(), email: 'x@example.com' }) })).status).toBe(409);
    expect((await call(keys.read, '/not-a-uuid')).status).toBe(400);
    expect((await call(keys.read, `/${randomUUID()}`)).status).toBe(404);
  });
});
