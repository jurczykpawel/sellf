/** Public product views and recorded checkout attempts. @see lib/actions/checkout-funnel.ts */
import { mkdirSync } from 'node:fs';
import Stripe from 'stripe';
import { acceptAllCookies } from './helpers/consent';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
test.beforeAll(() => { expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/); });
test('counts purchase intent while leaving product views out of the funnel', async ({ page }) => {
  const slug = `intent-${randomUUID()}`;
  const created = await db.from('products').insert({ name: 'Checkout intent course', slug, price: 49, currency: 'PLN', is_active: true, is_listed: true, vat_rate: 23 }).select('id').single();
  expect(created.error).toBeNull();
  const id = created.data!.id;
  const sessions: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/create-payment-intent')) sessions.push(request.url()); });
  try {
    for (const locale of ['en', 'pl']) {
      await page.goto(`/${locale}/p/${slug}`);
      await expect(page.getByRole('button', { name: /Continue to payment|Przejdź do płatności/ })).toBeVisible();
      expect(sessions).toHaveLength(0);
      const records = await db.from('payment_transactions').select('id').eq('product_id', id);
      expect(records.data).toEqual([]);
      const funnel = await db.rpc('get_checkout_funnel', { p_days: 30, p_product_id: id });
      expect(funnel.error).toBeNull();
      expect(funnel.data.totals).toEqual({ started: 0, paid: 0, pending: 0, abandoned: 0 });
    }
    const response = page.waitForResponse(r => r.url().includes('/api/create-payment-intent') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Przejdź do płatności', exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(page.locator('#checkoutEmail')).toBeVisible({ timeout: 90000 });
    expect(sessions).toHaveLength(1);
    const funnel = await db.rpc('get_checkout_funnel', { p_days: 30, p_product_id: id });
    expect(funnel.data.totals).toEqual({ started: 1, paid: 0, pending: 1, abandoned: 0 });
  } finally {
    await db.from('payment_transactions').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
});

test('renders coupon entry and card-first payment at desktop and mobile sizes in both languages', async ({ page }) => {
  test.setTimeout(180000);
  mkdirSync('/tmp/rcfix-core-shots', { recursive: true });
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
      await page.goto(`/${locale}/p/${product.data!.slug}`);
      await page.getByRole('button', { name: locale === 'pl' ? 'Masz kod rabatowy?' : 'Have a discount code?' }).click();
      const code = page.getByRole('textbox', { name: locale === 'pl' ? 'Kod rabatowy' : 'Discount code' });
      await code.fill(coupon.data!.code);
      await page.getByRole('button', { name: locale === 'pl' ? 'Zastosuj' : 'Apply' }).click();
      await expect(code).toBeDisabled();
      await page.screenshot({ path: `/tmp/rcfix-core-shots/purchase-${locale}-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: /Continue to payment|Przejdź do płatności/ }).click();
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
      await page.screenshot({ path: `/tmp/rcfix-core-shots/payment-ready-${locale}-${width}.png`, animations: 'disabled' });
      await page.getByTestId('order-summary-total').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/rcfix-core-shots/payment-total-${locale}-${width}.png`, animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  } finally {
    await page.goto('about:blank');
    for (const id of sessions) { const session = await stripe.checkout.sessions.retrieve(id); if (session.status === 'open') await stripe.checkout.sessions.expire(id); }
    await db.from('payment_transactions').delete().eq('product_id', product.data!.id);
    await db.from('coupons').delete().eq('id', coupon.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
  }
});
