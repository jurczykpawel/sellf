import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { issueRequestedLicense } from '@/lib/license-keys/request';
import { formatTransferDeadline } from '@/lib/orders/transfer-format';
import { waitForEmail } from '../../helpers/mailpit';

vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));

it('mails the stored expiry after a seller manually issues a signed license', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `manual-license-${crypto.randomUUID()}@example.com`;
  const owner = await db.auth.admin.createUser({ email:`owner-${email}`, email_confirm:true });
  expect(owner.error).toBeNull();
  const seller = owner.data.user!.id;
  const product = crypto.randomUUID();
  try {
    await storeSellerKey(db, { sellerId:seller, ...generateSellerKeypair(), custody:'managed' });
    expect((await db.from('products').insert({ id:product, name:'Licencja warsztatowa', slug:`manual-${product}`, price:10,
      currency:'PLN', seller_id:seller, issue_license_on_purchase:true, license_duration_days:30 })).error).toBeNull();
    const result = await issueRequestedLicense({ productId:product, email, locale:'pl' }, { actorUserId:seller, source:'manual', origin:process.env.SITE_URL! });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.error);
    expect(result.license.emailSent).toBe(true);
    const saved = await db.from('issued_licenses').select('expires_at,license_key').eq('id',result.license.id).single();
    expect(saved.error).toBeNull();
    expect(saved.data!.expires_at).toBeTruthy();
    expect(saved.data!.license_key).toBe(result.license.token);
    const mail = await waitForEmail(email);
    expect(mail.Subject).toBe('Twój klucz licencyjny: Licencja warsztatowa');
    expect(mail.HTML).toContain('Licencja ważna do');
    expect(mail.HTML).toContain(formatTransferDeadline(saved.data!.expires_at,'pl'));
    expect(mail.HTML).toContain(result.license.token);
    const buyer = (await db.auth.admin.listUsers({perPage:1000})).data.users.find(u=>u.email===email);
    expect(buyer?.user_metadata).not.toHaveProperty('license_expires_at');
    expect(buyer?.user_metadata).not.toHaveProperty('license_key');
  } finally {
    await db.from('issued_licenses').delete().eq('product_id',product);
    await db.from('products').delete().eq('id',product);
    await db.from('seller_license_keys').delete().eq('original_seller_id',seller);
    const buyer=(await db.auth.admin.listUsers({perPage:1000})).data.users.find(u=>u.email===email);
    if(buyer) await db.auth.admin.deleteUser(buyer.id);
    await db.auth.admin.deleteUser(seller);
  }
});
