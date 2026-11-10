import { useSupabaseBuyerEmails } from '../helpers/buyer-email-setting-playwright';
useSupabaseBuyerEmails();
import { test, startNativeCheckout } from '../helpers/checkout-intent';
/** Real Stripe test-mode checkout, fulfillment, and delivery checks. @see README.md */
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import Stripe from 'stripe';
import { solveChallenge } from 'altcha-lib/v1';
import { minorFactor } from '@/lib/currency/minor-units';
import { verifyWebhookSignature } from '@/lib/services/webhook-queue/signature';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { PREDEFINED_CUSTOM_FIELDS } from '@/lib/validations/custom-checkout-fields';
import type { Frame, Page } from '@playwright/test';
import { supabaseAdmin, createTestUser, createTestAdmin, setAuthSession } from '../helpers/admin-auth';
import { acceptAllCookies } from '../helpers/consent';
import { deleteAuthUserByEmail } from '../helpers/db-cleanup';
import { extractMagicLink, waitForEmail, searchMessages } from '../helpers/mailpit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const artifacts = process.env.STRIPE_LIVE_ARTIFACTS!;
const password = 'StripeTest123!';
let seller: Awaited<ReturnType<typeof createTestUser>>;

interface Scenario {
  slug: string;
  productIds: string[];
  email: string;
  domain: string;
  buyerId?: string;
  endpointId?: string;
  sessionIds: string[];
  subscription: boolean;
  coupon?: { id: string; code: string };
  netVat?: boolean;
  netCouponQuantity?: number;
  noBump?: boolean;
  profile?: boolean;
  eventSession?: string;
}
interface Delivery {
  headers: Record<string, string>;
  body: { id: string; event: string; data: { licenses?: { token: string }[] } };
  rawBody: string;
}
function deliveries(scenario: Scenario): Delivery[] {
  return readFileSync(`${artifacts}/deliveries.jsonl`, 'utf8').split('\n').filter(Boolean)
    .map(line => JSON.parse(line)).filter(row => row.path === `/${scenario.slug}`);
}
async function rows(table: string, column: string, value: string) {
  const { data, error } = await supabaseAdmin.from(table).select('*').eq(column, value);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data!;
}
async function insert(table: string, value: object) {
  const { data, error } = await supabaseAdmin.from(table).insert(value).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data!;
}
async function remove(table: string, column: string, values: string[]) {
  if (!values.length) return;
  const { error } = await supabaseAdmin.from(table).delete().in(column, values);
  if (error) throw new Error(`cleanup ${table}: ${error.message}`);
}

test.beforeAll(async () => {
  expect(process.env.STRIPE_LIVE_E2E).toBe('1');
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  seller = await createTestUser('stripe-live-seller');
  const key = generateSellerKeypair();
  await storeSellerKey(supabaseAdmin, { sellerId: seller.userId, ...key, custody: 'managed' });
});
test.afterAll(async () => {
  if (!seller) return;
  await remove('seller_license_keys', 'seller_id', [seller.userId]);
  await seller.cleanup();
});

async function setup(s: Scenario, loggedIn: boolean): Promise<void> {
  if (loggedIn) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({ email: s.email, password, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message ?? 'Buyer creation failed');
    s.buyerId = data.user.id;
  }
  const main = await insert('products', {
    slug: s.slug, name: `Stripe live ${s.slug}`, price: s.netCouponQuantity ? 100 : 10, currency: s.netCouponQuantity ? 'PLN' : 'USD', is_active: true,
    seller_id: seller.userId, vat_exempt: !s.netVat,
    ...(s.netVat ? { vat_rate: 23, price_includes_vat: false } : {}),
    ...(s.subscription ? {
      product_type: 'subscription', recurring_price: 10, billing_interval: 'month', billing_interval_count: 1,
    } : {
      issue_license_on_purchase: !s.profile && !s.netCouponQuantity, license_tier: 'pro',
      custom_checkout_fields: [{ ...PREDEFINED_CUSTOM_FIELDS.license_domain, required: true, claim: undefined }],
    }),
  });
  s.productIds.push(main.id);
  if (s.netCouponQuantity) {
    expect((await supabaseAdmin.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false }, { id: 'quantity', min: 1, max: 5, mode: 'product_page' }] } }).eq('id', main.id)).error).toBeNull();
  }
  if (s.profile) {
    const { error } = await supabaseAdmin.from('products').update({ checkout_profile: { v: 1, modules: [
      { id: 'buyer', types: ['organization'], gus: false }, { id: 'recipient', for: ['organization'] },
      { id: 'phone', required: true }, { id: 'quantity', min: 1, max: 5, mode: 'product_page' },
      { id: 'participants', required: true, prefill_from_buyer: true },
    ] } }).eq('id', main.id);
    expect(error).toBeNull();
  }
  if (!s.subscription && !s.noBump) {
    const bump = await insert('products', { slug: `${s.slug}-bump`, name: 'Live test bonus', price: s.netCouponQuantity ? 19 : 2, currency: s.netCouponQuantity ? 'PLN' : 'USD', is_active: true, vat_exempt: true, seller_id: seller.userId });
    s.productIds.push(bump.id);
    await insert('order_bumps', { main_product_id: main.id, bump_product_id: bump.id, bump_title: 'Live test bonus', bump_price: s.netCouponQuantity ? 19 : 2, is_active: true });
  }
  const endpoint = await insert('webhook_endpoints', {
    url: `${process.env.STRIPE_LIVE_RECEIVER_URL}/${s.slug}`, secret: randomUUID(),
    description: s.slug, product_filter_mode: 'selected', is_active: true,
    events: [s.subscription ? 'invoice.paid' : 'purchase.completed'],
  });
  s.endpointId = endpoint.id;
  await insert('webhook_endpoint_products', { webhook_endpoint_id: endpoint.id, product_id: main.id });
}

