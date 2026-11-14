/** Access API choices preserve separately issued licenses. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useSupabaseBuyerEmails } from '../helpers/buyer-email-setting';
import { parseLicenseClaims } from '@/lib/license-keys/format';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { API_URL, supabaseAdmin } from './setup';
useSupabaseBuyerEmails();
const db = supabaseAdmin();
let seller: string, adminId: string, buyer: string, key: string, narrow: string;
const product = randomUUID(), plain = randomUUID(), missing = randomUUID();
const keyIds: string[] = [];
async function makeKey(scopes: string[]) {
  const value = `sf_test_${randomBytes(32).toString('hex')}`;
  const saved = await db.from('api_keys').insert({ name: 'access-license-test', key_prefix: value.slice(0, 12), key_hash: createHash('sha256').update(value).digest('hex'), admin_user_id: adminId, scopes, rate_limit_per_minute: 1000 }).select('id').single();
  expect(saved.error).toBeNull(); keyIds.push(saved.data!.id); return value;
}
function call(method: string, value = key, body?: unknown, query = '') {
  return fetch(`${API_URL}/api/v1/users/${buyer}/access${query}`, { method, headers: { 'X-API-Key': value, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
beforeAll(async () => {
  const owner = await db.auth.admin.createUser({ email: `access-api-owner-${randomUUID()}@example.com`, email_confirm: true });
  expect(owner.error).toBeNull(); seller = owner.data.user!.id;
  const admin = await db.from('admin_users').insert({ user_id: seller }).select('id').single();
  expect(admin.error).toBeNull(); adminId = admin.data!.id;
  await storeSellerKey(db, { sellerId: seller, ...generateSellerKeypair(), custody: 'managed' });
  expect((await db.from('products').insert([
    { id: product, name: 'Access API license', slug: product, price: 10, currency: 'PLN', seller_id: seller, is_active: true, issue_license_on_purchase: true, license_tier: 'pro' },
    { id: plain, name: 'Access API plain', slug: plain, price: 10, currency: 'PLN', seller_id: seller, is_active: true, issue_license_on_purchase: false },
    { id: missing, name: 'Access API unconfigured', slug: missing, price: 10, currency: 'PLN', is_active: true, issue_license_on_purchase: true },
  ])).error).toBeNull();
  key = await makeKey(['users:write', 'licenses:write']); narrow = await makeKey(['users:write']);
});
// A fresh buyer per test: Supabase Auth sends at most one email per user per minute, and every license grant mails the buyer.
beforeEach(async () => {
  const customer = await db.auth.admin.createUser({ email: `access-api-buyer-${randomUUID()}@example.com`, email_confirm: true });
  expect(customer.error).toBeNull(); buyer = customer.data.user!.id;
});
afterEach(async () => {
  await db.from('issued_licenses').delete().in('product_id', [product, plain, missing]);
  await db.from('user_product_access').delete().eq('user_id', buyer);
  await db.auth.admin.deleteUser(buyer);
});
afterAll(async () => {
  await db.from('api_keys').delete().in('id', keyIds);
  await db.from('issued_licenses').delete().in('product_id', [product, plain, missing]);
  await db.from('user_product_access').delete().in('product_id', [product, plain, missing]);
  await db.from('products').delete().in('id', [product, plain, missing]);
  if (seller) { await db.from('seller_license_keys').delete().eq('seller_id', seller); await db.from('admin_users').delete().eq('user_id', seller); await db.auth.admin.deleteUser(seller); }
});
describe('access license API', () => {
  it('issues by default, retries the same grant and revokes its license @J197', async () => {
    const grant = await call('POST', key, { product_id: product });
    expect(grant.status).toBe(201);
    const { data } = await grant.json();
    expect(data.license).toMatchObject({ status: 'issued', email_sent: true });
    const retry = await call('POST', key, { product_id: product });
    expect(retry.status).toBe(201);
    expect((await retry.json()).data.license.id).toBe(data.license.id);
    expect((await call('DELETE', key, undefined, `?product_id=${product}`)).status).toBe(204);
    expect((await db.from('issued_licenses').select('revoked_at').eq('id', data.license.id).single()).data?.revoked_at).toBeTruthy();
  });
  it('gives access and an explicit warning to a key without license scope', async () => {
    const grant = await call('POST', narrow, { product_id: product });
    expect(grant.status).toBe(201);
    const { data } = await grant.json();
    expect(data.license).toBeNull(); expect(data.license_warning).toContain('licenses:write');
    const removed = await call('DELETE', narrow, undefined, `/${data.id}`);
    expect(removed.status).toBe(204);
    const licensed = await call('POST', key, { product_id: product });
    expect(licensed.status).toBe(201);
    const licensedData = (await licensed.json()).data;
    const retained = await call('DELETE', narrow, undefined, `/${licensedData.id}`);
    expect(retained.status).toBe(200);
    expect((await retained.json()).data.license_warning).toContain('licenses:write');
    expect((await db.from('issued_licenses').select('revoked_at').eq('id', licensedData.license.id).single()).data?.revoked_at).toBeNull();
  });
  it('respects issuance and revocation opt-outs', async () => {
    const opted = await call('POST', key, { product_id: product, issue_license: false });
    expect(opted.status).toBe(201); expect((await opted.json()).data.license).toBeNull();
    await call('DELETE', key, undefined, `?product_id=${product}`);
    const grant = await call('POST', key, { product_id: product });
    expect(grant.status).toBe(201); const { data } = await grant.json();
    expect((await call('DELETE', key, undefined, `/${data.id}?revoke_license=false`)).status).toBe(204);
    expect((await db.from('issued_licenses').select('revoked_at').eq('id', data.license.id).single()).data?.revoked_at).toBeNull();
  });
  it('does not issue for a plain product and rejects invalid options', async () => {
    expect((await call('POST', key, { product_id: plain, issue_license: 'false' })).status).toBe(400);
    const grant = await call('POST', key, { product_id: plain });
    expect(grant.status).toBe(201); expect((await grant.json()).data.license).toBeNull();
    expect((await call('DELETE', key, undefined, `?product_id=${plain}&revoke_license=no`)).status).toBe(400);
    await call('DELETE', key, undefined, `?product_id=${plain}`);
  });
  it('validates and forwards the product-required license domain', async () => {
    expect((await db.from('products').update({ custom_checkout_fields: [{ id: '_sellf_license_domain', type: 'domain', label: { en: 'Domain', pl: 'Domena' }, required: true, max_length: 253 }] }).eq('id', product)).error).toBeNull();
    try {
      const invalid = await call('POST', key, { product_id: product });
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).fieldErrors._sellf_license_domain).toBe('required');
      const valid = await call('POST', key, { product_id: product, license: { domain: 'client.example' } });
      expect(valid.status).toBe(201);
      const data = (await valid.json()).data;
      const stored = await db.from('issued_licenses').select('license_key').eq('id', data.license.id).single();
      expect(parseLicenseClaims(stored.data!.license_key)?.domain).toBe('client.example');
      await call('DELETE', key, undefined, `?product_id=${product}`);
    } finally {
      await db.from('products').update({ custom_checkout_fields: [] }).eq('id', product);
    }
  });
  it('reports issuance failure instead of a successful grant and allows retry', async () => {
    const grant = await call('POST', key, { product_id: missing });
    expect(grant.status).toBe(409);
    expect((await grant.json()).error.code).toBe('LICENSE_ISSUANCE_FAILED');
    await call('DELETE', key, undefined, `?product_id=${missing}`);
  });
});
