/** Planned signing-key change: licenses signed before the change keep verifying offline through the JWKS URL. */
import { createPublicKey, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ seller: '' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
vi.mock('@/lib/rate-limiting', async (original) => ({ ...await original<typeof import('@/lib/rate-limiting')>(), checkRateLimit: async () => true }));
vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminAuth: async (fn: (ctx: { user: { id: string } }) => Promise<unknown>) => fn({ user: { id: h.seller } }),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { generateSellerLicenseKey, uploadSellerLicenseKey } from '@/lib/actions/license-config';
import { generateSellerKeypair } from '@/lib/license-keys/keys';
import { issueLicense } from '@/lib/license-keys/issue';
import { verifySellfLicense, type SellfPublicKey } from '@/lib/license-keys/sdk';
import { GET as jwks } from '@/app/api/licenses/jwks/route';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const db = createAdminClient();
const product = randomUUID();
/** Licenses signed during this file, with the key that signed each one. */
const signed: Array<{ token: string; kid: string }> = [];

type PublishedKey = SellfPublicKey & { status: string; kty?: string; crv?: string; x?: string; y?: string; use?: string };

async function publishedKeys(): Promise<PublishedKey[]> {
  const res = await jwks(new NextRequest(`http://localhost/api/licenses/jwks?seller=${h.seller}`));
  expect(res.status).toBe(200);
  return (await res.json()).keys;
}

beforeAll(async () => {
  const owner = await db.auth.admin.createUser({ email: `rotation-${product}@example.com`, email_confirm: true });
  expect(owner.error).toBeNull();
  h.seller = owner.data.user!.id;
  expect((await db.from('products').insert({ id: product, slug: `rotation-${product}`, name: 'Rotation', price: 10, currency: 'PLN', seller_id: h.seller, issue_license_on_purchase: true, license_tier: 'pro' })).error).toBeNull();
});

afterAll(async () => {
  await db.from('issued_licenses').delete().eq('product_id', product);
  await db.from('products').delete().eq('id', product);
  await db.from('seller_license_keys').delete().eq('seller_id', h.seller);
  await db.auth.admin.deleteUser(h.seller);
});

function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-q'], {
    input: sql, encoding: 'utf8', timeout: 15000,
  }).trim();
}

/** Makes every new key row for this test seller fail to save, as a database write error would. */
function failKeyWritesForSeller(seller: string): () => void {
  psql(`
    CREATE OR REPLACE FUNCTION public.test_fail_key_write_${seller.replace(/-/g, '')}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.seller_id = '${seller}'::uuid THEN RAISE EXCEPTION 'simulated write failure'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_fail_key_write_${seller.replace(/-/g, '')} BEFORE INSERT ON public.seller_license_keys
      FOR EACH ROW EXECUTE FUNCTION public.test_fail_key_write_${seller.replace(/-/g, '')}();
  `);
  return () => psql(`
    DROP TRIGGER IF EXISTS test_fail_key_write_${seller.replace(/-/g, '')} ON public.seller_license_keys;
    DROP FUNCTION IF EXISTS public.test_fail_key_write_${seller.replace(/-/g, '')}();
  `);
}

async function activeKids(): Promise<string[]> {
  const { data, error } = await db.from('seller_license_keys').select('kid').eq('seller_id', h.seller).eq('is_active', true);
  expect(error).toBeNull();
  return (data ?? []).map((r) => r.kid as string);
}