async function cleanup(s: Scenario): Promise<void> {
  // Stop remote billing before removing the local subscription/account.
  const subs = s.productIds.length ? await rows('subscriptions', 'product_id', s.productIds[0]) : [];
  for (const sub of subs) {
    await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    await expect.poll(async () => {
      const events = await stripe.events.list({ type: 'customer.subscription.deleted', limit: 100 });
      const event = events.data.find(item => item.data.object.id === sub.stripe_subscription_id);
      if (!event) return false;
      return readFileSync(`${artifacts}/stripe.jsonl`, 'utf8').split('\n')
        .some(line => line.includes('[200] POST') && line.includes(event.id));
    }, { timeout: 60000, message: 'Subscription cancellation acknowledged before fixture removal' }).toBe(true);
  }
  for (const id of s.sessionIds) {
    const session = await stripe.checkout.sessions.retrieve(id);
    if (session.status === 'open') await stripe.checkout.sessions.expire(id);
  }
  if (s.endpointId) {
    await remove('webhook_logs', 'endpoint_id', [s.endpointId]);
    await remove('webhook_endpoints', 'id', [s.endpointId]);
  }
  await remove('issued_licenses', 'product_id', s.productIds);
  await remove('guest_purchases', 'product_id', s.productIds);
  await remove('user_product_access', 'product_id', s.productIds);
  await remove('payment_transactions', 'product_id', s.productIds);
  await remove('subscriptions', 'product_id', s.productIds);
  await remove('order_bumps', 'main_product_id', s.productIds);
  const products = s.productIds.length ? await supabaseAdmin.from('products').select('id,stripe_product_id,stripe_price_id').in('id', s.productIds) : { data: [] };
  for (const product of products.data ?? []) {
    const price = product.stripe_price_id ? await stripe.prices.retrieve(product.stripe_price_id) : null;
    const stripeProductId = product.stripe_product_id || (typeof price?.product === 'string' ? price.product : price?.product.id);
    if (stripeProductId) await stripe.products.update(stripeProductId, { default_price: '', active: false });
    if (price) await stripe.prices.update(price.id, { active: false });
  }
  if (s.coupon) {
    await remove('coupon_redemptions', 'coupon_id', [s.coupon.id]);
    await remove('coupon_reservations', 'coupon_id', [s.coupon.id]);
    await remove('coupons', 'id', [s.coupon.id]);
  }
  await remove('products', 'id', s.productIds);
  await deleteAuthUserByEmail(supabaseAdmin, s.email);
}

