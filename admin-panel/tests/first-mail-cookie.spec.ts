/** Buyer-facing first-mail content and one consent control on each public route. */
import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { waitForEmail, searchMessages } from './helpers/mailpit';
import recordedPurchase from './fixtures/stripe/initial-subscription-purchase.json';

test('offers one cookie preferences control on offer, store, product and login @J40', async ({ page }) => {
  test.setTimeout(120000);
  const { data: product, error } = await supabaseAdmin.from('products').insert({ name: 'Cookie workshop', slug: `cookie-${crypto.randomUUID()}`, price: 11, currency: 'PLN', is_active: true, is_listed: true }).select('id,slug').single();
  expect(error).toBeNull();
  const config = await supabaseAdmin.from('integrations_config').select('cookie_consent_enabled').eq('id', 1).single();
  try {
    expect((await supabaseAdmin.from('integrations_config').update({ cookie_consent_enabled: true }).eq('id', 1)).error).toBeNull();
    expect((await supabaseAdmin.from('product_offer_config').insert({ product_id: product!.id, published: { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null } })).error).toBeNull();
    await acceptAllCookies(page);
    for (const path of [`/pl/offer/${product!.slug}`, '/pl', `/pl/p/${product!.slug}`, '/pl/login']) {
      expect((await page.goto(path))?.status()).toBe(200);
      const preferences = page.getByRole('button', { name: 'Preferencje ciasteczek', exact: true });
      await expect(preferences).toHaveCount(1);
      await preferences.click();
      await expect(page.locator('#cc-main .pm')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#cc-main .pm')).toBeHidden();
    }
  } finally {
    await supabaseAdmin.from('products').delete().eq('id', product!.id);
    if (config.data) await supabaseAdmin.from('integrations_config').update(config.data).eq('id', 1);
  }
});

test('first new-buyer email from payment status contains the paid product and amount @J32', async ({ page }) => {
  const email = `first-mail-${crypto.randomUUID()}@example.com`;
  const session = `cs_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const invoice = recordedPurchase.invoice;
  const { data: product, error } = await supabaseAdmin.from('products').insert({ name: 'First email workshop', slug: `first-${crypto.randomUUID()}`, price: invoice.amount_paid / 100, currency: invoice.currency.toUpperCase(), is_active: true }).select('id,slug').single();
  expect(error).toBeNull();
  try {
    const tx = await supabaseAdmin.from('payment_transactions').insert({ product_id: product!.id, customer_email: email, session_id: session, status: 'completed', amount: invoice.amount_paid, currency: invoice.currency.toUpperCase() }).select('id').single();
    expect(tx.error).toBeNull();
    expect((await supabaseAdmin.from('guest_purchases').insert({ product_id: product!.id, customer_email: email, transaction_id: tx.data!.id, transaction_amount: invoice.amount_paid })).error).toBeNull();
    expect(await searchMessages(email)).toHaveLength(0);
    await acceptAllCookies(page);
    await page.goto(`/pl/p/${product!.slug}/payment-status?session_id=${session}`);
    await expect(page.getByRole('heading', { name: 'Magiczny link wysłany!' })).toBeVisible();
    const mail = await waitForEmail(email);
    expect(mail.Subject).toBe('Potwierdź swój email: First email workshop');
    expect(mail.HTML).toContain('First email workshop');
    expect(mail.HTML).toContain('11,00\u00a0zł');
    expect(mail.HTML).toContain('type=signup');
    expect(await searchMessages(email)).toHaveLength(1);
  } finally {
    const user = (await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await supabaseAdmin.auth.admin.deleteUser(user.id);
    await supabaseAdmin.from('guest_purchases').delete().eq('product_id', product!.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', product!.id);
    await supabaseAdmin.from('products').delete().eq('id', product!.id);
  }
});
