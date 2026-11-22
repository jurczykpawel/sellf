import { useSupabaseBuyerEmails } from './helpers/buyer-email-setting-playwright';
useSupabaseBuyerEmails();
/** Buyer-facing first-mail content and one consent control on each public route. */
import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { extractMagicLink, waitForEmail, searchMessages } from './helpers/mailpit';
import recordedPurchase from './fixtures/stripe/initial-subscription-purchase.json';
import recordedSubscription from './fixtures/stripe/subscription-first-mail.json';

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

for (const locale of ['pl', 'en']) test(`first queued subscription email confirms access in ${locale} @J32`, async ({ page }) => {
  const db = supabaseAdmin, email = `queued-sub-${crypto.randomUUID()}@example.com`;
  const user = await db.auth.admin.createUser({ email, email_confirm: false }); expect(user.error).toBeNull(); const uid = user.data.user!.id;
  const product = await db.from('products').insert({ name: 'Queued subscription', slug: `queued-${crypto.randomUUID()}`, price: 17, currency: 'PLN', product_type: 'subscription', recurring_price: 17, billing_interval: 'month', billing_interval_count: 1, is_active: true }).select('id,slug').single();
  expect(product.error).toBeNull(); const pid = product.data!.id;
  try {
    const sub = await db.from('subscriptions').insert({ ...recordedSubscription.subscription, user_id: uid, product_id: pid, stripe_subscription_id: `sub_${crypto.randomUUID()}` }).select('id').single(); expect(sub.error).toBeNull();
    const invoice = `in_${crypto.randomUUID().replaceAll('-', '')}`;
    const tx = await db.from('payment_transactions').insert({ ...recordedSubscription.payment, amount: Number(recordedSubscription.payment.amount), session_id: invoice, stripe_invoice_id: invoice, stripe_payment_intent_id: null, user_id: uid, customer_email: email, product_id: pid, subscription_id: sub.data!.id, fulfillment_pending: true }).select('id').single(); expect(tx.error).toBeNull();
    expect(await searchMessages(email)).toHaveLength(0);
    const requested = await page.request.post('/api/auth/magic-link', { data: { flow: 'post_checkout', email, productSlug: product.data!.slug, locale, captchaToken: 'test' } });
    expect(requested.status(), await requested.text()).toBe(200);
    expect(await searchMessages(email)).toHaveLength(0);
    expect((await db.from('auth_mail_retries').select('id').eq('email', email)).data).toHaveLength(1);
    expect((await db.from('user_product_access').select('id').eq('user_id', uid).eq('product_id', pid)).data).toHaveLength(0);
    expect((await db.from('payment_transactions').update({ fulfillment_pending: false }).eq('id', tx.data!.id)).error).toBeNull();
    expect((await db.from('auth_mail_retries').update({ next_attempt_at: new Date(0).toISOString() }).eq('email', email)).error).toBeNull();
    expect(process.env.CRON_SECRET).toBeTruthy();
    const retried = await page.request.get('/api/cron?job=auth-mail-retry', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }); expect(retried.status(), await retried.text()).toBe(200);
    const mail = await waitForEmail(email);
    expect(mail.Subject).toBe((locale === 'pl' ? 'Potwierdź swój email' : 'Confirm your email') + ': Queued subscription');
    expect(mail.HTML).toContain(locale === 'pl' ? 'Produkt: Queued subscription' : 'Product: Queued subscription');
    expect(mail.HTML).toContain(locale === 'pl' ? '17,00\u00a0zł' : 'PLN\u00a017.00');
    expect(await searchMessages(email)).toHaveLength(1);
    await acceptAllCookies(page); await page.goto(extractMagicLink(mail.HTML!)!);
    await expect(page).toHaveURL(new RegExp(`/p/${product.data!.slug}(?:[/?]|$)`));
    await expect(page.getByRole('heading', { level: 1, name: 'Queued subscription', exact: true })).toBeVisible();
    expect((await db.auth.admin.getUserById(uid)).data.user!.email_confirmed_at).toBeTruthy();
    expect((await db.from('user_product_access').select('subscription_id').eq('user_id', uid).eq('product_id', pid)).data).toEqual([{ subscription_id: sub.data!.id }]);
    expect((await db.from('auth_mail_retries').select('id').eq('email', email)).data).toHaveLength(0);
  } finally {
    await db.from('auth_mail_retries').delete().eq('email', email); await db.from('user_product_access').delete().eq('product_id', pid);
    await db.from('payment_transactions').delete().eq('product_id', pid); await db.from('subscriptions').delete().eq('product_id', pid);
    await db.from('products').delete().eq('id', pid); await db.auth.admin.deleteUser(uid);
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
