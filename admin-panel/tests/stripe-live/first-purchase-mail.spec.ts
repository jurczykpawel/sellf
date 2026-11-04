/** Buyer reads the first delivered message after a real checkout. @see tests/journeys.yaml */
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import Stripe from 'stripe';
import { solveChallenge } from 'altcha-lib/v1';
import { checkAccessibility } from '../helpers/axe';
import type { Page } from '@playwright/test';
import { test, startNativeCheckout } from '../helpers/checkout-intent';
import { supabaseAdmin as db, setAuthSession } from '../helpers/admin-auth';
import { acceptAllCookies } from '../helpers/consent';
import { extractMagicLink, searchMessages, waitForEmail } from '../helpers/mailpit';
import { deleteAuthUserByEmail } from '../helpers/db-cleanup';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
type Kind = 'guest' | 'signed-in' | 'trial' | 'coupon' | 'variant' | 'bundle' | 'event' | 'transfer';
async function captcha(page: Page): Promise<string> {
  const challenge = await (await page.request.get('/api/captcha/challenge')).json();
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
  expect(solution).toBeTruthy();
  return Buffer.from(JSON.stringify({ ...challenge, number: solution!.number, took: solution!.took })).toString('base64');
}
async function insert(table: string, value: object) {
  const result = await db.from(table).insert(value).select().single();
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data!;
}
async function rows(table: string, column: string, value: string) {
  const result = await db.from(table).select('*').eq(column, value);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return result.data!;
}
async function remove(table: string, column: string, values: string[]) {
  if (!values.length) return;
  const result = await db.from(table).delete().in(column, values);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
}
async function run(page: Page, kind: Kind, locale: 'pl' | 'en' = 'en', trialCoupon = false): Promise<void> {
  expect(process.env.STRIPE_LIVE_E2E).toBe('1');
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  const slug = `first-mail-${kind}-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.com`, password = 'FirstMailTest123!';
  const ids: string[] = [], sessions: string[] = [];
  const hydrationErrors: string[] = [];
  page.on('pageerror', error => { if (/hydrat|server rendered|didn.t match/i.test(error.message)) hydrationErrors.push(error.message); });
  let previewEnd: number | undefined;
  let trialEnd: number | undefined;
  const subscription = ['guest', 'signed-in', 'trial'].includes(kind);
  let groupId: string | undefined, couponId: string | undefined;
  let buyerId: string | undefined;
  let bankConfig: Record<string, unknown> | undefined;
  const customerIds = new Set<string>();
  try {
    if (kind === 'signed-in') {
      const result = await db.auth.admin.createUser({ email, password, email_confirm: true });
      expect(result.error).toBeNull(); buyerId = result.data.user!.id;
    }
    const product = await insert('products', {
      slug, name: `First mail ${kind}`, price: kind === 'trial' ? 11 : 17, currency: 'PLN', is_active: true, vat_exempt: true,
      is_bundle: kind === 'bundle', event_mode: kind === 'event',
      ...(subscription ? { product_type: 'subscription', recurring_price: kind === 'trial' ? 11 : 17, billing_interval: 'month', billing_interval_count: 1, trial_days: kind === 'trial' ? 7 : null } : {}),
    });
    ids.push(product.id);
    if (kind === 'bundle' || kind === 'variant') {
      const other = await insert('products', { slug: `${slug}-other`, name: 'Other course', price: 29, currency: 'PLN', is_active: true, vat_exempt: true });
      ids.push(other.id);
      if (kind === 'bundle') await insert('bundle_items', { bundle_product_id: product.id, component_product_id: other.id, display_order: 0 });
      else {
        const group = await insert('variant_groups', { name: 'First mail plans', slug, is_active: true }); groupId = group.id;
        await insert('product_variant_groups', { group_id: group.id, product_id: product.id, variant_name: 'Selected plan', display_order: 0 });
        await insert('product_variant_groups', { group_id: group.id, product_id: other.id, variant_name: 'Other plan', display_order: 1 });
      }
    }
    if (kind === 'event') {
      const event = await insert('product_sessions', { product_id: product.id, starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', title: 'June workshop', capacity: 20, online_url: 'https://example.com/first-mail-room' });
      await insert('product_price_tiers', { session_id: event.id, price: 17, sort: 0 });
    }
    let couponCode: string | undefined;
    if (kind === 'coupon' || trialCoupon) {
      const coupon = await insert('coupons', { code: `FREE-${randomUUID().slice(0,8)}`.toUpperCase(), discount_type: 'percentage', discount_value: trialCoupon ? 50 : 100, is_active: true });
      couponId = coupon.id; couponCode = coupon.code;
    }
    await acceptAllCookies(page);
    if (buyerId) await setAuthSession(page, email, password);
    expect(await searchMessages(email), 'No earlier message or resend').toHaveLength(0);
    page.on('response', async response => {
      if (response.url().includes('/api/create-payment-intent') && response.ok()) {
        const body = await response.json();
        if (body.checkoutSessionId && !sessions.includes(body.checkoutSessionId)) sessions.push(body.checkoutSessionId);
      }
    });
    if (kind === 'variant') {
      await page.goto(`/en/v/${groupId}`);
      await expect(page.getByText('Selected plan', { exact: true }).first()).toBeVisible();
      await page.getByRole('main').getByRole('button', { name: 'Select', exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`/checkout/${slug}(?:[?]|$)`));
    }
    if (kind !== 'transfer') await page.goto(`/${locale}/checkout/${slug}?email=${encodeURIComponent(email)}${couponCode ? `&coupon=${couponCode}` : ''}`);
    if (kind === 'transfer') {
      bankConfig = (await rows('bank_transfer_config', 'id', 'true'))[0];
      expect((await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Local workshop', bank_account_number: 'PL61109010140000071219812874', bank_transfer_grant_access_on_placement: true }).eq('id', true)).error).toBeNull();
      expect((await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false, bank_transfer_for: ['person'] }] } }).eq('id', product.id)).error).toBeNull();
      const response = await page.request.post('/api/orders/bank-transfer', { data: { productId: product.id, email, termsAccepted: true, captchaToken: await captcha(page), moduleValues: { buyer: { type: 'person', first_name: 'First', last_name: 'Buyer', email } } } });
      expect(response.status(), await response.text()).toBe(200);
      expect(await response.json()).toMatchObject({ amount: 1700, currency: 'PLN' });
      expect((await rows('payment_transactions', 'product_id', product.id))[0].status).toBe('awaiting_payment');
    } else if (kind === 'coupon') {
      await page.locator('input[type="email"]').fill(email);
      for (const checkbox of await page.locator('input[type="checkbox"]').all()) if (await checkbox.isVisible()) await checkbox.check();
      await page.getByRole('button', { name: /Send magic link/i }).click();
    } else {
      await startNativeCheckout(page);
      if (kind === 'trial') {
        await expect(page.getByTestId('order-summary-total')).toContainText(locale === 'pl' ? '0,00' : '0.00');
        await expect(page.getByTestId('trial-later-total')).toContainText(locale === 'pl' ? '11,00' : '11.00');
        await expect(page.getByRole('button', { name: locale === 'pl' ? 'Rozpocznij 7 dni za darmo' : 'Start 7 days free' })).toBeEnabled({ timeout: 30000 });
        await expect(page.getByTestId('trial-first-payment').first()).toBeVisible();
        if (trialCoupon) await expect(page.getByText(locale === 'pl' ? 'Kod rabatowy nie ma zastosowania' : 'Discount codes do not apply', { exact: false })).toBeVisible();
        await checkAccessibility(page, { excludeSelectors: ['iframe', 'altcha-widget', '#sf-cc-root'] });
        await page.screenshot({ path: test.info().outputPath('trial-before-confirmation.png'), fullPage: true });
      }
      if (await page.locator('#checkoutEmail').isVisible()) await page.locator('#checkoutEmail').fill(email);
      if (await page.locator('#fullName').isVisible()) await page.locator('#fullName').fill('First Mail Buyer');
      for (const checkbox of await page.locator('input[type="checkbox"]').all()) if (await checkbox.isVisible()) await checkbox.check();
      const frame = page.frameLocator('iframe[src*="elements-inner-payment"]');
      await expect(frame.locator('input[name="number"]')).toBeVisible({ timeout: 60000 });
      await frame.locator('input[name="number"]').fill('4242424242424242');
      await frame.locator('input[name="expiry"]').fill('1234');
      await frame.locator('input[name="cvc"]').fill('123');
      if (kind === 'trial') {
        const time = page.getByTestId('trial-first-payment').first();
        previewEnd = Date.parse((await time.getAttribute('datetime'))!) / 1000;
        const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
        expect(await time.innerText()).toBe(new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: zone }).format(new Date(previewEnd * 1000)));
      }
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/payment-status.*session_id=/, { timeout: 120000 });
      const sessionId = new URL(page.url()).searchParams.get('session_id')!;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.customer) customerIds.add(typeof session.customer === 'string' ? session.customer : session.customer.id);
      expect(session.status).toBe('complete');
      expect(session.amount_total).toBe(kind === 'trial' ? 0 : 1700);
      expect(session.payment_status).toBe('paid');
      if (kind === 'trial') {
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription!.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        expect(sub.status).toBe('trialing');
        expect(sub.trial_end! - sub.trial_start!).toBe(7 * 86400);
        expect(sub.items.data[0].price.unit_amount).toBe(1100);
        expect(Math.abs(sub.trial_end! - previewEnd!)).toBeLessThan(90);
        trialEnd = sub.trial_end!;
      }
      // Record provider facts without customer identifiers, metadata, or secrets.
      appendFileSync(`${process.env.STRIPE_LIVE_ARTIFACTS}/first-mail-provider.jsonl`, JSON.stringify({ kind, object: session.object, mode: session.mode, status: session.status, payment_status: session.payment_status, amount_total: session.amount_total, currency: session.currency }) + '\n');
      await expect.poll(async () => (await rows('payment_transactions', 'product_id', product.id)).filter(tx => tx.status === 'completed').length, { timeout: 60000 }).toBe(1);
      if (kind === 'signed-in') {
        await expect.poll(async () => (await rows('user_product_access', 'product_id', product.id)).some(access => access.user_id === buyerId), { timeout: 60000 }).toBe(true);
        expect(await searchMessages(email), 'Signed-in checkout opens access directly').toHaveLength(0);
        // Request the first link through the public flow, rather than resending one.
        const response = await page.request.post('/api/auth/magic-link', { data: { flow: 'post_checkout', email, productSlug: slug, locale: 'en', captchaToken: await captcha(page) } });
        expect(response.status(), await response.text()).toBe(200);
      } else if (subscription) {
        expect(await rows('user_product_access', 'product_id', product.id), 'Confirmation is required before subscription access').toHaveLength(0);
        expect(await rows('guest_purchases', 'product_id', product.id)).toHaveLength(0);
      }
    }
    const mail = await waitForEmail(email, { timeout: 60000 });
    expect(await searchMessages(email), 'Exactly the first delivered message').toHaveLength(1);
    if (kind !== 'coupon') {
      expect(mail.HTML).toContain(`First mail ${kind}`);
      expect(mail.HTML).toContain(kind === 'trial' ? locale === 'pl' ? '0,00\u00a0zł' : 'PLN\u00a00.00' : 'PLN\u00a017.00');
    } else {
      // No purchase exists until the coupon is redeemed after confirmation.
      expect(await rows('payment_transactions', 'product_id', product.id)).toHaveLength(0);
    }
    if (kind === 'trial') {
      expect(mail.HTML).toContain(locale === 'pl' ? '7 dni próby' : '7-day trial');
      expect(mail.HTML).toContain(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(trialEnd! * 1000)));
    }
    if (kind === 'variant') expect(mail.HTML).not.toContain('Other course');
    if (kind === 'event') {
      expect(mail.HTML).toContain('2099');
      expect(mail.HTML).toContain('https://example.com/first-mail-room');
    }
    if (kind === 'transfer') {
      expect(mail.HTML).toContain('PL61 1090 1014 0000 0712 1981 2874'); // grouped in fours since W137
      expect(mail.HTML).toContain('Bank transfer instructions');
    }
    const link = extractMagicLink(mail.HTML || mail.Text || ''); expect(link).toBeTruthy();
    await page.goto(link!);
    await expect(page).toHaveURL(new RegExp(`/p/${slug}(?:[/?]|$)`), { timeout: 90000 });
    const userId = (await db.rpc('find_user_id_by_email', { p_email: email })).data as string;
    expect(userId).toBeTruthy(); buyerId = userId;
    await expect.poll(async () => (await rows('user_product_access', 'product_id', product.id)).some(access => access.user_id === userId), { timeout: 60000 }).toBe(true);
    if (kind === 'variant') expect(await rows('user_product_access', 'product_id', ids[1])).toHaveLength(0);
    if (kind === 'bundle') expect((await rows('user_product_access', 'product_id', ids[1])).some(access => access.user_id === userId)).toBe(true);
    if (couponId) expect(await rows('coupon_redemptions', 'coupon_id', couponId)).toHaveLength(trialCoupon ? 0 : 1);
    await page.goto(`/${locale}/my-products`);
    await expect(page.getByText(`First mail ${kind}`, { exact: true }).first()).toBeVisible();
    expect(hydrationErrors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('first-mail-access.png'), fullPage: true });
  } finally {
    for (const id of ids) for (const sub of await rows('subscriptions', 'product_id', id)) {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      await expect.poll(async () => (await rows('subscriptions', 'product_id', id)).every(row => row.status === 'canceled'), { timeout: 60000 }).toBe(true);
    }
    for (const id of sessions) {
      const session = await stripe.checkout.sessions.retrieve(id);
      if (session.status === 'open') await stripe.checkout.sessions.expire(id);
    }
    for (const id of ids) {
      const product = (await rows('products', 'id', id))[0];
      const price = product?.stripe_price_id ? await stripe.prices.retrieve(product.stripe_price_id) : null;
      const productId = product?.stripe_product_id || (typeof price?.product === 'string' ? price.product : price?.product.id);
      if (productId) await stripe.products.update(productId, { default_price: '', active: false });
      if (price) await stripe.prices.update(price.id, { active: false });
    }
    await remove('guest_purchases', 'product_id', ids);
    await remove('user_product_access', 'product_id', ids);
    if (couponId) {
      await remove('coupon_redemptions', 'coupon_id', [couponId]);
      await remove('coupon_reservations', 'coupon_id', [couponId]);
    }
    await remove('payment_transactions', 'product_id', ids);
    await remove('subscriptions', 'product_id', ids);
    if (groupId) await remove('variant_groups', 'id', [groupId]);
    await remove('bundle_items', 'bundle_product_id', ids);
    await remove('products', 'id', ids);
    if (couponId) await remove('coupons', 'id', [couponId]);
    if (bankConfig) expect((await db.from('bank_transfer_config').update(bankConfig).eq('id', true)).error).toBeNull();
    await deleteAuthUserByEmail(db, email);
    for (const id of customerIds) await stripe.customers.del(id);
  }
}
test('new guest subscription first mail confirms access @J140', async ({ page }) => run(page, 'guest'));
test('signed-in subscription first requested mail retains receipt @J141', async ({ page }) => run(page, 'signed-in'));
test('trial subscription first mail confirms trial access @J142', async ({ page }) => run(page, 'trial'));
test('full coupon first invitation redeems access @J143', async ({ page }) => run(page, 'coupon'));
test('variant first mail identifies only selected plan @J144', async ({ page }) => run(page, 'variant'));
test('bundle first mail opens included course @J145', async ({ page }) => run(page, 'bundle'));
test('event first mail includes session and opens access @J146', async ({ page }) => run(page, 'event'));
test('transfer first mail includes due amount and opens early access @J147', async ({ page }) => run(page, 'transfer'));

// These views share a buyer timezone that differs from the app server.
test.describe('localized trial offer', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('Polish buyer sees zero today, billing terms and first trial mail @J148', async ({ page }) => run(page, 'trial', 'pl', true));
  test('English buyer sees zero today, billing terms and first trial mail @J148', async ({ page }) => run(page, 'trial', 'en', true));
});
