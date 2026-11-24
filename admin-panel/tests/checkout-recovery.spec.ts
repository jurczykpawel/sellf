import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { test, startNativeCheckout, waitForNativeCheckoutReady } from './helpers/checkout-intent';
import Stripe from 'stripe';
import { supabaseAdmin as db, setAuthSession } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { signTransferToken } from '@/lib/orders/transfer-token';
import { verifyGateToken } from '@/lib/loginwall/token';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const check = (error: unknown) => expect(error).toBeNull();
for (const locale of ['en', 'pl'] as const) for (const width of [390, 1280]) {
  test(`mixed gate and refund dialog in ${locale} at ${width}px @J62 @J63 @J56`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const password = 'Checkout-test-123!', email = `recovery-${randomUUID()}@example.com`;
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true }); check(error);
    const user = data.user!, id = randomUUID(), hidden = randomUUID(), slug = `gate-${id}`, origin = 'https://merchant.example';
    try {
      check((await db.from('seller_embed_settings').upsert({ seller_id: user.id, allowed_embed_origins: [origin] })).error);
      check((await db.from('products').insert([{ id, slug, name: 'Recovery course', price: 10, seller_id: user.id, is_active: true, is_refundable: true, refund_period_days: 14 }, { id: hidden, slug: `hidden-${hidden}`, name: 'Archived course', price: 10, seller_id: user.id, is_refundable: false, refund_period_days: null, is_active: false, archived_at: new Date().toISOString() }])).error);
      check((await db.from('user_product_access').insert({ user_id: user.id, product_id: id })).error);
      check((await db.from('payment_transactions').insert({ user_id: user.id, customer_email: email, product_id: id, amount: 1000, currency: 'PLN', status: 'completed', session_id: `cs_${randomUUID().replaceAll('-', '')}` })).error);
      for (const signedIn of [false, true]) {
        if (signedIn) await setAuthSession(page, email, password);
        const response = await page.request.get(`/loginwall/gate?products=${slug},hidden-${hidden}&redirect=${encodeURIComponent(origin)}`, { maxRedirects: 0 });
        expect(response.status()).toBe(307);
        const token = new URL(response.headers().location).hash.slice('#_sf_token='.length);
        expect(verifyGateToken(token, { secret: process.env.LOGINWALL_SECRET! })).toMatchObject({ valid: true, auth: signedIn, owned: signedIn ? [slug] : [] });
        expect((await page.request.get(`/loginwall/gate?products=${slug},hidden-${hidden}&redirect=https://other.example`, { maxRedirects: 0 })).status()).toBe(400);
      }
      check((await db.from('user_product_access').insert({ user_id: user.id, product_id: hidden })).error);
      const ownedResponse = await page.request.get(`/loginwall/gate?products=${slug},hidden-${hidden}&redirect=${encodeURIComponent(origin)}`, { maxRedirects: 0 });
      expect(verifyGateToken(new URL(ownedResponse.headers().location).hash.slice('#_sf_token='.length), { secret: process.env.LOGINWALL_SECRET! })).toMatchObject({ valid: true, owned: expect.arrayContaining([slug, `hidden-${hidden}`]) });
      await acceptAllCookies(page); await page.goto(`/${locale}/my-purchases`);
      const t = (locale === 'pl' ? pl : en).myPurchases;
      const opener = page.getByRole('button', { name: t.requestRefund, exact: true }); await opener.click();
      const dialog = page.getByRole('dialog', { name: t.refundRequestTitle }); await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('textbox')).toBeFocused();
      await dialog.getByRole('button', { name: t.submitRequest }).focus(); await page.keyboard.press('Tab');
      await expect(dialog.getByRole('textbox')).toBeFocused();
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    } finally {
      await db.from('payment_transactions').delete().eq('product_id', id); await db.from('user_product_access').delete().in('product_id', [id, hidden]);
      await db.from('products').delete().in('id', [id, hidden]); await db.auth.admin.deleteUser(user.id);
    }
  });
  test(`transfer declaration refreshes all receipt deadlines in ${locale} at ${width}px @J181`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const id = randomUUID(), orderId = randomUUID(), lateId = randomUUID(), releaseAt = new Date(Date.now() + 3600000).toISOString();
    check((await db.from('products').insert({ id, slug: `receipt-${id}`, name: 'Receipt', price: 10, is_active: true })).error);
    try {
      check((await db.from('payment_transactions').insert({ id: orderId, product_id: id, session_id: null, pricing_snapshot_version: 1, customer_email: 'receipt@example.com', amount: 1000, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', release_at: releaseAt, transfer_details: { account: 'PL61109010140000071219812874' } })).error);
      await acceptAllCookies(page); await page.goto(`/${locale}/order/${orderId}/transfer?token=${signTransferToken(orderId)}`);
      const declarations: string[] = [];
      page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/orders/bank-transfer/declare')) declarations.push(request.url()); });
      await page.getByRole('button', { name: (locale === 'pl' ? pl : en).bankTransfer.declareButton }).dblclick();
      await expect.poll(async () => (await db.from('payment_transactions').select('transfer_declared_at').eq('id', orderId).single()).data?.transfer_declared_at).toBeTruthy();
      expect(declarations).toHaveLength(1);
      const { data: current } = await db.from('payment_transactions').select('release_at').eq('id', orderId).single();
      expect(Date.parse(current!.release_at!)).toBeGreaterThan(Date.parse(releaseAt));
      const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(current!.release_at!));
      await expect(page.getByRole('main')).toContainText(date);
      await expect(page.locator('main > p.font-semibold')).toContainText(date);
      await expect(page.locator('main dd').last()).toHaveText(date);
      await page.emulateMedia({ media: 'print' }); await expect(page.locator('main dd').last()).toBeVisible();
      await expect(page.locator('main dd').last()).toHaveText(date);
      await page.emulateMedia({ media: 'screen' });
      const past = new Date(Date.now() - 3600000).toISOString();
      check((await db.from('payment_transactions').insert({ id: lateId, product_id: id, session_id: null, pricing_snapshot_version: 1, customer_email: 'receipt@example.com', amount: 1000, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', release_at: past })).error);
      await page.goto(`/${locale}/order/${lateId}/transfer?token=${signTransferToken(lateId)}`);
      await page.getByRole('button', { name: (locale === 'pl' ? pl : en).bankTransfer.declareButton }).click();
      await expect(page.getByRole('status')).toContainText((locale === 'pl' ? pl : en).bankTransfer.declaredLate);
      expect(Date.parse((await db.from('payment_transactions').select('release_at').eq('id', lateId).single()).data!.release_at!)).toBe(Date.parse(past));

    } finally { await db.from('payment_transactions').delete().in('id', [orderId, lateId]); await db.from('products').delete().eq('id', id); }
  });
}
test('a consumed provider link explains the error returned in its fragment @J87', async ({ page, baseURL }) => {
  const email = `used-link-${randomUUID()}@example.com`, target = '/auth/product-access?product=course';
  const { data, error } = await db.auth.admin.generateLink({ type: 'signup', email, password: 'Checkout-test-123!', options: { redirectTo: `${baseURL}/auth/callback?redirect_to=${encodeURIComponent(target)}` } }); check(error);
  const actionLink = new URL(data.properties!.action_link);
  const api = new URL(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!);
  actionLink.host = api.host; actionLink.protocol = api.protocol;
  // The provider may advertise its default site URL instead of the test callback.
  actionLink.searchParams.set('redirect_to', `${baseURL}/auth/callback?redirect_to=${encodeURIComponent(target)}`);
  try {
    expect((await page.request.get(actionLink.href, { maxRedirects: 0 })).status()).toBe(303);
    await acceptAllCookies(page); await page.goto(actionLink.href);
    await expect(page.getByText(en.auth.magicLinkExpired, { exact: true })).toBeVisible();
    const login = page.locator('a[href*="error=magic_link_expired"]');
    await expect(login).toBeVisible();
    expect(new URL((await login.getAttribute('href'))!, baseURL).searchParams.get('redirect_to')).toBe(target);
  } finally { await db.auth.admin.deleteUser(data.user!.id); }
});

for (const locale of ['en', 'pl'] as const) test(`checkout imports clear errors and legacy names stay whole in ${locale} @J201`, async ({ page }) => {
  await page.setViewportSize({ width: locale === 'pl' ? 390 : 1280, height: 844 });
  const id = randomUUID(), slug = `fields-${id}`, sessions: string[] = [];
  const profile = { v: 1, modules: [{ id: 'quantity', min: 2, max: 2, mode: 'checkout' }, { id: 'participants', required: true, prefill_from_buyer: false }] };
  check((await db.from('products').insert({ id, slug, name: 'Checkout fields', price: 10, currency: 'PLN', is_active: true, checkout_profile: profile })).error);
  try {
    await acceptAllCookies(page); await page.goto(`/${locale}/checkout/${slug}`);
    sessions.push((await (await startNativeCheckout(page)).json()).checkoutSessionId);
    await page.locator('#checkoutEmail').fill('fields@example.com');
    await waitForNativeCheckoutReady(page);
    for (const checkbox of await page.locator('[data-checkout-session-id] input[type=checkbox][required]').all()) await checkbox.check();
    const pay = page.locator('[data-checkout-session-id] button[type="submit"]'); await expect(pay).toBeEnabled(); await pay.click();
    await expect(page.locator('[id="participants.0.first_name"]')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('details').filter({ has: page.getByLabel((locale === 'pl' ? pl : en).checkout.profile.pasteLabel) }).locator('summary').click();
    await page.getByLabel((locale === 'pl' ? pl : en).checkout.profile.pasteLabel).fill('Jan;Nowak;jan@example.com\nAnna;Kowalska;anna@example.com');
    await page.getByRole('button', { name: (locale === 'pl' ? pl : en).checkout.profile.pasteApply }).click();
    await expect(page.locator('input[id^="participants."][aria-invalid="true"]')).toHaveCount(0);
    check((await db.from('products').update({ checkout_profile: null }).eq('id', id)).error);
    await page.reload(); sessions.push((await (await startNativeCheckout(page)).json()).checkoutSessionId);
    await page.locator('#checkoutEmail').fill('fields@example.com'); await page.locator('#fullName').fill('R'.repeat(200) + 'Ż');
    await expect(page.locator('#fullName')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#fullName-error')).toContainText('200');
    await page.locator('#fullName').fill('R'.repeat(199) + 'Ż');
    await expect(page.locator('#fullName')).toHaveAttribute('aria-invalid', 'false');
    await waitForNativeCheckoutReady(page);
    for (const checkbox of await page.locator('[data-checkout-session-id] input[type=checkbox][required]').all()) await checkbox.check();
    await page.route('https://api.stripe.com/**/confirm', route => route.abort());
    const saved = page.waitForResponse(response => response.url().endsWith('/api/update-payment-metadata') && response.request().method() === 'POST');
    await page.locator('[data-checkout-session-id] button[type="submit"]').click();
    expect((await saved).status()).toBe(200);
    const activeSession = (await page.locator('[data-checkout-session-id]').getAttribute('data-checkout-session-id'))!;
    sessions.push(activeSession);
    expect((await new Stripe(process.env.STRIPE_SECRET_KEY!).checkout.sessions.retrieve(activeSession)).metadata?.full_name).toBe('R'.repeat(199) + 'Ż');
    const { data: order, error } = await db.from('payment_transactions').select('order_details').eq('session_id', activeSession).single(); check(error);
    expect((order!.order_details as { buyer: { full_name: string } }).buyer.full_name).toBe('R'.repeat(199) + 'Ż');

  } finally {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    for (const id of new Set(sessions)) if ((await stripe.checkout.sessions.retrieve(id)).status === 'open') await stripe.checkout.sessions.expire(id);
    await db.from('payment_transactions').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
});
