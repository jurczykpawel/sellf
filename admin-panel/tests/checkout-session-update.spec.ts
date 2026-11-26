/**
 * Cart changes on the on-site checkout update the same open Stripe Checkout Session (W219):
 * a linked coupon, then quantity, add-on and coupon removal change one session, the buyer pays it through the real Stripe
 * Payment Element (sandbox, test card) and the real `checkout.session.completed` event from
 * that sandbox, signed for this app, passes the webhook's saved-order amount check.
 * @see src/app/api/create-payment-intent/route.ts
 * @see src/lib/stripe/checkout-session-update.ts
 */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type Stripe from 'stripe';
import { test, startNativeCheckout } from './helpers/checkout-intent';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { clearPaidCheckout, refundEvent, recordedEvent, sendStripeEvent, testStripe } from './helpers/stripe-test-events';
import { declineLinkSignup } from './helpers/stripe-link';

test.describe.configure({ mode: 'serial' });

const slug = `session-update-${randomUUID().slice(0, 8)}`;
const email = `${slug}@example.com`;
const productIds: string[] = [];
const sessionIds = new Set<string>();
let couponId = '';
const couponCode = `W219-${randomUUID().slice(0, 6)}`.toUpperCase();

async function insert<T extends Record<string, unknown>>(table: string, value: object): Promise<T> {
  const { data, error } = await supabaseAdmin.from(table).insert(value).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T;
}

test.beforeAll(async () => {
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  const main = await insert<{ id: string }>('products', {
    slug, name: `Session update ${slug}`, price: 100, currency: 'PLN', is_active: true,
    vat_rate: 23, price_includes_vat: true,
    checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person'] }, { id: 'quantity', min: 1, max: 5, mode: 'checkout' }] },
  });
  const bump = await insert<{ id: string }>('products', { slug: `${slug}-bump`, name: 'Session update bonus', price: 20, currency: 'PLN', is_active: true, vat_exempt: true });
  productIds.push(main.id, bump.id);
  await insert('order_bumps', { main_product_id: main.id, bump_product_id: bump.id, bump_title: 'Session update bonus', bump_price: 20, is_active: true });
  couponId = (await insert<{ id: string }>('coupons', { code: couponCode, name: 'W219 quarter off', discount_type: 'percentage', discount_value: 25, is_active: true })).id;
});

test.afterAll(async () => {
  for (const id of sessionIds) {
    const session = await testStripe().checkout.sessions.retrieve(id);
    if (session.status === 'open') await testStripe().checkout.sessions.expire(id);
    await clearPaidCheckout(id);
  }
  const { data: txs } = await supabaseAdmin.from('payment_transactions').select('id').in('product_id', productIds);
  const ids = (txs ?? []).map(tx => tx.id);
  if (ids.length) {
    await supabaseAdmin.from('guest_purchases').delete().in('transaction_id', ids);
    await supabaseAdmin.from('payment_transactions').delete().in('id', ids);
  }
  await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', couponId);
  await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', couponId);
  await supabaseAdmin.from('coupons').delete().eq('id', couponId);
  await supabaseAdmin.from('order_bumps').delete().eq('main_product_id', productIds[0]);
  await supabaseAdmin.from('products').delete().in('id', productIds);
  // The guest's sign-in mail may wait in the retry queue (local auth mail limit).
  await supabaseAdmin.from('auth_mail_retries').delete().eq('email', email);
  const { data: users } = await supabaseAdmin.auth.admin.listUsers();
  const buyer = users?.users.find(user => user.email === email);
  if (buyer) await supabaseAdmin.auth.admin.deleteUser(buyer.id);
});

