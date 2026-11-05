/** Guest access and buyer notifications with the two seller email settings. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import { MAILPIT_URL, extractMagicLink } from './helpers/mailpit';

test.describe.configure({ mode: 'serial' });
let product: { id: string; slug: string }, endpointId: string;
let bank: Record<string, unknown>, savedEmailSetting: boolean;
const emails: string[] = [];
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
test.beforeAll(async () => {
  bank = await checked(await db.from('bank_transfer_config').select('*').single());
  savedEmailSetting = (await checked(await db.from('shop_config').select('supabase_buyer_emails').single())).supabase_buyer_emails;
  await checked(await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Test Shop', bank_account_number: 'PL61109010140000071219812874', bank_name: 'Bank', bank_transfer_grant_access_on_placement: false }).eq('id', bank.id).select());
  product = await checked(await db.from('products').insert({ name: 'Buyer channel workshop', slug: `buyer-channel-${randomUUID()}`, price: 100, currency: 'PLN', vat_exempt: true, is_active: true,
    checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'], gus: false, bank_transfer_for: ['organization'] }] },
  }).select('id,slug').single());
  endpointId = (await checked(await db.from('webhook_endpoints').insert({ url: 'https://127.0.0.1/channel-fixture', events: ['order.placed','purchase.completed'], secret: 'test-only-secret', is_active: true }).select('id').single())).id;
});
test.afterAll(async () => {
  if (endpointId) { await db.from('webhook_logs').delete().eq('endpoint_id', endpointId); await db.from('webhook_endpoints').delete().eq('id', endpointId); }
  if (product) { await db.from('guest_purchases').delete().eq('product_id', product.id); await db.from('payment_transactions').delete().eq('product_id', product.id); await db.from('products').delete().eq('id', product.id); }
  if (bank) await db.from('bank_transfer_config').upsert(bank);
  await db.from('shop_config').update({ supabase_buyer_emails: savedEmailSetting }).not('id', 'is', null);
  const users = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users;
  for (const user of users.filter(u => emails.includes(u.email ?? ''))) await db.auth.admin.deleteUser(user.id);
});
for (const enabled of [false, true]) {
  test(`guest receives access and order webhook with Supabase buyer emails ${enabled ? 'on @J411' : 'off @J410'}`, async ({ page, request, browser }) => {
    test.setTimeout(120000);
    const email = `buyer-channel-${randomUUID()}@example.com`; emails.push(email);
    await checked(await db.from('shop_config').update({ supabase_buyer_emails: false }).not('id','is',null).select());
    const placed = await request.post('/api/orders/bank-transfer', { data: { productId: product.id, email, locale: 'pl', captchaToken: 'test', termsAccepted: true,
      moduleValues: { buyer: { type: 'organization', first_name: 'Anna', last_name: 'Testowa', email, company_name: 'Test Shop', nip: '5260250274', address: 'Prosta 1', postal_code: '00-001', city: 'Warszawa', country: 'PL' } },
    } });
    expect(placed.status(), await placed.text()).toBe(200);
    const order = await placed.json();
    await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
    await page.goto('/pl/dashboard/settings');
    const checkbox = page.getByRole('checkbox', { name: 'Wysyłaj maile do kupujących przez Supabase' });
    await expect(checkbox).toBeEnabled();
    await expect(checkbox).not.toBeChecked();
    if (enabled) { await checkbox.check(); await expect(checkbox).toBeChecked(); }
    await expect.poll(async () => (await db.from('shop_config').select('supabase_buyer_emails').single()).data?.supabase_buyer_emails).toBe(enabled);
    const paid = await page.request.post(`/api/v1/payments/${order.orderId}/mark-paid`, { data: { amount: order.amount, paidAt: new Date().toISOString() } });
    expect(paid.status(), await paid.text()).toBe(200);
    await expect.poll(async () => (await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type','purchase.completed').contains('payload',{ data:{ order:{ orderId:order.orderId } } })).data?.length).toBe(1);
    const log = await checked(await db.from('webhook_logs').select('payload').eq('endpoint_id',endpointId).eq('event_type','purchase.completed').contains('payload',{data:{order:{orderId:order.orderId}}}).single());
    expect(log.payload).toMatchObject({ event:'purchase.completed', data:{ customer:{email,locale:'pl'}, product:{id:product.id,name:'Buyer channel workshop'}, order:{orderId:order.orderId,amount:10000,currency:'PLN',settledVia:'bank_transfer'} } });
    const messages = async () => (await (await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages;
    await expect.poll(async () => (await messages()).length).toBe(1);
    const mail = await (await request.get(`${MAILPIT_URL}/api/v1/message/${(await messages())[0].ID}`)).json();
    if (enabled) { expect(mail.Subject).toContain('Płatność otrzymana'); expect(mail.HTML).toContain('Buyer channel workshop'); }
    else { expect(mail.Subject).toBe('Potwierdź swój email'); expect(mail.HTML).not.toContain('Buyer channel workshop'); expect(mail.HTML).not.toContain('100,00'); }
    const link = extractMagicLink(mail.HTML); expect(link).toBeTruthy();
    const buyerPage = await browser.newPage();
    try {
      await buyerPage.goto(link!);
      await expect.poll(async () => (await db.from('user_product_access').select('user_id').eq('product_id',product.id)).data?.length ?? 0).toBeGreaterThan(0);
      await expect(buyerPage).not.toHaveURL(/\/login(?:\?|$)/);
      const user = (await db.auth.admin.listUsers({ perPage:1000 })).data.users.find(u=>u.email===email);
      expect(user?.email_confirmed_at).toBeTruthy();
      expect((await db.from('user_product_access').select('id').eq('product_id',product.id).eq('user_id',user!.id)).data).toHaveLength(1);
    } finally { await buyerPage.close(); }
  });
}
