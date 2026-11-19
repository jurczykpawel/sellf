/** Real local checkout recovery and localized email feedback. */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { test, startNativeCheckout } from './helpers/checkout-intent';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { clearPaidCheckout, testStripe } from './helpers/stripe-test-events';

let product: { id: string; slug: string };
const sessions = new Set<string>();
test.beforeEach(async () => {
  const slug = `checkout-recovery-${randomUUID()}`;
  const { data, error } = await supabaseAdmin.from('products').insert({ slug, name: 'Checkout recovery', price: 19, currency: 'PLN', is_active: true, vat_exempt: true }).select('id,slug').single();
  if (error) throw error;
  product = data;
});
test.afterEach(async () => {
  const stripe = testStripe();
  for (const id of sessions) {
    const session = await stripe.checkout.sessions.retrieve(id);
    if (session.status === 'open') await stripe.checkout.sessions.expire(id);
    await clearPaidCheckout(id);
  }
  sessions.clear();
  if (product) {
    await supabaseAdmin.from('guest_purchases').delete().eq('product_id', product.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', product.id);
    await supabaseAdmin.from('products').delete().eq('id', product.id);
  }
});
for (const locale of ['en', 'pl']) {
  test(`expired checkout offers a fresh session in ${locale} @J710`, async ({ page }) => {
    test.setTimeout(180000);
    const { data: event, error } = await supabaseAdmin.from('product_sessions').insert({ product_id: product.id, starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', capacity: 1 }).select('id').single();
    expect(error).toBeNull();
    expect((await supabaseAdmin.from('product_price_tiers').insert({ session_id: event!.id, price: 19, sort: 0 })).error).toBeNull();
    expect((await supabaseAdmin.from('products').update({ event_mode: true }).eq('id', product.id)).error).toBeNull();
    await acceptAllCookies(page);
    await page.goto(`/${locale}/checkout/${product.slug}?email=expiry-${randomUUID()}@example.com`);
    const opened = await (await startNativeCheckout(page)).json(); sessions.add(opened.checkoutSessionId);
    await page.locator('#fullName').fill('Recovery Buyer');
    for (const checkbox of await page.locator('input[type=checkbox][required]').all()) if (await checkbox.isVisible() && !await checkbox.isChecked()) await checkbox.check();
    const stripe = testStripe();
    await stripe.checkout.sessions.expire(opened.checkoutSessionId);
    const numberLabel = locale === 'pl' ? 'Numer karty' : 'Card number';
    let card: ReturnType<typeof page.frames>[number] | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.getByRole('textbox', { name: numberLabel, exact: true }).isVisible().catch(() => false)) { card = frame; return true; }
      }
      return false;
    }, { timeout: 60000 }).toBe(true);
    await card!.getByRole('textbox', { name: numberLabel, exact: true }).fill('4242424242424242');
    await card!.getByRole('textbox', { name: locale === 'pl' ? 'Data ważności' : 'Expiration date', exact: true }).fill('1234');
    await card!.getByRole('textbox', { name: locale === 'pl' ? 'Kod bezpieczeństwa' : 'Security code', exact: true }).fill('123');
    await expect(page.locator('button[type=submit]')).toBeEnabled();
    await page.locator('button[type=submit]').click();
    await expect(page.getByText(locale === 'pl' ? 'Sesja płatności wygasła.' : 'Your payment session has expired.')).toBeVisible();
    await expect(page.locator('button[type=submit]')).toHaveCount(0);
    const fresh = page.waitForResponse(response => response.url().endsWith('/api/create-payment-intent') && !response.request().postDataJSON().expireOnly);
    await page.getByRole('button', { name: locale === 'pl' ? 'Rozpocznij nowy koszyk' : 'Start a new checkout' }).click();
    const response = await fresh;
    expect(response.status()).toBe(200);
    const replacement = await response.json(); sessions.add(replacement.checkoutSessionId);
    expect(replacement.checkoutSessionId).not.toBe(opened.checkoutSessionId);
    await expect(page.locator('#fullName')).toHaveValue('Recovery Buyer');
    expect((await stripe.checkout.sessions.retrieve(opened.checkoutSessionId)).payment_status).toBe('unpaid');
    const { data: tx } = await supabaseAdmin.from('payment_transactions').select('id').eq('session_id', replacement.checkoutSessionId).single();
    const { data: reservation } = await supabaseAdmin.from('seat_reservations').select('status').eq('transaction_id', tx!.id).single();
    expect(reservation?.status).toBe('held');
  });

  test(`overlong email is explained beside the field in ${locale} @J711`, async ({ page }) => {
    test.setTimeout(180000);
    await acceptAllCookies(page);
    await page.goto(`/${locale}/checkout/${product.slug}`);
    const opened = await (await startNativeCheckout(page)).json(); sessions.add(opened.checkoutSessionId);
    await page.locator('#checkoutEmail').fill('r'.repeat(255) + '@example.com');
    await page.locator('#fullName').fill('Email Buyer');
    for (const checkbox of await page.locator('input[type=checkbox][required]').all()) if (await checkbox.isVisible() && !await checkbox.isChecked()) await checkbox.check();
    await expect(page.locator('button[type=submit]')).toBeEnabled();
    await page.locator('button[type=submit]').click();
    const error = page.locator('#checkout-email-error');
    await expect(error).toHaveText(locale === 'pl' ? 'Adres e-mail może mieć maksymalnie 254 znaki.' : 'Email addresses can have at most 254 characters.');
    await expect(page.locator('#checkoutEmail')).toHaveAttribute('aria-describedby', 'checkout-email-error');
    await page.locator('#checkoutEmail').fill('corrected@example.com');
    await expect(error).toHaveCount(0);
    expect((await testStripe().checkout.sessions.retrieve(opened.checkoutSessionId)).payment_status).toBe('unpaid');
  });
}
