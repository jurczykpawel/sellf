/** Real Stripe test-mode checkout, fulfillment, and delivery checks. @see README.md */
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { PREDEFINED_CUSTOM_FIELDS } from '@/lib/validations/custom-checkout-fields';
import type { Page } from '@playwright/test';
import { supabaseAdmin, createTestUser, setAuthSession } from '../helpers/admin-auth';
import { acceptAllCookies } from '../helpers/consent';
import { deleteAuthUserByEmail } from '../helpers/db-cleanup';

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
  if (loggedIn || s.subscription) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({ email: s.email, password, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message ?? 'Buyer creation failed');
    s.buyerId = data.user.id;
  }
  const main = await insert('products', {
    slug: s.slug, name: `Stripe live ${s.slug}`, price: 10, currency: 'USD', is_active: true,
    seller_id: seller.userId, vat_exempt: true,
    ...(s.subscription ? {
      product_type: 'subscription', recurring_price: 10, billing_interval: 'month', billing_interval_count: 1,
    } : {
      issue_license_on_purchase: true, license_tier: 'pro',
      custom_checkout_fields: [{ ...PREDEFINED_CUSTOM_FIELDS.license_domain, required: true, claim: undefined }],
    }),
  });
  s.productIds.push(main.id);
  if (!s.subscription) {
    const bump = await insert('products', { slug: `${s.slug}-bump`, name: 'Live test bonus', price: 2, currency: 'USD', is_active: true, vat_exempt: true, seller_id: seller.userId });
    s.productIds.push(bump.id);
    await insert('order_bumps', { main_product_id: main.id, bump_product_id: bump.id, bump_title: 'Live test bonus', bump_price: 2, is_active: true });
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
  for (const sub of subs) await stripe.subscriptions.cancel(sub.stripe_subscription_id);
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
  const products = s.productIds.length ? await supabaseAdmin.from('products').select('stripe_product_id,stripe_price_id').in('id', s.productIds) : { data: [] };
  for (const product of products.data ?? []) {
    if (product.stripe_price_id) await stripe.prices.update(product.stripe_price_id, { active: false });
    if (product.stripe_product_id) await stripe.products.update(product.stripe_product_id, { active: false });
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
  for (const type of ['checkout.session.completed', 'payment_intent.succeeded']) {
    const events = await stripe.events.list({ type, limit: 100 });
    const event = events.data.find(e => e.data.object.id === (type.startsWith('checkout') ? sessionId : pi));
    if (event) eventIds.push({ type, id: event.id });
  }
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

async function run(page: Page, label: string, card: string, options: { loggedIn?: boolean; subscription?: boolean; challenge?: boolean; declined?: boolean } = {}): Promise<void> {
  const slug = `stripe-live-${label}-${randomUUID().slice(0, 8)}`;
  const s: Scenario = { slug, productIds: [], email: `${slug}@example.com`, domain: `${slug}.example.com`, sessionIds: [], subscription: !!options.subscription };
  let passed = false;
  let order = 'not observed';
  try {
    await setup(s, !!options.loggedIn);
    await acceptAllCookies(page);
    if (s.buyerId) await setAuthSession(page, s.email, password);
    page.on('response', async response => {
      if (response.url().includes('/api/create-payment-intent') && response.ok()) {
        const body = await response.json();
        if (body.checkoutSessionId && !s.sessionIds.includes(body.checkoutSessionId)) s.sessionIds.push(body.checkoutSessionId);
      }
    });
    let failedPageShown = false;
    await page.exposeFunction('recordPaymentFailure', () => { failedPageShown = true; });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.body?.innerText.includes('Payment Failed')) (window as unknown as { recordPaymentFailure: () => void }).recordPaymentFailure();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(`/en/checkout/${slug}?email=${encodeURIComponent(s.email)}`);
    if (!s.subscription) await page.getByRole('button', { name: /Add to order/i }).click();
    await expect(page.locator('#checkoutEmail')).toBeVisible({ timeout: 90000 });
    await page.locator('#checkoutEmail').fill(s.email);
    await page.locator('#fullName').fill('Stripe Test Buyer');
    if (!s.subscription) await page.getByLabel(/License domain/).fill(s.domain);
    const terms = page.locator('input[type="checkbox"]');
    for (const checkbox of await terms.all()) if (await checkbox.isVisible()) await checkbox.check();
    await fillCard(page, card);
    await page.locator('button[type="submit"]').click();
    if (options.challenge) {
      const challenge = page.frameLocator('iframe[name^="__privateStripeFrame"]').frameLocator('iframe#challengeFrame');
      await challenge.getByRole('button', { name: /Complete/ }).click({ timeout: 60000 });
    }
    if (options.declined) {
      await expect(page.getByText(/Your card was declined/i)).toBeVisible({ timeout: 60000 });
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
      expect(txs).toHaveLength(1);
      const tx = txs[0];
      expect(tx.status).toBe('completed');
      expect(tx.customer_email).toBe(s.email);
      if (s.buyerId) expect(tx.user_id).toBe(s.buyerId);
      expect(tx.stripe_payment_intent_id).toMatch(/^pi_/);
      if (!s.subscription) {
        expect(tx.session_id).toBe(sessionId);
        expect(tx.custom_field_values._sellf_license_domain).toBe(s.domain);
        const items = await rows('payment_line_items', 'transaction_id', tx.id);
        expect(items).toHaveLength(2);
        expect(new Set(items.map(row => row.product_id))).toEqual(new Set(s.productIds));
        const licenses = await rows('issued_licenses', 'product_id', s.productIds[0]);
        expect(licenses).toHaveLength(1);
        expect(licenses[0].license_domain).toBe(s.domain);
        expect(deliveries(s)[0].body.data.licenses?.[0].token).toBe(licenses[0].license_key);
      }
      if (s.buyerId) {
        for (const id of s.productIds) expect((await rows('user_product_access', 'product_id', id)).some(row => row.user_id === s.buyerId)).toBe(true);
      } else {
        for (const id of s.productIds) expect((await rows('guest_purchases', 'product_id', id)).some(row => row.customer_email === s.email)).toBe(true);
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
    }
    passed = true;
  } finally {
    if (s.productIds.length) {
      const transactions = await rows('payment_transactions', 'product_id', s.productIds[0]);
      writeFileSync(`${artifacts}/${slug}.json`, JSON.stringify({
        scenario: s, transactions,
        licenses: await rows('issued_licenses', 'product_id', s.productIds[0]),
        lineItems: transactions.length ? await rows('payment_line_items', 'transaction_id', transactions[0].id) : [],
        deliveries: deliveries(s),
      }, null, 2), { mode: 0o600 });
    }
    appendFileSync(`${artifacts}/summary.jsonl`, JSON.stringify({ scenario: label, pass: passed, order }) + '\n');
    await cleanup(s);
  }
}

test('guest license and bump', async ({ page }) => { await run(page, 'guest', '4242424242424242'); });
test('signed-in license and bump', async ({ page }) => { await run(page, 'signed-in', '4242424242424242', { loggedIn: true }); });
test('3D Secure license and bump', async ({ page }) => { await run(page, '3ds', '4000002500003155', { challenge: true }); });
test('declined card', async ({ page }) => { await run(page, 'declined', '4000000000000002', { declined: true }); });
test('subscription initial purchase', async ({ page }) => { await run(page, 'subscription', '4242424242424242', { subscription: true }); });
for (let i = 1; i <= 5; i++) test(`guest repeated purchase ${i}/5`, async ({ page }) => { await run(page, 'repeat', '4242424242424242'); });
