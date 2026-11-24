/** Minimal profile compatibility and seller navigation. @see tests/payment-return-account.spec.ts */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './helpers/proxy-test';
import { createTestAdmin, createTestUser, setAuthSession, loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import { deleteAuthUserByEmail } from './helpers/db-cleanup';
import { acceptAllCookies } from './helpers/consent';
import { useSupabaseBuyerEmails } from './helpers/buyer-email-setting-playwright';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { getTestDatabaseContainer } from './helpers/database-container';

useSupabaseBuyerEmails();

for (const locale of ['pl', 'en'] as const) {
  test(`profile refusal offers a working ${locale} link and warns the seller @J733`, async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const owner = await createTestAdmin('embed-profile'), id = randomUUID();
    const seller = createServer((_request, response) => response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<html lang="${locale}"><body><div data-sellf-embed data-product-slug="${id}" data-coupon="PREFILLED"></div><script src="${baseURL}/embed/v1/checkout.js"></script></body></html>`));
    await new Promise<void>(resolve => seller.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(seller.address() as AddressInfo).port}`, messages = locale === 'pl' ? pl : en;
    const profile = { v: 1, modules: [{ id: 'quantity', min: 2, max: 5, mode: 'checkout' }] };
    try {
      expect((await db.from('seller_embed_settings').upsert({ seller_id: owner.userId, allowed_embed_origins: [origin] })).error).toBeNull();
      expect((await db.from('products').insert({ id, slug: id, name: `Minimal ${id}`, price: 30, currency: 'PLN', embed_enabled: true, seller_id: owner.userId, checkout_profile: profile })).error).toBeNull();
      const refusal = page.waitForResponse(r => r.url().includes('/api/embed/checkout-session?') && r.request().method() === 'POST');
      await page.goto(`${origin}/checkout`);
      expect((await refusal).status()).toBe(422);
      const link = page.getByRole('link', { name: locale === 'pl' ? 'Przejdź do strony produktu' : 'Open the product page' });
      await expect(link).toHaveAttribute('href', `${baseURL}/${locale}/p/${id}`);
      await expect.poll(async () => (await db.from('embed_checkout_log').select('status,origin').eq('product_id', id)).data).toEqual([{ status: 'standard_checkout_required', origin }]);
      await link.click();
      await expect(page).toHaveURL(url => url.origin === new URL(baseURL!).origin && url.pathname.endsWith(`/p/${id}`));
      await expect(page.getByRole('heading', { name: `Minimal ${id}`, exact: true })).toBeVisible();
      await expect(page.locator('#checkoutQuantity')).toHaveValue('2');
      await loginAsAdmin(page, owner.email, owner.password);
      const usage = page.waitForResponse(r => r.url().includes(`/api/admin/embed/allowed-origins?productId=${id}&usage=1`));
      await page.goto(`/${locale}/dashboard/products?open=${id}&section=cart`);
      expect((await usage).status()).toBe(200);
      await expect(page.getByRole('status').filter({ hasText: origin })).toBeVisible();
      await expect(page.locator('#checkout-profile-errors')).toContainText(messages.checkoutProfile.errors.embed_incompatible);
      const refused = await page.request.patch(`/api/v1/products/${id}`, { headers: { Origin: baseURL! }, data: { checkout_profile: profile } });
      expect(refused.status()).toBe(400);
      const disabled = await page.request.patch(`/api/v1/products/${id}`, { headers: { Origin: baseURL! }, data: { embed_enabled: false, checkout_profile: profile } });
      expect(disabled.status(), await disabled.text()).toBe(200);
      const savedUsage = page.waitForResponse(r => r.url().includes(`/api/admin/embed/allowed-origins?productId=${id}&usage=1`));
      await page.goto(`/${locale}/dashboard/products?open=${id}&section=cart`);
      expect((await savedUsage).status()).toBe(200);
      await expect(page.getByRole('status').filter({ hasText: origin })).toBeVisible();
      await expect(page.locator('#checkout-profile-errors')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`embed-profile-${locale}.png`) });
    } finally {
      seller.closeAllConnections();
      await new Promise<void>(resolve => seller.close(() => resolve()));
      await db.from('embed_checkout_log').delete().eq('product_id', id);
      await db.from('products').delete().eq('id', id);
      await db.from('seller_embed_settings').delete().eq('seller_id', owner.userId);
      await owner.cleanup();
    }
  });
}

