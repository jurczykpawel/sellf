/**
 * DB TEST (W256c): a license issued by hand or through API v1 is handed out only with its audit
 * entry. Before, only a license for an access grant checked the entry; the standalone path returned
 * the key and mailed it even when audit_log refused the row.
 * @see src/lib/license-keys/request.ts
 */
import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { issueRequestedLicense } from '@/lib/license-keys/request';

vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));

it.each(['api', 'manual'] as const)('a %s license whose audit entry is refused is not handed out', async (source) => {
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
    expect(result).toEqual({ ok: false, status: 500, error: 'License audit could not be saved' });
    const audit = await db.from('audit_log').select('id').eq('performed_by', missingActor);
    expect(audit.data).toEqual([]);
  } finally {
    await db.from('issued_licenses').delete().eq('product_id', product);
    await db.from('products').delete().eq('id', product);
    await db.from('seller_license_keys').delete().eq('original_seller_id', seller);
    const buyer = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (buyer) await db.auth.admin.deleteUser(buyer.id);
    await db.auth.admin.deleteUser(seller);
  }
});
