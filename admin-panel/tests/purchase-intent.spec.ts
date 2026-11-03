/** Public product views and recorded checkout attempts. @see lib/actions/checkout-funnel.ts */
import Stripe from 'stripe';
import { test, startNativeCheckout } from './helpers/checkout-intent';
import { acceptAllCookies } from './helpers/consent';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { restoreBaselineTaxMode } from './helpers/tax-mode';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
test.beforeAll(() => { expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/); });
// These tests need the local tax mode: stripe_tax answers 503 on an account without a Tax address.
test.beforeEach(async () => { await restoreBaselineTaxMode(db); });
test('automatically records an online-only checkout attempt', async ({ page }) => {
  const row = await db.from('products').insert({ name: 'Automatic checkout', slug: `intent-${randomUUID()}`, price: 49, currency: 'PLN', is_active: true, is_listed: true, vat_rate: 23 }).select('id,slug').single();
  expect(row.error).toBeNull();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!); let sessionId: string | undefined;
  try {
    await page.goto(`/pl/p/${row.data!.slug}`);
    const body = await (await startNativeCheckout(page)).json(); sessionId = body.checkoutSessionId;
    await expect(page.getByRole('button', { name: 'Przejdź do płatności', exact: true })).toHaveCount(0);
    const funnel = await db.rpc('get_checkout_funnel', { p_days: 30, p_product_id: row.data!.id });
    expect(funnel.error).toBeNull();
    expect(funnel.data.totals).toEqual({ started: 1, paid: 0, pending: 1, abandoned: 0, other: 0 });
  } finally {
    await page.goto('about:blank');
    if (sessionId) { const session = await stripe.checkout.sessions.retrieve(sessionId); if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId).catch(async error => { if ((await stripe.checkout.sessions.retrieve(sessionId!)).status !== 'expired') throw error; }); }
    await db.from('payment_transactions').delete().eq('product_id', row.data!.id); await db.from('products').delete().eq('id', row.data!.id);
  }
});

test('renders coupon entry and card-first payment at desktop and mobile sizes in both languages', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const product = await db.from('products').insert({ name: 'Reporting course', icon: '📘', slug: `purchase-ui-${randomUUID()}`, price: 49, currency: 'PLN', is_active: true, is_listed: true, vat_rate: 23, description: 'Build a clear monthly report.' }).select('id,slug').single();
  expect(product.error).toBeNull();
  const coupon = await db.from('coupons').insert({ code: `CORE${randomUUID().slice(0, 8).toUpperCase()}`, discount_type: 'percentage', discount_value: 10, is_active: true, allowed_product_ids: [product.data!.id] }).select('id,code').single();
  expect(coupon.error).toBeNull();
  const sessions = new Set<string>();
  page.on('response', async response => { if (response.url().includes('/api/create-payment-intent') && response.ok()) { const body = await response.json().catch(() => ({})); if (body.checkoutSessionId) sessions.add(body.checkoutSessionId); } });
  try {
    await acceptAllCookies(page);
    for (const locale of ['en', 'pl']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/p/${product.data!.slug}?coupon=${coupon.data!.code}`);
      const code = page.getByRole('textbox', { name: locale === 'pl' ? 'Kod rabatowy' : 'Discount code' });
      await expect(code).toBeDisabled();
      await startNativeCheckout(page);
      await page.screenshot({ path: testInfo.outputPath(`purchase-${locale}-${width}.png`), fullPage: true, animations: 'disabled' });
      await expect(page.locator('#checkoutEmail')).toBeVisible({ timeout: 90000 });
      const card = page.frameLocator('iframe[src*="elements-inner-payment"]').locator('input[name="number"]');
      await expect(card).toBeVisible({ timeout: 60000 });
      await card.fill('4242424242424242');
      await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeGreaterThan(120);
      await expect(page.locator('button[type="submit"]')).not.toHaveAttribute('data-checkout-pending', 'true');
      const branding = page.locator('a[href="https://demo.sellf.app?ref=checkout"]');
      if (await branding.count()) {
        const footer = await branding.boundingBox();
        const form = await page.locator('form').last().boundingBox();
        expect(footer!.y).toBeGreaterThanOrEqual(form!.y + form!.height);
      }
      await page.screenshot({ path: testInfo.outputPath(`payment-ready-${locale}-${width}.png`), animations: 'disabled' });
      await page.getByTestId('order-summary-total').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`payment-total-${locale}-${width}.png`), animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  } finally {
    await page.goto('about:blank');
    for (const id of sessions) { const session = await stripe.checkout.sessions.retrieve(id); if (session.status === 'open') await stripe.checkout.sessions.expire(id).catch(async error => { if ((await stripe.checkout.sessions.retrieve(id)).status !== 'expired') throw error; }); }
    await db.from('payment_transactions').delete().eq('product_id', product.data!.id);
    await db.from('coupons').delete().eq('id', coupon.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
  }
});

test('does not show a redundant start button before hydration', async ({ page }) => {
  // A click before hydration is a native GET form submit: it reloads the page and drops the query (coupon, email, oto).
  const slug = `intent-hydrate-${randomUUID()}`;
  const created = await db.from('products').insert({ name: 'Checkout hydration course', slug, price: 49, currency: 'PLN', is_active: true, is_listed: true, vat_rate: 23 }).select('id').single();
  expect(created.error).toBeNull();
  try {
    await page.route(/\/_next\/static\/.*\.js(\?|$)/, route => route.abort());
    await page.goto(`/pl/p/${slug}?coupon=KEEP`, { waitUntil: 'domcontentloaded' });
    const start = page.getByRole('button', { name: 'Przejdź do płatności', exact: true });
    await expect(start).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('coupon')).toBe('KEEP');
  } finally {
    await db.from('products').delete().eq('id', created.data!.id);
  }
});