async function fillCard(page: Page, card: string): Promise<void> {
  // Stripe owns this iframe: no mocked Stripe script, API, or webhook.
  // Stripe also renders an auxiliary frame with the same title.
  const frame = page.frameLocator('iframe[title="Secure payment input frame"][src*="elements-inner-payment"]');
  await expect(frame.locator('input[name="number"]')).toBeVisible({ timeout: 60000 });
  await frame.locator('input[name="number"]').fill(card);
  await frame.locator('input[name="expiry"]').fill('1234');
  await frame.locator('input[name="cvc"]').fill('123');
}
async function timing(s: Scenario, sessionId: string, pageAt: number): Promise<string> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  const eventIds: { type: string; id: string }[] = [];
  const collectEventIds = async () => {
    eventIds.length = 0;
    for (const type of ['checkout.session.completed', 'payment_intent.succeeded']) {
      const events = await stripe.events.list({ type, limit: 100 });
      const event = events.data.find(e => e.data.object.id === (type.startsWith('checkout') ? sessionId : pi));
      if (event) eventIds.push({ type, id: event.id });
    }
    return eventIds.length;
  };
  if (s.subscription) await collectEventIds();
  else await expect.poll(collectEventIds, { timeout: 60000, message: 'Both Stripe completion events available' }).toBe(2);
  await expect.poll(() => {
    const listener = readFileSync(`${artifacts}/stripe.jsonl`, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    return eventIds.every(event => listener.some(row => row.line.includes('[200] POST') && row.line.includes(event.id)));
  }, { timeout: 60000, message: 'Both Stripe completion events acknowledged' }).toBe(true);
  const log = readFileSync(`${artifacts}/server.jsonl`, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const arrivals = eventIds.map(event => {
    const row = log.find(row => row.line.includes(`Received: ${event.type} (${event.id})`));
    expect(row, `Server receipt of ${event.type}`).toBeTruthy();
    return { type: event.type, at: row.at };
  });
  if (!s.subscription) expect(arrivals).toHaveLength(2);
  const pageLog = log.find(row => row.line.includes(`/p/${s.slug}/payment-status?`));
  arrivals.push({ type: 'success page', at: pageLog?.at ?? pageAt });
  arrivals.sort((a, b) => a.at - b.at);
  const order = arrivals.map(row => row.type).join(' → ');
  appendFileSync(`${artifacts}/timing.jsonl`, JSON.stringify({ scenario: s.slug, sessionId, arrivals, order }) + '\n');
  return order;
}

async function run(page: Page, label: string, card: string, options: { loggedIn?: boolean; subscription?: boolean; challenge?: boolean; declined?: boolean; coupon?: boolean; setPrice?: boolean; fixedPrice?: boolean; netVat?: boolean; profile?: boolean; event?: boolean; netCouponQuantity?: number; noBump?: boolean; expireCouponAfterReservation?: boolean; multipleLicenses?: boolean; licensedSubscription?: boolean } = {}): Promise<void> {
  const slug = `stripe-live-${label}-${randomUUID().slice(0, 8)}`;
  const s: Scenario = { slug, productIds: [], email: `${slug}@example.com`, domain: `${slug}.example.com`, sessionIds: [], subscription: !!options.subscription, netVat: options.netVat, profile: options.profile, netCouponQuantity: options.netCouponQuantity, noBump: options.noBump };
  let passed = false;
  let order = 'not observed';
  try {
    await setup(s, !!options.loggedIn);
    if (options.event) {
      expect((await supabaseAdmin.from('products').update({ event_mode: true, issue_license_on_purchase: false, custom_checkout_fields: [], checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false }, { id: 'quantity', min: 1, max: 5, mode: 'product_page' }] } }).eq('id',s.productIds[0])).error).toBeNull();
      const eventSession = await insert('product_sessions', { product_id: s.productIds[0], starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', title: 'June workshop', capacity: 60 });
      s.eventSession = eventSession.id;
      await insert('product_price_tiers', { session_id: eventSession.id, price: 47, seats: 30, sale_ends_at: '2099-05-01T12:00:00Z', sort: 0 });
      await insert('product_price_tiers', { session_id: eventSession.id, price: 67, sort: 1 });
    }
    if (options.coupon || options.setPrice || options.fixedPrice) {
      s.coupon = await insert('coupons', { code: `LIVE-${randomUUID().slice(0, 8)}`.toUpperCase(), name: 'Live percentage', discount_type: options.setPrice ? 'set_price' : options.fixedPrice ? 'fixed' : s.profile ? 'fixed' : 'percentage', discount_value: options.setPrice ? s.netCouponQuantity ? 30 : 3 : options.fixedPrice ? 70 * s.netCouponQuantity! : s.profile ? 7.01 : 25, currency: options.setPrice || options.fixedPrice ? s.netCouponQuantity ? 'PLN' : 'USD' : null, exclude_order_bumps: !!options.fixedPrice, usage_limit_global: s.netCouponQuantity ? 1 : null, is_active: true });
    }
    await acceptAllCookies(page);
    if (options.multipleLicenses || options.licensedSubscription) {
      expect((await supabaseAdmin.from('products').update({issue_license_on_purchase:true,license_tier:'pro'}).in('id',s.productIds)).error).toBeNull();
    }
    if (s.buyerId) await setAuthSession(page, s.email, password);
    page.on('response', async response => {
      if (response.url().includes('/api/create-payment-intent') && response.ok()) {
        const body = await response.json();
        if (body.checkoutSessionId && !s.sessionIds.includes(body.checkoutSessionId)) s.sessionIds.push(body.checkoutSessionId);
      }
    });
    const hydrationErrors: string[] = [];
    page.on('pageerror', error => { if (error.message.includes('Hydration failed')) hydrationErrors.push(error.message); });
    let failedPageShown = false;
    await page.exposeFunction('recordPaymentFailure', () => { failedPageShown = true; });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.body?.innerText.includes('Payment Failed')) (window as unknown as { recordPaymentFailure: () => void }).recordPaymentFailure();
      }).observe(document, { childList: true, subtree: true });
    });
    const query = new URLSearchParams();
    if (!s.netCouponQuantity) query.set('email', s.email);
    if (s.coupon) query.set('coupon', s.coupon.code);
    await page.goto(`/en/checkout/${slug}?${query}`);
    await expect(page.getByRole('button', { name: /Continue to payment/ })).toHaveCount(0);
    if (s.coupon) await expect(page.getByRole('button', { name: 'Remove discount code', exact: true })).toBeVisible();
    const initiallyFree = !!options.fixedPrice && (s.netCouponQuantity ?? 0) > 1;
    if (initiallyFree) await expect(page.getByRole('button', { name: /Send magic link/i })).toBeVisible();
    else await startNativeCheckout(page);
    const desiredQuantity = s.netCouponQuantity ?? (s.profile ? 3 : options.event ? 2 : null);
    if (desiredQuantity !== null) {
      const quantity = page.getByLabel('Quantity', { exact: true });
      if ((await quantity.inputValue()) !== String(desiredQuantity)) {
        await quantity.fill(String(desiredQuantity));
        await startNativeCheckout(page);
      }
    }
    if (s.profile) {
      for (const prefix of ['buyer', 'recipient']) {
        if (prefix === 'recipient') await page.getByLabel('Different recipient').check();
        for (const [key, value] of Object.entries({ company_name: 'Test Organization', nip: '5260250274', address: 'Prosta 1', postal_code: '00-001', city: 'Warszawa' })) {
          await page.locator(`[id="${prefix}.${key}"]`).fill(value);
        }
      }
      await page.locator('[id="phone"]').fill('500100200');
      for (let index = 0; index < 3; index++) {
        for (const [key, value] of Object.entries({ first_name: 'Jan', last_name: 'Nowak', email: `participant${index}@example.com` })) {
          await page.locator(`[id="participants.${index}.${key}"]`).fill(value);
        }
      }
    } else if (options.event || s.netCouponQuantity) {
      await page.locator('[id="buyer.first_name"]').fill('Stripe');
      await page.locator('[id="buyer.last_name"]').fill('Test Buyer');
    }
    const hasProfile = !!s.profile || !!options.event || !!s.netCouponQuantity;
    if (!s.subscription && !s.noBump) {
      await page.getByRole('button', { name: /Add to order/i }).click();
      await startNativeCheckout(page);
    }
    if (hasProfile) {
      const emailInput = page.locator('input#checkoutEmail');
      if (await emailInput.count()) await emailInput.fill(s.email);
      await expect(page.locator('#checkoutEmail')).toHaveCount(0);
      await expect(page.locator('[data-test-email]')).toHaveAttribute('data-test-email', s.email, { timeout: 90000 });
      await expect(page.locator('[data-test-email]').getByText(s.email, { exact: true })).toBeVisible();
    } else {
      await expect(page.locator('#checkoutEmail')).toBeVisible({ timeout: 90000 });
      await page.locator('#checkoutEmail').fill(s.email);
    }
    if (s.coupon) {
      await expect(page.getByRole('textbox', { name: 'Discount code', exact: true })).toHaveValue(s.coupon.code);
      await expect(page.getByRole('button', { name: /Remove discount code/i })).toBeVisible();
    }
    if (!s.profile && !options.event && !s.netCouponQuantity) await page.locator('#fullName').fill('Stripe Test Buyer');
    if (!s.subscription && !options.event) await page.getByLabel(/License domain/).fill(s.domain);
    const terms = page.locator('input[type="checkbox"]');
    for (const checkbox of await terms.all()) if (await checkbox.isVisible()) await checkbox.check();
    await fillCard(page, card);
    if (!s.profile && !options.event && !s.netCouponQuantity) await expect(page.locator('#fullName')).toHaveValue('Stripe Test Buyer');
    if (options.expireCouponAfterReservation) {
      await page.route('**/api/update-payment-metadata', async route => {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        expect((await supabaseAdmin.from('coupons').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('id', s.coupon!.id)).error).toBeNull();
        await route.fulfill({ response });
      });
    }
    await page.locator('button[type="submit"]').click();
    if (options.challenge) {
      let challenge: Frame | undefined;
      await expect.poll(async () => {
        for (const frame of page.frames()) {
          if (frame.url().startsWith('https://testmode-acs.stripe.com/') && await frame.getByRole('button', { name: /Complete/ }).count()) {
            challenge = frame;
            return true;
          }
        }
        return false;
      }, { timeout: 60000, message: 'Stripe test authentication challenge' }).toBe(true);
      await challenge!.getByRole('button', { name: /Complete/ }).click();
    }
    if (options.declined) {
      await expect(page.getByText(/Your card (?:was|has been) declined/i)).toBeVisible({ timeout: 60000 });
      await expect.poll(() => s.sessionIds.length).toBeGreaterThan(0);
      // Await Stripe's real terminal attempt event before checking negative outcomes.
      await expect.poll(async () => {
        const events = await stripe.events.list({ type: 'payment_intent.payment_failed', limit: 100 });
        return events.data.some(e => 'metadata' in e.data.object && e.data.object.metadata?.product_id === s.productIds[0]);
      }, { timeout: 60000 }).toBe(true);
      const txs = await rows('payment_transactions', 'product_id', s.productIds[0]);
      expect(txs.filter(row => row.status === 'completed')).toHaveLength(0);
      expect(await rows('issued_licenses', 'product_id', s.productIds[0])).toHaveLength(0);
      expect(deliveries(s)).toHaveLength(0);
      expect(await rows('webhook_logs', 'endpoint_id', s.endpointId!)).toHaveLength(0);
      order = 'payment_intent.payment_failed; no success page';
    } else {
      await page.waitForURL(/payment-status.*session_id=/, { timeout: 120000 });
      const pageAt = Date.now();
      const sessionId = new URL(page.url()).searchParams.get('session_id')!;
      if (!s.sessionIds.includes(sessionId)) s.sessionIds.push(sessionId);
      await expect(page.getByText(/Payment Failed/i)).toHaveCount(0);
      await expect(page.getByText(/Payment received|Access granted|You now have access|Payment successful|Your payment has been processed successfully/i).first()).toBeVisible({ timeout: 90000 });
      expect(failedPageShown, 'Payment Failed was never rendered').toBe(false);
      await expect.poll(async () => (await rows('payment_transactions', 'product_id', s.productIds[0])).filter(row => row.status === 'completed').length, { timeout: 90000 }).toBe(1);
      await expect.poll(() => deliveries(s).length, { timeout: 90000 }).toBe(1);
      order = await timing(s, sessionId, pageAt);
      const txs = await rows('payment_transactions', 'product_id', s.productIds[0]);
      expect(txs.filter(row => row.status === 'pending')).toHaveLength(0);
      const completed = txs.filter(row => row.status === 'completed');
      expect(completed).toHaveLength(1);
      for (const superseded of txs.filter(row => row.status !== 'completed')) {
        expect(superseded.customer_email).toBe(s.netCouponQuantity ? 'pending@sellf.app' : s.email);
        expect(superseded.status).toBe('abandoned');
        expect((await stripe.checkout.sessions.retrieve(superseded.session_id)).status).toBe('expired');
      }
      const tx = completed[0];
      expect(tx.status).toBe('completed');
      expect(tx.customer_email).toBe(s.email);
      if (s.buyerId) expect(tx.user_id).toBe(s.buyerId);
      expect(tx.stripe_payment_intent_id).toMatch(/^pi_/);
      if (s.subscription) {
        expect(tx.order_details?.buyer).toMatchObject({ full_name: 'Stripe Test Buyer', source: 'stripe_metadata' });
      }
      if (!s.subscription) {
        expect(tx.session_id).toBe(sessionId);
        expect(tx.pricing_snapshot_version).toBe(1);
        expect(Number(tx.order_number)).toBeGreaterThanOrEqual(1001);
        if (!options.event) expect(tx.custom_field_values._sellf_license_domain).toBe(s.domain);
        const items = await rows('payment_line_items', 'transaction_id', tx.id);
        expect(items).toHaveLength(s.noBump ? 1 : 2);
        expect(new Set(items.map(row => row.product_id))).toEqual(new Set(s.productIds));
        for (const item of items) {
          const expectedPrice = item.product_id === s.productIds[0] ? s.netCouponQuantity ? 100 : options.event ? 47 : 10 : s.netCouponQuantity ? 19 : 2;
          const quantity = item.product_id === s.productIds[0] ? s.netCouponQuantity ?? (options.event ? 2 : s.profile ? 3 : 1) : 1;
          expect(item.quantity).toBe(quantity);
          expect(Number(item.unit_price)).toBe(expectedPrice);
          expect(Number(item.total_price)).toBe(expectedPrice * quantity);
          expect(item.currency).toBe(s.netCouponQuantity ? 'PLN' : 'USD');
        }
        if (options.event) {
          const eventLine = items.find(item => item.product_id === s.productIds[0]);
          expect(eventLine).toMatchObject({ session_id: s.eventSession, session_label: 'June workshop', session_starts_at: '2099-06-01T12:00:00+00:00', quantity: 2 });
          expect(await rows('seat_reservations', 'transaction_id', tx.id)).toEqual([expect.objectContaining({ session_id: s.eventSession, status: 'confirmed', quantity: 2 })]);
          expect(Number(tx.amount)).toBe(9600);
          expect(deliveries(s)[0].rawBody).toContain(s.eventSession!);
        }
        const basis = Math.round(items.reduce((total, item) => total + Number(item.discounted_total), 0) * minorFactor(tx.currency));
        const exclusiveTax = items.filter(item => item.tax_behavior === 'exclusive').reduce((sum, item) => sum + Number(item.tax_amount), 0);
        expect(basis + exclusiveTax).toBe(Number(tx.amount));
        if (s.coupon) {
          expect(tx.coupon_id).toBe(s.coupon.id);
          expect(basis).toBe(s.netCouponQuantity ? (30 * s.netCouponQuantity + (s.noBump ? 0 : 19)) * 100 : options.setPrice ? 500 : s.profile ? 2499 : 900);
          if (options.setPrice && !s.netCouponQuantity) expect(items.map(item => Number(item.discounted_total)).sort()).toEqual([2, 3]);
          expect(await rows('coupon_redemptions', 'transaction_id', tx.id)).toHaveLength(1);
        }
        if (s.netVat) {
          expect(Number(tx.tax_total)).toBe(s.netCouponQuantity ? 690 * s.netCouponQuantity : 230);
          expect(Number(tx.net_total)).toBe(s.netCouponQuantity ? basis : 1200);
          expect(Number(tx.amount)).toBe(s.netCouponQuantity ? basis + 690 * s.netCouponQuantity : 1430);
        }
        const licenses = await rows('issued_licenses', 'product_id', s.productIds[0]);
        if (s.profile) {
          expect(licenses).toHaveLength(0);
          expect(tx.order_details).toMatchObject({ buyer: { type: 'organization', nip: '5260250274' }, recipient: { differs: true, nip: '5260250274' }, phone: { value: '+48500100200' }, quantity: { value: 3 } });
          expect(tx.order_details.participants.people).toHaveLength(3);
          expect(tx.order_details.details_missing).toBeUndefined();
          expect(Number(tx.amount)).toBe(2499);
          const stripeLines = await stripe.checkout.sessions.listLineItems(sessionId);
          expect(stripeLines.data[0].quantity).toBe(1);
          expect(stripeLines.data[0].description).toContain('× 3');
          expect(stripeLines.data.reduce((sum, line) => sum + line.amount_total, 0)).toBe(Number(tx.amount));
        } else if (options.event || s.netCouponQuantity) {
          expect(licenses).toHaveLength(0);
        } else {
          expect(licenses).toHaveLength(1);
          expect(licenses[0].license_domain).toBe(s.domain);
          expect(deliveries(s)[0].body.data.licenses?.[0].token).toBe(licenses[0].license_key);
        }
      }
      if (s.buyerId) {
        for (const id of s.productIds) expect((await rows('user_product_access', 'product_id', id)).some(row => row.user_id === s.buyerId)).toBe(true);
      } else {
        const purchases = await rows('guest_purchases', 'session_id', sessionId);
        expect(purchases).toHaveLength(s.subscription ? 0 : 1);
        if (s.subscription) expect(await rows('user_product_access', 'product_id', s.productIds[0])).toHaveLength(0);
        else {
          expect(purchases[0].product_id).toBe(s.productIds[0]);
          expect(purchases[0].customer_email).toBe(s.email);
        }
        const message = await waitForEmail(s.email, { timeout: 60000 });
        expect(message.HTML).toContain(`Stripe live ${s.slug}`);
        if (s.subscription) expect(message.HTML).toContain('$10.00');
        const keys = await rows('issued_licenses', 'email', s.email);
        for (const key of keys) expect(message.HTML).toContain(key.license_key);
        if (options.multipleLicenses) expect(keys).toHaveLength(2);
        if (options.licensedSubscription) expect(keys).toHaveLength(1);
        expect(await searchMessages(s.email)).toHaveLength(1);
        if (keys.length) {
          await supabaseAdmin.from('auth_mail_retries').update({next_attempt_at:new Date(0).toISOString()}).eq('email',s.email).is('license_mail_key',null);
          const cron = await page.request.get('/api/cron?job=auth-mail-retry',{headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`}});
          expect(cron.ok()).toBe(true);
          expect(await searchMessages(s.email)).toHaveLength(1);
          await expect.poll(async ()=>(await rows('auth_mail_retries','email',s.email)).length,{timeout:30000}).toBe(0);
          await expect(page.getByText(/mail server is busy/i)).toHaveCount(0);
        }
        const magicLink = extractMagicLink(message.HTML || message.Text || '');
        expect(magicLink, 'Delivered post-checkout magic link').toBeTruthy();
        await page.goto(magicLink!);
        await expect(page).toHaveURL(new RegExp(`/p/${slug}(?:[/?]|$)`), { timeout: 90000 });
        await page.goto('/en/my-products');
        await expect(page).toHaveURL(/\/my-products(?:[/?]|$)/);
        const { data: buyerId, error: buyerError } = await supabaseAdmin.rpc('find_user_id_by_email', { p_email: s.email });
        if (buyerError || !buyerId) throw new Error(buyerError?.message ?? 'Guest account was not created');
        s.buyerId = buyerId as string;
        for (const id of s.productIds) {
          await expect.poll(async () => (await rows('user_product_access', 'product_id', id)).some(row => row.user_id === s.buyerId), { timeout: 60000 }).toBe(true);
        }
        const claimed = await rows('guest_purchases', 'session_id', sessionId);
        if (!s.subscription) expect(claimed[0].claimed_by_user_id).toBe(s.buyerId);
      }
      const delivery = deliveries(s)[0];
      expect(delivery.body.event).toBe(s.subscription ? 'invoice.paid' : 'purchase.completed');
      expect(delivery.headers['x-sellf-delivery-id']).toBe(delivery.body.id);
      // Both competing completion handlers must finish before the final duplicate check.
      await expect.poll(async () => {
        const logs = await rows('webhook_logs', 'endpoint_id', s.endpointId!);
        return logs.length === 1 && logs[0].status === 'success';
      }, { timeout: 60000 }).toBe(true);
      expect(deliveries(s)).toHaveLength(1);
      if (options.loggedIn) {
        mkdirSync('/tmp/rcfix-core-shots', { recursive: true });
        for (const locale of ['en', 'pl']) for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`/${locale}/p/${s.slug}/payment-status?session_id=${encodeURIComponent(sessionId)}`);
          await expect(page.getByRole('link', { name: locale === 'pl' ? 'Otwórz zakupiony produkt' : 'Open your purchase' })).toBeVisible();
          await page.screenshot({ path: `/tmp/rcfix-core-shots/confirmation-${locale}-${width}.png`, fullPage: true, animations: 'disabled' });
        }
      }
    }
    if (options.multipleLicenses) {
      const licenses=await rows('issued_licenses','email',s.email);
      const transaction=(await rows('payment_transactions','product_id',s.productIds[0])).find(tx=>tx.status==='completed')!;
      const admin=await createTestAdmin('licensed-bump-refund');
      try {
        expect((await supabaseAdmin.from('webhook_endpoints').update({events:['purchase.completed','license.revoked']}).eq('id',s.endpointId!)).error).toBeNull();
        for(const productId of s.productIds.slice(1))await insert('webhook_endpoint_products',{webhook_endpoint_id:s.endpointId!,product_id:productId});
        await setAuthSession(page,admin.email,admin.password);
        const response=await page.request.post('/api/admin/payments/refund',{data:{transactionId:transaction.id,reason:'requested_by_customer'}});
        expect(response.ok(),await response.text()).toBe(true);
        await expect.poll(async()=> (await rows('issued_licenses','email',s.email)).filter(row=>row.revoked_at&&row.revocation_reason==='refund').length,{timeout:90000}).toBe(2);
        for(const license of licenses){
          const hash=createHash('sha256').update(license.order_id).digest('hex');
          const crl=await page.request.get(`/api/licenses/revoked?seller=${license.original_seller_id}&prefix=${hash.slice(0,4)}`);
          expect((await crl.json()).order_hashes).toContain(hash);
        }
        await expect.poll(async()=>{
          const cron=await page.request.get('/api/cron?job=business-events',{headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`}});
          expect(cron.ok()).toBe(true);
          return deliveries(s).filter(row=>row.body.event==='license.revoked').length;
        },{timeout:90000}).toBe(2);
        const revoked=deliveries(s).filter(row=>row.body.event==='license.revoked');
        expect(revoked.map(row=>(row.body.data as {license:{id:string}}).license.id).sort()).toEqual(licenses.map(row=>row.id).sort());
        const endpoint=(await rows('webhook_endpoints','id',s.endpointId!))[0];
        for(const delivery of revoked)expect(verifyWebhookSignature(endpoint.secret,delivery.rawBody,delivery.headers['x-sellf-signature'])).toBe(true);
        expect((await rows('issued_licenses','email',s.email)).map(row=>row.license_key).sort()).toEqual(licenses.map(row=>row.license_key).sort());
      } finally {await admin.cleanup();}
    }
    expect(hydrationErrors).toEqual([]);
    passed = true;
  } finally {
    if (s.productIds.length) {
      const transactions = await rows('payment_transactions', 'product_id', s.productIds[0]);
      writeFileSync(`${artifacts}/${slug}.json`, JSON.stringify({
        scenario: s, transactions,
        licenses: await rows('issued_licenses', 'product_id', s.productIds[0]),
        lineItems: (await Promise.all(transactions.map(tx => rows('payment_line_items', 'transaction_id', tx.id)))).flat(),
        deliveries: deliveries(s),
      }, null, 2), { mode: 0o600 });
    }
    appendFileSync(`${artifacts}/summary.jsonl`, JSON.stringify({ scenario: label, pass: passed, order }) + '\n');
    await cleanup(s);
  }
}

