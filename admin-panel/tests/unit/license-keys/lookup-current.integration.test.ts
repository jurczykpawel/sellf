/** Buyer license selection against persisted ownership and status. */
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { findIssuedLicense, toIssuedLicenseResponse } from '@/lib/license-keys/lookup';

it('keeps an independent key available after a newer bundle key is refunded @J712', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `lookup-${crypto.randomUUID()}@example.com`;
  const buyer = await db.auth.admin.createUser({ email, email_confirm: true });
  expect(buyer.error).toBeNull();
  const user = { id: buyer.data.user!.id, email, email_confirmed_at: buyer.data.user!.email_confirmed_at };
  const product = crypto.randomUUID(), other = crypto.randomUUID();
  const owned = db as unknown as Parameters<typeof findIssuedLicense>[0];
  try {
    expect((await db.from('products').insert({ id: product, name: 'Licensed A', slug: product, price: 10, currency: 'PLN' })).error).toBeNull();
    const row = { product_id: product, seller_id: user.id, original_seller_id: user.id, email, user_id: user.id, kid: 'test-key', expires_at: null };
    const independent = { ...row, order_id: 'independent', license_key: 'independent.token', issued_at: '2026-01-01T00:00:00Z' };
    expect((await db.from('issued_licenses').insert([independent, { ...row, order_id: 'bundle', license_key: 'bundle.token', issued_at: '2026-02-01T00:00:00Z', revoked_at: '2026-02-02T00:00:00Z', revocation_reason: 'refund' }])).error).toBeNull();
    expect(toIssuedLicenseResponse(await findIssuedLicense(owned, product, user))).toMatchObject({ token: 'independent.token', status: 'active' });
    expect(await findIssuedLicense(owned, product, { id: other, email, email_confirmed_at: user.email_confirmed_at })).toBeNull();
    // A confirmed guest key is also eligible, but never a key assigned to another account.
    expect((await db.from('issued_licenses').update({ user_id: null }).eq('order_id', 'independent').eq('product_id', product)).error).toBeNull();
    expect(toIssuedLicenseResponse(await findIssuedLicense(owned, product, user))).toMatchObject({ token: 'independent.token', status: 'active' });
    expect(toIssuedLicenseResponse(await findIssuedLicense(owned, product, { ...user, email_confirmed_at: null }))?.status).toBe('revoked');
    expect((await db.from('issued_licenses').update({ expires_at: '2026-01-02T00:00:00Z' }).eq('order_id', 'independent').eq('product_id', product)).error).toBeNull();
    expect(toIssuedLicenseResponse(await findIssuedLicense(owned, product, user))?.status).toBe('revoked');
    expect((await db.from('issued_licenses').delete().eq('order_id', 'bundle').eq('product_id', product)).error).toBeNull();
    expect(toIssuedLicenseResponse(await findIssuedLicense(owned, product, user))?.status).toBe('expired');
    expect(await findIssuedLicense(owned, product, { ...user, email: 'other@example.com' })).toBeNull();
  } finally {
    await db.from('business_events').delete().eq('product_id', product);
    await db.from('issued_licenses').delete().eq('product_id', product);
    await db.from('products').delete().eq('id', product);
    await db.auth.admin.deleteUser(user.id);
  }
});
