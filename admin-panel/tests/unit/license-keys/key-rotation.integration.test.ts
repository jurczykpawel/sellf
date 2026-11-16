/** Planned signing-key change: licenses signed before the change keep verifying offline through the JWKS URL. */
import { randomUUID } from 'node:crypto';
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

const db = createAdminClient();
const product = randomUUID();

async function publishedKeys(): Promise<Array<SellfPublicKey & { status: string }>> {
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

describe('planned signing-key change', () => {
  it('keeps the old key published as retired, so licenses signed before the change still verify @J630', async () => {
    const first = await generateSellerLicenseKey();
    expect(first.success).toBe(true);
    const before = await issueLicense(db, { productId: product, email: 'buyer@example.com', userId: null, orderId: `order_${randomUUID()}` });
    expect(before?.kid).toBe(first.data!.kid);

    const second = await generateSellerLicenseKey();
    expect(second.success).toBe(true);
    expect(second.data!.kid).not.toBe(first.data!.kid);

    const keys = await publishedKeys();
    expect(keys.map((k) => [k.kid, k.status])).toEqual([[second.data!.kid, 'active'], [first.data!.kid, 'retired']]);
    expect(verifySellfLicense(before!.token, { keys })).toMatchObject({ valid: true, claims: { kid: first.data!.kid } });

    const after = await issueLicense(db, { productId: product, email: 'buyer@example.com', userId: null, orderId: `order_${randomUUID()}` });
    expect(after?.kid).toBe(second.data!.kid);
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
});