test('an unavailable gate shows the same navigation page as an unknown slug @J733', async ({ page }) => {
  const id = randomUUID();
  try {
    expect((await db.from('products').insert({ id, slug: id, name: 'Archived gate', price: 0, currency: 'PLN', is_active: false, archived_at: new Date().toISOString() })).error).toBeNull();
    await acceptAllCookies(page);
    const url = (slug: string) => `/pl/loginwall/gate?products=${slug}&redirect=${encodeURIComponent('https://merchant.example.com/page')}`;
    const archived = await page.request.get(url(id), { maxRedirects: 0 });
    const unknown = await page.request.get(url(randomUUID()), { maxRedirects: 0 });
    expect(archived.status()).toBe(400); expect(await archived.text()).toBe(await unknown.text());
    await page.goto(url(id));
    await expect(page.getByRole('link', { name: 'Wróć do sklepu' })).toHaveAttribute('href', '/pl');
  } finally { await db.from('products').delete().eq('id', id); }
});

test('the seller sees an uncertain transfer email and explicitly retries it @J733', async ({ page }) => {
  test.setTimeout(120000);
  const owner = await createTestAdmin('mail-retry'), product = randomUUID(), id = randomUUID(), email = `${id}@example.com`;
  try {
    expect((await db.from('products').insert({ id: product, slug: product, name: 'Mail retry', price: 10, currency: 'PLN' })).error).toBeNull();
    const placed = await db.from('payment_transactions').insert({ id, product_id: product, customer_email: email, amount: 1000, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1,
      transfer_mail_sent_at: new Date(Date.now() - 600000).toISOString(), transfer_mail_delivery_unknown: true, metadata: { locale: 'en' },
      transfer_details: { holder: 'Example', account: 'PL61109010140000071219812874', title: `Retry ${id}` } }).select('order_number').single();
    expect(placed.error).toBeNull();
    await loginAsAdmin(page, owner.email, owner.password);
    const loaded = page.waitForResponse(r => r.url().includes('/api/v1/payments?') && r.request().method() === 'GET');
    await page.goto(`/en/dashboard/payments?order=${placed.data!.order_number}`);
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: 'delivery outcome unknown' })).toBeVisible();
    const retried = page.waitForResponse(r => r.url().includes('/dashboard/payments') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Retry email', exact: true }).click();
    expect((await retried).status()).toBe(200);
    await expect.poll(async () => (await db.from('payment_transactions').select('transfer_mail_delivery_unknown').eq('id', id).single()).data?.transfer_mail_delivery_unknown).toBe(false);
    await expect(page.getByRole('status').filter({ hasText: 'delivery outcome unknown' })).toHaveCount(0);
    expect((await db.from('audit_log').select('new_values').eq('performed_by', owner.userId).contains('new_values', { action: 'retry_order_notice_requested', order_id: id })).data).toHaveLength(1);
    const messages = async () => (await (await page.request.get(`${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages;
    await expect.poll(async () => (await messages()).length).toBe(1);
    const mail = await messages();
    const message = await page.request.get(`${process.env.MAILPIT_URL}/api/v1/message/${mail[0].ID}`);
    expect((await message.json()).HTML).toContain(`Retry ${id}`);
  } finally {
    await db.from('audit_log').delete().eq('performed_by', owner.userId);
    await db.from('payment_transactions').delete().eq('id', id);
    await db.from('products').delete().eq('id', product);
    await deleteAuthUserByEmail(db, email);
    await owner.cleanup();
  }
});


test('license read failure leaves the buyer content available @J731', async ({ page }) => {
  const buyer = await createTestUser('content-license'), id = randomUUID();
  const sql = (statement: string) => execFileSync('docker', ['exec', getTestDatabaseContainer(), 'psql', '-Xq', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement]);
  try {
    expect((await db.from('products').insert({ id, slug: id, name: 'Licensed content', price: 10, currency: 'PLN', issue_license_on_purchase: true,
      content_delivery_type: 'content', content_config: { content_items: [{ id: 'file', type: 'download_link', title: 'Delivered buyer content', config: { download_url: 'https://drive.google.com/file/d/1AbcDefGhIjKlMnOpQrStUvWxYz123456/view' }, order: 0, is_active: true }] } })).error).toBeNull();
    expect((await db.from('user_product_access').insert({ product_id: id, user_id: buyer.userId })).error).toBeNull();
    await acceptAllCookies(page); await setAuthSession(page, buyer.email, buyer.password);
    sql('REVOKE SELECT ON public.issued_licenses FROM service_role;');
    expect((await db.from('issued_licenses').select('license_key').limit(1)).error?.code).toBe('42501');
    expect((await page.goto(`/en/p/${id}`))?.status()).toBe(200);
    await expect(page.getByText('Delivered buyer content', { exact: true })).toBeVisible();
    await expect(page.locator('a[download]')).toHaveAttribute('href', 'https://drive.google.com/file/d/1AbcDefGhIjKlMnOpQrStUvWxYz123456/view');
    const content = await page.request.get(`/api/public/products/${id}/content`);
    expect(content.status()).toBe(200); expect((await content.json()).license).toBeNull();
  } finally {
    sql('GRANT SELECT ON public.issued_licenses TO service_role;');
    await db.from('user_product_access').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id); await buyer.cleanup();
  }
});
