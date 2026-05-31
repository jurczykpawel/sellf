/**
 * License keys E2E — exercises the real public-keys (JWKS) route against a live
 * Supabase: the SECURITY DEFINER reader returns only public material, and a
 * license signed with the seller's key verifies offline against the published
 * public key. Full purchase→issue path is covered by issue.ts unit tests; this
 * asserts the real HTTP/DB/RLS surface.
 */
import { test, expect } from '@playwright/test';
import { createSign, createVerify, createHash, generateKeyPairSync } from 'node:crypto';
import { supabaseAdmin } from './helpers/admin-auth';

test.describe.configure({ mode: 'serial' });

const RUN_ID = `lk-e2e-${Date.now()}`;

let seller: { id: string };
let keypair: { publicKey: string; privateKey: string };
let kid: string;

function deriveKid(pem: string): string {
  return createHash('sha256').update(pem).digest('hex').slice(0, 16);
}
function signLicense(claims: object, privateKeyPem: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createSign('SHA256').update(payload).end().sign(privateKeyPem).toString('base64url');
  return `${payload}.${sig}`;
}
function verifyOffline(token: string, publicKeyPem: string): boolean {
  const [payload, sig] = token.split('.');
  try {
    return createVerify('SHA256').update(payload).end().verify(publicKeyPem, Buffer.from(sig, 'base64url'));
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: `${RUN_ID}@example.com`,
    password: 'password123',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  seller = { id: data.user.id };

  const kp = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  keypair = { publicKey: kp.publicKey, privateKey: kp.privateKey };
  kid = deriveKid(keypair.publicKey);

  // The JWKS reader only returns public columns, so the encrypted_* columns can
  // hold placeholders for this test (we never decrypt here).
  const { error: insErr } = await supabaseAdmin.from('seller_license_keys').insert({
    seller_id: seller.id,
    kid,
    public_key: keypair.publicKey,
    encrypted_key: 'placeholder',
    encryption_iv: 'placeholder',
    encryption_tag: 'placeholder',
    custody: 'managed',
    alg: 'ES256',
  });
  if (insErr) throw new Error(`seed key: ${insErr.message}`);
});

test.afterAll(async () => {
  if (seller?.id) {
    await supabaseAdmin.from('seller_license_keys').delete().eq('seller_id', seller.id);
    await supabaseAdmin.auth.admin.deleteUser(seller.id);
  }
});

test.describe('License keys', () => {
  test('JWKS endpoint returns the public key and no private material', async ({ request }) => {
    const res = await request.get(`/api/licenses/jwks?seller=${seller.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.keys).toEqual([{ kid, alg: 'ES256', pem: keypair.publicKey }]);
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/PRIVATE KEY|encrypted_key|encryption_iv|encryption_tag|placeholder/);
  });

  test('400s on a missing/invalid seller', async ({ request }) => {
    expect((await request.get('/api/licenses/jwks?seller=not-a-uuid')).status()).toBe(400);
  });

  test('a license signed with the seller key verifies offline against the published key', async ({ request }) => {
    const res = await request.get(`/api/licenses/jwks?seller=${seller.id}`);
    const pem = (await res.json()).keys[0].pem as string;

    const token = signLicense(
      { v: 1, kid, product: 'pro-kit', email: 'buyer@example.com', order: 'ord_x', tier: 'pro', iat: 1000, exp: null },
      keypair.privateKey,
    );
    expect(verifyOffline(token, pem)).toBe(true);

    const altered = Buffer.from(JSON.stringify({ v: 1, kid, product: 'pro-kit', tier: 'business' })).toString('base64url') + '.' + token.split('.')[1];
    expect(verifyOffline(altered, pem)).toBe(false);
  });

  test('the private key table is not readable through the anon REST API (RLS)', async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const res = await request.get(`${url}/rest/v1/seller_license_keys?select=encrypted_key&seller_id=eq.${seller.id}`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    // RLS denies anon: either an error status or an empty array — never the encrypted key.
    const text = await res.text();
    expect(text).not.toContain('placeholder');
  });
});
