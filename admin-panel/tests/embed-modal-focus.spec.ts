/**
 * Embedded checkout keyboard navigation and readable coupon errors.
 * @see src/app/embed/v1/checkout.js/route.ts
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const slug = `modal-${randomUUID()}`;
let sellerId: string;
let productId: string;
let seller: http.Server;
let sellerOrigin: string;
let appOrigin: string;
let language = 'pl';

test.describe.configure({ mode: 'default' });
test.beforeAll(async ({ baseURL }) => {
  appOrigin = baseURL!;
  seller = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="${language}"><body>
      <button>Before</button><div data-sellf-embed data-product-slug="${slug}" data-modal="true" data-button-label="Kup teraz"></div>
      <button>After</button><script src="${appOrigin}/embed/v1/checkout.js"></script></body></html>`);
  });
  await new Promise<void>(resolve => seller.listen(0, '127.0.0.1', resolve));
  sellerOrigin = `http://127.0.0.1:${(seller.address() as AddressInfo).port}`;
  const { data, error } = await admin.auth.admin.createUser({ email: `${slug}@example.com`, email_confirm: true });
  expect(error).toBeNull();
  sellerId = data.user!.id;
  const settings = await admin.from('seller_embed_settings').upsert({ seller_id: sellerId, allowed_embed_origins: [sellerOrigin] });
  expect(settings.error).toBeNull();
  const product = await admin.from('products').insert({ slug, name: 'Modal checkout', price: 20, currency: 'PLN', seller_id: sellerId, is_active: true, embed_enabled: true, product_type: 'one_time' }).select('id').single();
  expect(product.error).toBeNull();
  productId = product.data!.id;
});

test.afterAll(async () => {
  if (productId) await admin.from('products').delete().eq('id', productId);
  if (sellerId) {
    await admin.from('seller_embed_settings').delete().eq('seller_id', sellerId);
    await admin.auth.admin.deleteUser(sellerId);
  }
  if (seller) await new Promise<void>((resolve, reject) => seller.close(err => err ? reject(err) : resolve()));
});

test.beforeEach(async ({ page }) => {
  await page.route('https://payment.example.test/frame', route => route.fulfill({ contentType: 'text/html', body: '<button>Pay</button><button>Payment help</button>' }));
  await page.route('https://js.stripe.com/v3/', route => route.fulfill({ contentType: 'text/javascript', body: `window.Stripe = function () { return { initEmbeddedCheckout: async function () { return { mount: function (slot) { var frame = document.createElement('iframe'); frame.title = 'Stripe payment'; frame.src = 'https://payment.example.test/frame'; slot.appendChild(frame); }, destroy: function () {} }; } }; };` }));
  // Initial paid session uses a local payment fixture; coupon requests reach the real route.
  await page.route('**/api/embed/checkout-session?*', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    expect(route.request().postDataJSON().locale).toBe(language);
    if (route.request().postDataJSON().couponCode) return route.continue();
    await route.fulfill({ json: { kind: 'paid', clientSecret: 'local-payment-fixture', product: { slug, name: 'Modal checkout', price: 20, currency: 'PLN' } }, headers: { 'Access-Control-Allow-Origin': sellerOrigin } });
  });
});

for (const locale of ['pl', 'en']) {
  test(`coupon with spaces has a readable ${locale} error`, async ({ page }) => {
    language = locale;
    await page.goto(sellerOrigin);
    await page.getByRole('button', { name: 'Kup teraz' }).click();
    await expect(page.locator('iframe[title="Stripe payment"]')).toBeVisible();
    for (const code of ['W82 CODE', 'W82<script>🧪']) {
      await page.locator('input[name="coupon"]').fill(code);
      await page.locator('.sellf-coupon button').click();
      await expect(page.locator('[data-sellf-coupon-error]')).toHaveText(locale === 'pl' ? 'Nieprawidłowy kod kuponu' : 'Invalid coupon code');
      await expect(page.locator('iframe[title="Stripe payment"]')).toBeVisible();
    }
  });
}

test('modal contains keyboard focus through the payment frame and restores it on Escape', async ({ page }) => {
  language = 'pl';
  await page.goto(sellerOrigin);
  const trigger = page.getByRole('button', { name: 'Kup teraz' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleName('Koszyk');
  const close = dialog.getByRole('button', { name: 'Zamknij' });
  await expect(close).toBeFocused();
  const frame = page.frameLocator('iframe[title="Stripe payment"]');
  await expect(frame.getByRole('button', { name: 'Payment help' })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('iframe[title="Stripe payment"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(frame.getByRole('button', { name: 'Pay', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(frame.getByRole('button', { name: 'Payment help' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('input[name="coupon"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('button[type="submit"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(frame.getByRole('button', { name: 'Pay', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator('button[type="submit"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(close).toBeFocused();
  await close.click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