test('guest license and bump @J01', async ({ page }) => { await run(page, 'guest', '4242424242424242'); });
test('signed-in license and bump @J02', async ({ page }) => { await run(page, 'signed-in', '4242424242424242', { loggedIn: true }); });
test('3D Secure license and bump @J03', async ({ page }) => { await run(page, '3ds', '4000002500003155', { challenge: true }); });
test('declined card @J04', async ({ page }) => { await run(page, 'declined', '4000000000000002', { declined: true }); });
test('subscription initial purchase @J05', async ({ page }) => { await run(page, 'subscription', '4242424242424242', { subscription: true }); });
for (let i = 1; i <= 5; i++) test(`guest repeated purchase ${i}/5 @J01`, async ({ page }) => { await run(page, 'repeat', '4242424242424242'); });

test('percentage coupon with bump @J06', async ({ page }) => { await run(page, 'coupon-bump', '4242424242424242', { coupon: true }); });
test('net product with local VAT @J07', async ({ page }) => { await run(page, 'net-vat', '4242424242424242', { netVat: true }); });

test('guest and signed-in B2B profiles with three units and a fixed coupon @J08', async ({ page, context }) => {
  await run(page, 'profile-b2b', '4242424242424242', { profile: true, coupon: true });
  const signedIn = await context.newPage();
  try { await run(signedIn, 'profile-b2b-signed-in', '4242424242424242', { profile: true, coupon: true, loggedIn: true }); }
  finally { await signedIn.close(); }
});

