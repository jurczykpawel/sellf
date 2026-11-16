/**
 * DB TEST (W256c, W256d): a license issued by hand or through API v1 exists only together with its
 * audit entry. W256c stopped the token and the mail, but the license row was already committed, and
 * its insert trigger queued license.issued — whose payload carries the key to every subscribed
 * endpoint (W256cr P1). Now the license, its license.issued event and the audit entry are one
 * transaction: a refused entry leaves none of the three.
 * @see src/lib/license-keys/request.ts
 * @see supabase/migrations/20261111110000_access_licenses.sql (issue_license_with_audit)
 */
import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { issueRequestedLicense } from '@/lib/license-keys/request';
import { sendLicenseMail } from '@/lib/license-keys/license-mail';

vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
vi.mock('@/lib/license-keys/license-mail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/license-keys/license-mail')>()),
  sendLicenseMail: vi.fn(async () => 'sent'),
}));

it.each(['api', 'manual'] as const)('a %s license whose audit entry is refused leaves no license, no event, no audit and no mail', async (source) => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `w256c-license-${crypto.randomUUID()}@example.com`;
  const owner = await db.auth.admin.createUser({ email: `owner-${email}`, email_confirm: true });
  expect(owner.error).toBeNull();
  const seller = owner.data.user!.id;
  const product = crypto.randomUUID();
  try {
    await storeSellerKey(db, { sellerId: seller, ...generateSellerKeypair(), custody: 'managed' });
    expect((await db.from('products').insert({ id: product, name: 'Licencja audyt', slug: `w256c-${product}`, price: 10,
      currency: 'PLN', seller_id: seller, issue_license_on_purchase: true, license_duration_days: 30 })).error).toBeNull();
    // audit_log.performed_by references auth.users: an actor that is no auth user makes the entry fail.
    const missingActor = crypto.randomUUID();
    const result = await issueRequestedLicense({ productId: product, email, locale: 'pl', sendEmail: true }, { actorUserId: missingActor, source, origin: process.env.SITE_URL! });
    expect(result).toMatchObject({ ok: false, status: 500 });
    const audit = await db.from('audit_log').select('id').eq('performed_by', missingActor);
    expect(audit.data).toEqual([]);
    const licenses = await db.from('issued_licenses').select('id').eq('product_id', product);
    expect(licenses.error).toBeNull();
    expect(licenses.data).toEqual([]);
    // Product lifecycle events from the product insert above are not part of this check.
    const events = await db.from('business_events').select('id, event_type').eq('product_id', product).like('event_type', 'license.%');
    expect(events.error).toBeNull();
    expect(events.data).toEqual([]);
    expect(vi.mocked(sendLicenseMail)).not.toHaveBeenCalled();
  } finally {
    await db.from('business_events').delete().eq('product_id', product);
    await db.from('issued_licenses').delete().eq('product_id', product);
    await db.from('products').delete().eq('id', product);
    await db.from('seller_license_keys').delete().eq('original_seller_id', seller);
    const buyer = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (buyer) await db.auth.admin.deleteUser(buyer.id);
    await db.auth.admin.deleteUser(seller);
  }
});

it.each(['api', 'manual'] as const)('a %s license with a valid actor commits the license, its event and its audit entry together', async (source) => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `w256d-license-${crypto.randomUUID()}@example.com`;
  const owner = await db.auth.admin.createUser({ email: `owner-${email}`, email_confirm: true });
  expect(owner.error).toBeNull();
  const seller = owner.data.user!.id;
  const product = crypto.randomUUID();
  try {
    await storeSellerKey(db, { sellerId: seller, ...generateSellerKeypair(), custody: 'managed' });
    expect((await db.from('products').insert({ id: product, name: 'Licencja audyt', slug: `w256d-${product}`, price: 10,
      currency: 'PLN', seller_id: seller, issue_license_on_purchase: true, license_duration_days: 30 })).error).toBeNull();
    const result = await issueRequestedLicense({ productId: product, email, locale: 'pl', sendEmail: false }, { actorUserId: seller, source, origin: process.env.SITE_URL! });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const licenses = await db.from('issued_licenses').select('id, license_key, issuance_source').eq('product_id', product);
    expect(licenses.data).toEqual([{ id: result.license.id, license_key: result.license.token, issuance_source: source }]);
    const events = await db.from('business_events').select('event_type').eq('product_id', product).like('event_type', 'license.%');
    expect(events.data).toEqual([{ event_type: 'license.issued' }]);
    const audit = await db.from('audit_log').select('table_name, operation, performed_by, new_values').eq('performed_by', seller);
    expect(audit.data).toEqual([{ table_name: 'issued_licenses', operation: 'INSERT', performed_by: seller, new_values: expect.objectContaining({
      action: source === 'api' ? 'API_LICENSE_ISSUED' : 'MANUAL_LICENSE_ISSUED', license_id: result.license.id, product_id: product, email, kid: result.license.kid }) }]);
  } finally {
    await db.from('audit_log').delete().eq('performed_by', seller);
    await db.from('business_events').delete().eq('product_id', product);
    await db.from('issued_licenses').delete().eq('product_id', product);
    await db.from('products').delete().eq('id', product);
    await db.from('seller_license_keys').delete().eq('original_seller_id', seller);
    await db.auth.admin.deleteUser(seller);
  }
});
