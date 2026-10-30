/** Buyer-visible coupon, initialization and consent contracts; persistent panel navigation. */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin, createTestUser, setAuthSession } from './helpers/admin-auth';
import { test, startNativeCheckout } from './helpers/checkout-intent';
import { openSettingsTab, PAYMENTS_TAB } from './helpers/settings-tabs';
import type { Page } from '@playwright/test';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const run = randomUUID();
const products: Array<{ id: string; slug: string; name: string; template: string }> = [];
const sessions = new Set<string>();
let coupon: { id: string; code: string };
let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let buyer: Awaited<ReturnType<typeof createTestUser>>;
let sellerId: string;
let sellerOrigin: string;
let sellerHtml = '';
let sellfOrigin: string;
const seller = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(sellerHtml); });
const company = { company_name: 'Example workshops', nip: '5260250274', address: 'Main 1', city: 'Warszawa', postal_code: '00-001' };
async function insert(table: string, value: object) {
  const { data, error } = await db.from(table).insert(value).select().single();
  expect(error).toBeNull(); return data!;
}
function remember(body: { checkoutSessionId?: string; sessionId?: string }) {
  const id = body.checkoutSessionId ?? body.sessionId;
  if (id?.startsWith('cs_')) sessions.add(id);
}
async function fillBuyer(page: Page) {
  for (const [key, value] of Object.entries(company)) await page.locator(`[id="buyer.${key}"]`).fill(value);
}
async function setTerms(page: Page, enabled: boolean) {
  await setAuthSession(page, admin.email, admin.password);
  const toggle = page.getByRole('switch', { name: 'Terms of Service Consent', exact: true });
  await openSettingsTab(page, PAYMENTS_TAB, toggle, '/en/dashboard/settings');
  if ((await toggle.getAttribute('aria-checked')) !== String(enabled)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
  await expect.poll(async () => (await db.from('shop_config').select('checkout_collect_terms').single()).data?.checkout_collect_terms).toBe(enabled);
  await page.context().clearCookies({ name: /^sb-/ });
}
test.beforeAll(async ({ baseURL }) => {
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  expect(new URL(process.env.SUPABASE_URL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  sellfOrigin = baseURL!;
  admin = await createTestAdmin('cart-admin'); buyer = await createTestUser('cart-buyer');
  sellerId = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === admin.email)!.id;
  for (const template of ['default', 'tip-jar', 'oto', 'bank']) {
    const row = await insert('products', { name: `Cart ${run} ${template}`, slug: `cart-${run}-${template}`, price: 49, currency: 'PLN', is_active: true, is_listed: true,
      seller_id: sellerId, embed_enabled: true, allow_custom_price: template === 'tip-jar', vat_exempt: true, checkout_template: template === 'bank' ? 'default' : template,
      ...(template === 'bank' ? { checkout_profile: { v: 1, modules: [
        { id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] },
        { id: 'quantity', min: 1, max: 3, mode: 'checkout' },
      ] } } : {}) });
    products.push({ ...row, template });
  }
  coupon = await insert('coupons', { code: `CART${run.slice(0, 8).toUpperCase()}`, name: 'Cart contract', discount_type: 'percentage', discount_value: 10, is_active: true, allowed_product_ids: products.map(p => p.id) });
  await insert('product_offer_config', { product_id: products[0].id, published: { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null } });
  await new Promise<void>(resolve => seller.listen(0, '127.0.0.1', resolve));
  const address = seller.address(); if (!address || typeof address === 'string') throw new Error('Seller server required');
  sellerOrigin = `http://127.0.0.1:${address.port}`;
  expect((await db.from('seller_embed_settings').upsert({ seller_id: sellerId, allowed_embed_origins: [sellerOrigin] })).error).toBeNull();
});
test.afterAll(async () => {
  for (const id of sessions) { const row = await stripe.checkout.sessions.retrieve(id); if (row.status === 'open') await stripe.checkout.sessions.expire(id).catch(async error => { if ((await stripe.checkout.sessions.retrieve(id)).status !== 'expired') throw error; }); }
  const ids = products.map(p => p.id);
  if (ids.length) {
    await db.from('invoices').delete().in('transaction_id', (await db.from('payment_transactions').select('id').in('product_id', ids)).data?.map(p => p.id) ?? []);
    await db.from('guest_purchases').delete().in('product_id', ids);
    await db.from('payment_transactions').delete().in('product_id', ids);
    if (coupon) { await db.from('coupon_reservations').delete().eq('coupon_id', coupon.id); await db.from('coupon_redemptions').delete().eq('coupon_id', coupon.id); await db.from('coupons').delete().eq('id', coupon.id); }
    await db.from('products').delete().in('id', ids);
  }
  if (sellerId) await db.from('seller_embed_settings').delete().eq('seller_id', sellerId);
  const guests = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.filter(user => user.email === `cart-guest-${run}@example.com`);
  for (const guest of guests) await db.auth.admin.deleteUser(guest.id);
  await buyer?.cleanup(); await admin?.cleanup();
  seller.closeAllConnections(); await new Promise<void>(resolve => seller.close(() => resolve()));
});

for (const locale of ['en', 'pl']) test(`${locale}: coupon stays absent by default across native cart entries`, async ({ page }) => {
  test.setTimeout(240000); await acceptAllCookies(page);
  for (const entry of ['product', 'default', 'tip-jar', 'oto', 'offer', 'store']) for (const linked of [false, true]) {
    const product = products.find(p => p.template === entry) ?? products[0];
    let destination = `/${locale}/${entry === 'product' ? 'p' : 'checkout'}/${product.slug}`;
    if (entry === 'offer' || entry === 'store') {
      await page.goto(entry === 'offer' ? `/${locale}/offer/${product.slug}` : `/${locale}/store?search=${encodeURIComponent(product.name)}`);
      const buy = page.locator(`a[href$="/checkout/${product.slug}"], a[href$="/p/${product.slug}"], a[href$="/offer/${product.slug}"]`).first();
      await expect(buy).toBeVisible(); destination = (await buy.getAttribute('href'))!;
      if (destination.includes('/offer/')) {
        await page.goto(destination);
        const checkout = page.locator(`a[href$="/checkout/${product.slug}"]`).first();
        await expect(checkout).toBeVisible(); destination = (await checkout.getAttribute('href'))!;
      }
    }
    await page.goto(`${destination}${linked ? `?coupon=${coupon.code}` : ''}`);
    const response = await startNativeCheckout(page); const body = await response.json(); remember(body);
    await expect(page.getByRole('button', { name: /^(Continue to payment|Przejdź do płatności)$/ })).toHaveCount(0);
    const field = page.getByRole('textbox', { name: locale === 'pl' ? 'Kod rabatowy' : 'Discount code', exact: true });
    if (linked) { await expect(field).toHaveValue(coupon.code); await expect(field).toBeDisabled(); }
    else { await expect(field).toHaveCount(0); await expect(page.getByText(locale === 'pl' ? 'Masz kod rabatowy?' : 'Have a discount code?', { exact: true })).toHaveCount(0); }
    const session = await stripe.checkout.sessions.retrieve(body.checkoutSessionId);
    expect(session.amount_total).toBe(linked ? 4410 : 4900);
  }
  const bank = products.find(p => p.template === 'bank')!;
  for (const linked of [false, true]) {
    await page.goto(`/${locale}/checkout/${bank.slug}${linked ? `?coupon=${coupon.code}` : ''}`);
    await page.locator('input[name=payment-method][value=transfer]').check();
    const field = page.getByRole('textbox', { name: locale === 'pl' ? 'Kod rabatowy' : 'Discount code', exact: true });
    if (linked) await expect(field).toHaveValue(coupon.code); else await expect(field).toHaveCount(0);
    await expect(page.getByTestId('order-summary-total')).toContainText(locale === 'pl' ? (linked ? '44,10' : '49,00') : (linked ? '44.10' : '49.00'));
  }
});

for (const locale of ['en', 'pl']) test(`${locale}: external embed only exposes a supplied coupon`, async ({ page }) => {
  test.setTimeout(120000);
  for (const linked of [false, true]) {
    sellerHtml = `<!doctype html><html lang="${locale}"><body><div data-sellf-embed data-product-slug="${products[0].slug}"></div><script src="${sellfOrigin}/embed/v1/checkout.js"></script></body></html>`;
    const responsePromise = page.waitForResponse(r => r.url().includes('/api/embed/checkout-session') && r.request().method() === 'POST');
    await page.goto(`${sellerOrigin}/${linked ? `?coupon=${coupon.code}` : ''}`);
    const response = await responsePromise; const body = await response.json(); expect(response.status(), JSON.stringify(body)).toBe(200); remember(body);
    await expect(page.locator('iframe[name="embedded-checkout"]')).toBeVisible({ timeout: 60000 });
    const input = page.locator('input[name=coupon]');
    if (linked) await expect(input).toHaveValue(coupon.code); else await expect(input).toHaveCount(0);
    expect(response.request().postDataJSON().couponCode).toBe(linked ? coupon.code : undefined);
    expect((await stripe.checkout.sessions.retrieve(body.sessionId)).amount_total).toBe(linked ? 4410 : 4900);
  }
});

test('online-only loads immediately; method choice does not create unused sessions', async ({ page }) => {
  test.setTimeout(120000); await acceptAllCookies(page);
  const requests: unknown[] = [];
  page.on('request', r => { if (r.url().includes('/api/create-payment-intent') && r.method() === 'POST' && !r.postDataJSON().expireOnly) requests.push(r.postDataJSON()); });
  await page.goto(`/en/checkout/${products[0].slug}`); remember(await (await startNativeCheckout(page)).json());
  await expect(page.frameLocator('iframe[src*="elements-inner-payment"]').locator('input[name=number]')).toBeVisible({ timeout: 60000 });
  expect(requests).toHaveLength(1);
  const bank = products.find(p => p.template === 'bank')!;
  await page.goto(`/en/checkout/${bank.slug}?email=prefilled@example.com`);
  await expect(page.locator('input[name=payment-method][value=transfer]')).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.locator('input[name=payment-method][value=transfer]').check();
  await page.locator('input[name=payment-method][value=online]').check();
  expect(requests).toHaveLength(1);
  await fillBuyer(page); remember(await (await startNativeCheckout(page)).json());
  expect(requests).toHaveLength(2);
});

for (const signedIn of [false, true]) test(`consent follows the same session rule for both methods (signedIn=${signedIn})`, async ({ page }) => {
  test.setTimeout(120000); await acceptAllCookies(page);
  await setTerms(page, true);
  try {
  if (signedIn) await setAuthSession(page, buyer.email, buyer.password);
  const email = signedIn ? buyer.email : `cart-guest-${run}@example.com`;
  const legal = page.getByRole('checkbox', { name: /I agree|Zgadzam/ });
  await page.goto(`/en/checkout/${products[0].slug}?email=${encodeURIComponent(email)}`);
  const body = await (await startNativeCheckout(page)).json(); remember(body);
  if (signedIn) await expect(legal).toHaveCount(0); else await expect(legal).toBeVisible();
  const update = (termsAccepted?: boolean) => page.request.post('/api/update-payment-metadata', { headers: { Origin: sellfOrigin }, data: {
    productId: products[0].id, clientSecret: body.clientSecret, bindingToken: body.bindingToken, email, fullName: 'Test Buyer', termsAccepted,
  } });
  const noAcceptance = await update(); expect(noAcceptance.status()).toBe(signedIn ? 200 : 400);
  if (!signedIn) expect((await update(true)).status()).toBe(200);
  const bank = products.find(p => p.template === 'bank')!;
  await page.goto(`/en/checkout/${bank.slug}?email=${encodeURIComponent(email)}`);
  await page.locator('input[name=payment-method][value=transfer]').check(); await fillBuyer(page);
  if (signedIn) await expect(legal).toHaveCount(0); else { await expect(legal).toBeVisible(); await legal.check(); }
  const place = page.getByRole('button', { name: /Place order|Order with|Zamawiam/ }); await expect(place).toBeEnabled();
  const responsePromise = page.waitForResponse('**/api/orders/bank-transfer'); await place.click();
  const response = await responsePromise; const order = await response.json(); expect(response.status(), JSON.stringify(order)).toBe(200);
  const row = await db.from('payment_transactions').select('order_details').eq('id', order.orderId).single();
  expect(row.data!.order_details.buyer.terms_accepted).toBe(!signedIn);
  } finally { await setTerms(page, false); }
});

test('panel has a visible persistent expansion control on wide screens', async ({ page }) => {
  await setAuthSession(page, admin.email, admin.password); await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/dashboard'); await page.evaluate(() => localStorage.removeItem('sf_sidebar_pinned')); await page.reload();
  const side = page.locator('#dashboard-sidebar'); const collapse = page.getByRole('button', { name: 'Collapse navigation', exact: true });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true'); await expect(collapse).toBeVisible(); await collapse.click();
  const expand = page.getByRole('button', { name: 'Expand navigation', exact: true });
  await expect(expand).toBeVisible(); await expect(expand).toHaveCSS('opacity', '1');
  await page.reload(); await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.focus(); await page.keyboard.press('Space'); await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await page.mouse.move(1400, 850); await page.reload(); await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await side.boundingBox())?.width ?? 0).toBeGreaterThan(180);
  await expect.poll(async () => {
    const [navigation, content] = await Promise.all([side.boundingBox(), page.locator('.sf-main-content').boundingBox()]);
    return content!.x - navigation!.x - navigation!.width;
  }).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('sidebar-expanded.png'), fullPage: true, animations: 'disabled' });
  await page.goto('/pl/dashboard'); await expect(page.getByRole('button', { name: 'Zwiń menu', exact: true })).toBeVisible();
});
