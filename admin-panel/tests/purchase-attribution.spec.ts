/**
 * Purchase attribution end to end on Stripe test mode: a buyer lands from an e-mail campaign,
 * pays by card, and the seller's integrator / agent reads the source from the API.
 * @see src/lib/attribution/
 */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { insertTestApiKey } from './helpers/api-key';
import { setConsentPreferences } from './helpers/consent';
import { test, startNativeCheckout } from './helpers/checkout-intent';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const run = randomUUID().slice(0, 8);

test('buyer from an e-mail campaign pays by card; the API reports email / listmonk / mail-05 @J171', async ({ page }) => {
  test.setTimeout(240000);
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  const product = await db.from('products').insert({ name: `Attribution ${run}`, slug: `attr-e2e-${run}`, price: 29, currency: 'PLN',
    is_active: true, vat_exempt: true }).select('id,slug').single();
  expect(product.error).toBeNull();
  const couponCode = `ATTR-${run.toUpperCase()}`;
  const coupon = await db.from('coupons').insert({ code: couponCode, name: `Attribution ${run}`, discount_type: 'percentage', discount_value: 10, is_active: true, allowed_product_ids: [product.data!.id] }).select('id').single();
  expect(coupon.error).toBeNull();
  const plaintext = `sf_test_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
  const { data: admin } = await db.from('admin_users').select('id').limit(1).single();
  const key = await insertTestApiKey(db, plaintext, { name: `attr-e2e-${run}`, admin_user_id: admin!.id, scopes: ['analytics:read', 'payments:read'], is_active: true });
  let sessionId: string | undefined;
  try {
    // Visitor declined optional cookies: attribution must still come from the checkout link (url mode).
    await setConsentPreferences(page, { gtm: false, pixel: false });
    await page.goto(`/en/p/${product.data!.slug}?coupon=${couponCode}&email=attr-${run}@example.com&utm_source=listmonk&utm_medium=email&utm_campaign=mail-05&utm_content=cta-1`);
    await expect(page).toHaveURL(/\/(?:en\/)?checkout\/.*utm_source=listmonk/);
    const body = await (await startNativeCheckout(page)).json();
    sessionId = body.checkoutSessionId;
    const fullName = page.getByRole('textbox', { name: 'Full Name' });
    if (await fullName.count()) await fullName.fill('Attribution Buyer');
    const frame = page.frameLocator('iframe[src*="elements-inner-payment"]');
    await frame.locator('input[name=number]').fill('4242424242424242');
    await frame.locator('input[name=expiry]').fill('12 / 34');
    await frame.locator('input[name=cvc]').fill('123');
    const country = frame.locator('select[name=country]');
    if (await country.count()) await country.selectOption('PL');
    const terms = page.getByRole('checkbox', { name: /I agree/ });
    if (await terms.count()) await terms.check();
    const pay = page.getByRole('button', { name: /^Pay / });
    await expect(pay).toBeEnabled({ timeout: 30000 });
    await pay.click({ timeout: 30000 });
    await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('session_id', sessionId!).maybeSingle()).data?.status,
      { timeout: 120000 }).toBe('completed');

    const report = await page.request.get(`/api/v1/analytics/attribution?days=1&product_id=${product.data!.id}`, { headers: { 'X-API-Key': plaintext } });
    expect(report.status()).toBe(200);
    expect((await report.json()).data.rows).toEqual([expect.objectContaining({
      channel: 'email', source: 'listmonk', medium: 'email', campaign: 'mail-05', content: 'cta-1', currency: 'PLN', orders: 1, net: 26.1,
    })]);
    const payments = await page.request.get(`/api/v1/payments?product_id=${product.data!.id}&embed=attribution`, { headers: { 'X-API-Key': plaintext } });
    expect((await payments.json()).data[0].attribution).toMatchObject({ channel: 'email', mode: 'url', consent: 'none',
      last: { source: 'listmonk', campaign: 'mail-05', landing_path: `/checkout/${product.data!.slug}` } });
  } finally {
    if (sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId).catch(() => undefined);
    }
    await db.from('coupons').delete().eq('id', coupon.data!.id);
    await db.from('api_keys').delete().eq('id', key.data.id);
    await db.from('payment_transactions').delete().eq('product_id', product.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
  }
});