test('entered coupon, quantity, add-on and coupon removal keep one Stripe session that is paid and accepted by the webhook @J660 @J712', async ({ page, request }) => {
  test.setTimeout(300000);
  const stripe = testStripe();
  const since = Math.floor(Date.now() / 1000) - 5;
  // Keep the success page from verifying the payment itself: the webhook must complete the order.
  await page.route(/\/(payment\/success|p\/[^/]+\/payment-status)/, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>returned</p>' }));
  await acceptAllCookies(page);
  await page.goto(`/en/checkout/${slug}?email=${encodeURIComponent(email)}&coupon=UNKNOWN-CODE`);

  const sessionOf = async (response: Awaited<ReturnType<typeof startNativeCheckout>>) => { const id = (await response.json()).checkoutSessionId as string; sessionIds.add(id); return id; };
  const first = await sessionOf(await startNativeCheckout(page));
  expect(first).toMatch(/^cs_test_/);
  expect((await stripe.checkout.sessions.retrieve(first)).amount_total).toBe(10000);
  const cardBefore = page.frameLocator('iframe[title="Secure payment input frame"][src*="elements-inner-payment"]');
  await cardBefore.locator('input[name="number"]').fill('4242424242424242');
  await cardBefore.locator('input[name="expiry"]').fill('1234');
  await cardBefore.locator('input[name="cvc"]').fill('123');
  await declineLinkSignup(cardBefore);
  await page.getByLabel('Discount code', { exact: true }).fill(couponCode);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await sessionOf(await startNativeCheckout(page))).toBe(first);
  await expect(cardBefore.locator('input[name="number"]')).toHaveValue(/4242/);
  expect((await stripe.checkout.sessions.retrieve(first)).amount_total).toBe(7500);

  await page.getByLabel('Quantity', { exact: true }).fill('3');
  expect(await sessionOf(await startNativeCheckout(page))).toBe(first);
  await page.getByRole('button', { name: /Add to order/i }).click();
  expect(await sessionOf(await startNativeCheckout(page))).toBe(first);
  // Coupon with quantity 3 and the add-on: (3 × 100 + 20) − 25% = 240 PLN.
  expect((await stripe.checkout.sessions.retrieve(first)).amount_total).toBe(24000);
  await page.getByRole('button', { name: 'Remove discount code', exact: true }).click();
  expect(await sessionOf(await startNativeCheckout(page))).toBe(first);

  // Still one session, now charging the cart without the coupon: 3 × 100 + 20 = 320 PLN.
  const session = await stripe.checkout.sessions.retrieve(first, { expand: ['line_items'] });
  expect(session.status).toBe('open');
  expect(session.amount_total).toBe(32000);
  expect(session.line_items?.data.map(item => item.amount_total)).toEqual([30000, 2000]);
  expect(session.metadata).toMatchObject({ product_id: productIds[0], has_coupon: 'false' });
  expect(session.metadata?.coupon_id).toBeUndefined();
  expect(session.metadata?.sellf_instance).toMatch(/^[0-9a-f]{32}$/);
  const created = await stripe.checkout.sessions.list({ created: { gte: since }, limit: 100 });
  expect(created.data.filter(item => item.metadata?.product_id === productIds[0]).map(item => item.id)).toEqual([first]);
  const { data: pending } = await supabaseAdmin.from('payment_transactions').select('id,status,amount,coupon_id').eq('product_id', productIds[0]);
  expect(pending).toEqual([expect.objectContaining({ status: 'pending', amount: 32000, coupon_id: null })]);

  let releaseCart!: () => void, receivedCart!: () => void;
  const cartGate = new Promise<void>(resolve => { releaseCart = resolve; });
  const serverUpdated = new Promise<void>(resolve => { receivedCart = resolve; });
  await page.route('**/api/create-payment-intent', async route => {
    if (route.request().postDataJSON().quantity !== 2) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    receivedCart(); await cartGate; await route.fulfill({response});
  });
  await page.getByLabel('Quantity', {exact:true}).fill('2');
  await serverUpdated;
  expect((await stripe.checkout.sessions.retrieve(first)).amount_total).toBe(22000);
  await page.getByLabel('Quantity', {exact:true}).fill('3');
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
  await expect(page.locator('button[type="submit"]')).toHaveAttribute('data-checkout-pending','true');
  await expect(page.getByText(/Updating your cart/)).toBeVisible();
  releaseCart();
  await expect(page.locator('button[type="submit"]')).not.toHaveAttribute('data-checkout-pending','true');
  await expect(page.locator('[data-checkout-session-id]')).toHaveAttribute('data-checkout-session-id',first);
  expect((await stripe.checkout.sessions.retrieve(first)).amount_total).toBe(32000);
  await page.unroute('**/api/create-payment-intent');

  await page.locator('[id="buyer.first_name"]').fill('Session');
  await page.locator('[id="buyer.last_name"]').fill('Buyer');
  for (const checkbox of await page.locator('input[type="checkbox"]').all()) if (await checkbox.isVisible() && !await checkbox.isChecked()) await checkbox.check();
  const card = page.frameLocator('iframe[title="Secure payment input frame"][src*="elements-inner-payment"]');
  await expect(card.locator('input[name="number"]')).toBeVisible({ timeout: 60000 });
  await card.locator('input[name="number"]').fill('4242424242424242');
  await card.locator('input[name="expiry"]').fill('1234');
  await card.locator('input[name="cvc"]').fill('123');
  await declineLinkSignup(card);
  let resumeValidation!: () => void;
  const validationPaused = new Promise<void>(resolve => { resumeValidation = resolve; });
  await page.route('**/api/validate-email', async route => { await validationPaused; await route.continue(); });
  const validationStarted = page.waitForRequest('**/api/validate-email');
  try {
    await page.locator('button[type="submit"]').click();
    await validationStarted;
    await expect(page.getByLabel('Quantity', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Added', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  } finally { resumeValidation(); }
  await page.waitForURL(/payment\/success|payment-status/, { timeout: 120000 });

  const event = await recordedEvent('checkout.session.completed', item => (item.data.object as Stripe.Checkout.Session).id === first, since);
  const paid = event.data.object as Stripe.Checkout.Session;
  expect(paid.amount_total).toBe(32000);
  const delivered = await sendStripeEvent(request, event);
  expect(delivered.status()).toBe(200);

  const { data: orders } = await supabaseAdmin.from('payment_transactions').select('id,status,amount,coupon_id,session_id').eq('product_id', productIds[0]);
  expect(orders).toEqual([expect.objectContaining({ status: 'completed', amount: 32000, coupon_id: null, session_id: first })]);
  const { data: lines } = await supabaseAdmin.from('payment_line_items').select('item_type,quantity,discounted_total').eq('transaction_id', orders![0].id).order('item_type');
  expect(lines).toEqual([
    { item_type: 'main_product', quantity: 3, discounted_total: 300 },
    { item_type: 'order_bump', quantity: 1, discounted_total: 20 },
  ]);
  const intent = await stripe.paymentIntents.retrieve(typeof paid.payment_intent === 'string' ? paid.payment_intent : paid.payment_intent!.id);
  expect(intent.amount).toBe(32000);
  expect(intent.metadata).toMatchObject({ product_id: productIds[0], has_coupon: 'false', sellf_instance: session.metadata?.sellf_instance });
  expect(intent.metadata.coupon_id).toBeUndefined();

  const partial = await refundEvent(intent.id, 1000, 1000);
  await expect.poll(async () => (await sendStripeEvent(request, partial.event)).status(), { timeout: 15000 }).toBe(200);
  const partialVerification = await request.post('/api/verify-payment', { data: { session_id: first } });
  expect(partialVerification.status()).toBe(200);
  expect(await partialVerification.json()).toMatchObject({ payment_status: 'paid' });
  const { data: partiallyRefunded } = await supabaseAdmin.from('payment_transactions').select('status,refunded_amount').eq('session_id', first).single();
  expect(partiallyRefunded).toEqual({ status: 'partially_refunded', refunded_amount: 1000 });

  const refunded = await refundEvent(intent.id, 31000, 32000);
  await expect.poll(async () => (await sendStripeEvent(request, refunded.event)).status(), { timeout: 15000 }).toBe(200);
  const verified = await request.post('/api/verify-payment', { data: { session_id: first } });
  expect(verified.status()).toBe(200);
  expect(await verified.json()).toMatchObject({ payment_status: 'refunded', access_granted: false });
  await page.unroute(/\/(payment\/success|p\/[^/]+\/payment-status)/);
  for (const locale of ['pl', 'en']) {
    await page.goto(`/${locale}/p/${slug}/payment-status?session_id=${first}`);
    await expect(page.getByRole('heading', { name: locale === 'pl' ? 'Płatność zwrócona' : 'Payment refunded' })).toBeVisible();
  }
  const { data: accesses } = await supabaseAdmin.from('user_product_access').select('id').in('product_id', productIds);
  expect(accesses).toEqual([]);
});

test('cart selected during Stripe initialization pays the updated total @J660', async ({ page }) => {
  test.setTimeout(180000);
  const startupSlug = `startup-${randomUUID().slice(0, 8)}`;
  const main = await insert<{ id: string }>('products', { slug: startupSlug, name: 'Startup checkout', price: 10, currency: 'USD', is_active: true, vat_exempt: true });
  const bump = await insert<{ id: string }>('products', { slug: `${startupSlug}-bonus`, name: 'Startup bonus', price: 2, currency: 'USD', is_active: true, vat_exempt: true });
  productIds.push(main.id, bump.id);
  await insert('order_bumps', { main_product_id: main.id, bump_product_id: bump.id, bump_title: 'Startup bonus', bump_price: 2, is_active: true });
  let release!: () => void;
  let captured!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const initialized = new Promise<void>(resolve => { captured = resolve; });
  let held = false;
  await page.route('https://api.stripe.com/v1/payment_pages/**/init', async route => {
    if (held) { await route.continue(); return; }
    held = true;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    captured();
    await paused;
    await route.fulfill({ response });
  });
  await acceptAllCookies(page);
  await page.goto(`/en/checkout/${startupSlug}?email=${encodeURIComponent(email)}`);
  const initial = await (await startNativeCheckout(page)).json();
  sessionIds.add(initial.checkoutSessionId);
  try {
    await initialized;
    const changed = page.waitForResponse(r => r.url().endsWith('/api/create-payment-intent') && !r.request().postDataJSON()?.expireOnly);
    await page.getByRole('button', { name: /Add to order/i }).click();
    release();
    const updated = await (await changed).json();
    sessionIds.add(updated.checkoutSessionId);
    await expect(page.locator('button[type=submit]')).toBeEnabled();
    await page.locator('#fullName').fill('Startup Buyer');
    for (const checkbox of await page.locator('input[type=checkbox][required]').all()) if (await checkbox.isVisible() && !await checkbox.isChecked()) await checkbox.check();
    const card = page.frameLocator('iframe[title="Secure payment input frame"][src*="elements-inner-payment"]');
    await card.locator('input[name=number]').fill('4242424242424242');
    await card.locator('input[name=expiry]').fill('1234');
    await card.locator('input[name=cvc]').fill('123');
    await declineLinkSignup(card);
    const confirmation = page.waitForRequest('https://api.stripe.com/v1/payment_pages/**/confirm');
    await page.locator('button[type=submit]').click();
    expect(new URLSearchParams((await confirmation).postData() ?? '').get('expected_amount')).toBe('1200');
    await page.waitForURL(/payment-status.*session_id=/);
    const paid = await testStripe().checkout.sessions.retrieve(updated.checkoutSessionId);
    expect(paid.status).toBe('complete');
    expect(paid.amount_total).toBe(1200);
  } finally { release(); }
});