describe('planned signing-key change', () => {
  it('keeps the old key published as retired, so licenses signed before the change still verify @J630', async () => {
    const first = await generateSellerLicenseKey();
    expect(first.success).toBe(true);
    const before = await issueLicense(db, { productId: product, email: 'buyer@example.com', userId: null, orderId: `order_${randomUUID()}` });
    expect(before?.kid).toBe(first.data!.kid);
    signed.push({ token: before!.token, kid: before!.kid });

    const second = await generateSellerLicenseKey();
    expect(second.success).toBe(true);
    expect(second.data!.kid).not.toBe(first.data!.kid);

    const keys = await publishedKeys();
    expect(keys.map((k) => [k.kid, k.status])).toEqual([[second.data!.kid, 'active'], [first.data!.kid, 'retired']]);
    expect(verifySellfLicense(before!.token, { keys })).toMatchObject({ valid: true, claims: { kid: first.data!.kid } });

    const after = await issueLicense(db, { productId: product, email: 'buyer@example.com', userId: null, orderId: `order_${randomUUID()}` });
    expect(after?.kid).toBe(second.data!.kid);
    signed.push({ token: after!.token, kid: after!.kid });
    expect(verifySellfLicense(after!.token, { keys })).toMatchObject({ valid: true, claims: { kid: second.data!.kid } });
  });

  it('an uploaded own key becomes the signing key and every earlier key stays published', async () => {
    const own = generateSellerKeypair();
    const uploaded = await uploadSellerLicenseKey(own.privateKeyPem);
    expect(uploaded).toMatchObject({ success: true, data: { kid: own.kid } });
    const keys = await publishedKeys();
    expect(keys[0]).toMatchObject({ kid: own.kid, status: 'active' });
    expect(keys.filter((k) => k.status === 'active')).toHaveLength(1);
    expect(keys.filter((k) => k.status === 'retired')).toHaveLength(2);
    expect(JSON.stringify(keys)).not.toMatch(/PRIVATE KEY|encrypted/i);
  });

  it('a key change that fails to save keeps the current key signing licenses @J631', async () => {
    const [current] = await activeKids();
    expect(current).toBeTruthy();
    const restore = failKeyWritesForSeller(h.seller);
    try {
      expect(await generateSellerLicenseKey()).toMatchObject({ success: false, errorCode: 'KEY_GENERATION_FAILED' });
      expect(await uploadSellerLicenseKey(generateSellerKeypair().privateKeyPem)).toMatchObject({ success: false, errorCode: 'STORE_FAILED' });
    } finally {
      restore();
    }
    expect(await activeKids()).toEqual([current]);
    const issued = await issueLicense(db, { productId: product, email: 'buyer@example.com', userId: null, orderId: `order_${randomUUID()}` });
    expect(issued?.kid).toBe(current);
  });

  it('parallel key changes leave exactly one signing key and publish every replaced key @J631', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => generateSellerLicenseKey()));
    expect(results.every((r) => r.success)).toBe(true);
    const created = results.map((r) => r.data!.kid);
    const active = await activeKids();
    expect(active).toHaveLength(1);
    expect(created).toContain(active[0]);
    const keys = await publishedKeys();
    expect(keys.filter((k) => k.status === 'active').map((k) => k.kid)).toEqual(active);
    expect(created.every((kid) => keys.some((k) => k.kid === kid))).toBe(true);
  });

  it('the key change runs only on the server', async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const k = generateSellerKeypair();
    const { error } = await anon.rpc('replace_seller_license_key', {
      p_seller_id: h.seller, p_kid: k.kid, p_public_key: k.publicKeyPem,
      p_encrypted_key: 'x', p_encryption_iv: 'x', p_encryption_tag: 'x', p_custody: 'managed',
    });
    expect(error?.code).toBe('42501');
    expect(await activeKids()).not.toContain(k.kid);
  });

  it('JWKS publishes every key as a standard EC P-256 JWK that imports as the same public key', async () => {
    const keys = await publishedKeys();
    expect(keys.some((k) => k.status === 'active')).toBe(true);
    expect(keys.some((k) => k.status === 'retired')).toBe(true);
    for (const key of keys) {
      expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: expect.any(String), pem: expect.stringContaining('BEGIN PUBLIC KEY') });
      expect(key.x).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(key.y).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const imported = createPublicKey({ key: key as unknown as import('node:crypto').JsonWebKey, format: 'jwk' });
      expect(imported.export({ type: 'spki', format: 'pem' }).toString().trim()).toBe(key.pem.trim());
    }
  });

  it('the verifier from the integration guide (EN and PL) accepts licenses signed by active and retired keys', async () => {
    const keys = await publishedKeys();
    expect(signed.length).toBeGreaterThanOrEqual(2);
    expect(signed.every(({ kid }) => keys.some((k) => k.kid === kid && k.status === 'retired'))).toBe(true);
    const activeLicense = await issueLicense(db, { productId: product, email: 'buyer@example.com', userId: null, orderId: `order_${randomUUID()}` });
    const licenses = [...signed, { token: activeLicense!.token, kid: activeLicense!.kid }];
    expect(keys.find((k) => k.kid === activeLicense!.kid)?.status).toBe('active');

    const dir = mkdtempSync(join(tmpdir(), 'sellf-doc-verifier-'));
    try {
      for (const locale of ['', 'pl/']) {
        const doc = readFileSync(resolve(__dirname, `../../../../docs-site/src/content/docs/${locale}license-integration.md`), 'utf8');
        const code = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
        expect(code, `TypeScript verifier in ${locale || 'en/'}license-integration.md`).toContain('export function verifyLicenseKey');
        const file = join(dir, `${locale ? 'pl' : 'en'}-sellf-license.ts`);
        writeFileSync(file, code!);
        const mod = await import(/* @vite-ignore */ file) as { verifyLicenseKey: (t: string, k: unknown[], e: { product: string }) => { valid: boolean } };
        for (const { token, kid } of licenses) {
          expect(mod.verifyLicenseKey(token, keys, { product: `rotation-${product}` })).toMatchObject({ valid: true });
          expect(mod.verifyLicenseKey(token, keys.filter((k) => k.kid !== kid), { product: `rotation-${product}` })).toMatchObject({ valid: false });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