test('event with two promotional seats confirms inventory and delivers session snapshot @J09', async ({ page }) => { await run(page, 'event', '4242424242424242', { event: true }); });

test('set price coupon from link with unchanged bump @J10', async ({ page }) => { await run(page, 'set-price', '4242424242424242', { setPrice: true }); });

test('PLN net set price quantity one', async ({ page }) => { await run(page, 'net-set-one', '4242424242424242', { setPrice: true, netVat: true, netCouponQuantity: 1, noBump: true }); });
test('PLN net set price quantity five and bump', async ({ page }) => { await run(page, 'net-set-five', '4242424242424242', { setPrice: true, netVat: true, netCouponQuantity: 5 }); });

test('PLN net coupons through transfer placement and offline completion @J11', async ({ request }) => {
  const config = (await rows('bank_transfer_config', 'id', 'true'))[0];
  const productIds: string[] = [], transactionIds: string[] = [], couponIds: string[] = [];
  try {
    expect((await supabaseAdmin.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Local test shop', bank_account_number: 'PL61109010140000071219812874', bank_transfer_grant_access_on_placement: false }).eq('id', true)).error).toBeNull();
    const main = await insert('products', { slug: `net-transfer-${randomUUID()}`, name: 'Net workshop', price: 100, currency: 'PLN', is_active: true,
      vat_rate: 23, vat_exempt: false, price_includes_vat: false, checkout_profile: { v: 1, modules: [
        { id: 'buyer', types: ['person'], gus: false, bank_transfer_for: ['person'] }, { id: 'quantity', min: 1, max: 5, mode: 'checkout' },
      ] } });
    productIds.push(main.id);
    const bump = await insert('products', { slug: `net-bump-${randomUUID()}`, name: 'Bonus', price: 19, currency: 'PLN', is_active: true, vat_exempt: true });
    productIds.push(bump.id);
    await insert('order_bumps', { main_product_id: main.id, bump_product_id: bump.id, bump_title: 'Bonus', bump_price: 19, is_active: true });
    for (const discountType of ['set_price', 'fixed']) for (const quantity of [1, 5]) {
      const coupon = await insert('coupons', { code: `NET-${randomUUID()}`.toUpperCase(), discount_type: discountType,
        discount_value: discountType === 'set_price' ? 30 : 70 * quantity, currency: 'PLN', exclude_order_bumps: true });
      couponIds.push(coupon.id);
      const email = `net-${randomUUID()}@example.com`;
      const challengeResponse = await request.get('/api/captcha/challenge');
      expect(challengeResponse.ok()).toBe(true);
      const challenge = await challengeResponse.json();
      const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
      expect(solution).toBeTruthy();
      const captchaToken = Buffer.from(JSON.stringify({ ...challenge, number: solution!.number, took: solution!.took })).toString('base64');
      const response = await request.post('/api/orders/bank-transfer', { data: { productId: main.id, email,
        bumpProductIds: quantity === 5 ? [bump.id] : [], couponCode: coupon.code, captchaToken, termsAccepted: true,
        moduleValues: { quantity, buyer: { type: 'person', first_name: 'Jan', last_name: 'Nowak', email } },
      } });
      expect(response.status(), await response.text()).toBe(200);
      const order = await response.json(); transactionIds.push(order.orderId);
      const expected = quantity * 3690 + (quantity === 5 ? 1900 : 0);
      expect(order.amount).toBe(expected);
      expect(order.currency).toBe('PLN');
      const items = await rows('payment_line_items', 'transaction_id', order.orderId);
      expect(items.find(item => item.item_type === 'main_product')).toMatchObject({ quantity, discounted_total: quantity * 30, tax_amount: quantity * 690 });
      if (quantity === 5) expect(items.find(item => item.item_type === 'order_bump')).toMatchObject({ quantity: 1, discounted_total: 19, tax_amount: 0 });
      expect((await supabaseAdmin.rpc('complete_offline_order', { p_transaction_id: order.orderId, p_paid_minor: expected - 1 })).data).toMatchObject({ success: false });
      for (let i = 0; i < 2; i++) expect((await supabaseAdmin.rpc('complete_offline_order', { p_transaction_id: order.orderId, p_paid_minor: expected })).data).toMatchObject({ success: true });
      expect((await rows('payment_transactions', 'id', order.orderId))[0].status).toBe('completed');
      expect(await rows('coupon_redemptions', 'transaction_id', order.orderId)).toHaveLength(1);
    }
  } finally {
    await remove('guest_purchases', 'transaction_id', transactionIds);
    await remove('coupon_redemptions', 'coupon_id', couponIds);
    await remove('coupon_reservations', 'coupon_id', couponIds);
    await remove('payment_transactions', 'id', transactionIds);
    await remove('coupons', 'id', couponIds);
    await remove('order_bumps', 'main_product_id', productIds);
    await remove('products', 'id', productIds);
    expect((await supabaseAdmin.from('bank_transfer_config').update(config).eq('id', true)).error).toBeNull();
  }
});

test('PLN net fixed coupon entered before email with five units and bump', async ({ page }) => { await run(page, 'net-fixed-five', '4242424242424242', { fixedPrice: true, netVat: true, netCouponQuantity: 5 }); });

test('form coupon expires after reservation', async ({ page }) => { await run(page, 'coupon-expired', '4242424242424242', { coupon: true, expireCouponAfterReservation: true }); });

test('multiple license keys share the first purchase email and both revoke on refund @J01', async ({page})=>run(page,'multi-license','4242424242424242',{multipleLicenses:true}));
test('licensed subscription keeps its first purchase link @J05', async ({page})=>run(page,'licensed-subscription','4242424242424242',{subscription:true,licensedSubscription:true}));
