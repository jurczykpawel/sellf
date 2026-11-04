/**
 * Two tabs, one cart, one single-use coupon (W148-8 / W148-9).
 *
 * Tab A pays with the coupon for real (Stripe test mode, completion through the
 * payment-status page). Tab B was loaded before that payment and still shows the
 * discounted price. Clicking Pay in tab B must not charge anything: the buyer sees
 * that the code is no longer available, the price is recalculated, and the amount
 * Stripe would charge equals the amount on the screen.
 */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin } from './helpers/admin-auth';
import { test } from './helpers/checkout-intent';
import { readCheckoutTerms, setCheckoutTerms, restoreCheckoutTerms } from './helpers/checkout-settings';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const run = randomUUID().slice(0, 8);
const email = `two-tabs-${run}@example.com`;
let product: { id: string; slug: string };
let coupon: { id: string; code: string };
let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let savedTerms: boolean | null = null;
const sessions = new Set<string>();

async function insert(table: string, value: object) {
  const { data, error } = await db.from(table).insert(value).select().single();
  expect(error).toBeNull();
  return data!;
}

/** Latest Checkout Session created by this tab, from the create-payment-intent response. */
function trackSessions(page: Page): string[] {
  const ids: string[] = [];
  page.on('response', async response => {
    if (!response.url().endsWith('/api/create-payment-intent') || !response.ok()) return;
    if (response.request().postDataJSON()?.expireOnly) return;
    const body = await response.json().catch(() => ({}));
    if (typeof body.checkoutSessionId === 'string') { ids.push(body.checkoutSessionId); sessions.add(body.checkoutSessionId); }
  });
  return ids;
}

async function openAndFill(page: Page) {
  await acceptAllCookies(page);
  await page.goto(`/en/checkout/${product.slug}?coupon=${coupon.code}`);
  await expect(page.getByTestId('order-summary-total')).toContainText('39.20', { timeout: 60000 });
  const card = page.frameLocator('iframe[src*="elements-inner-payment"]');
  await expect(card.locator('input[name=number]')).toBeVisible({ timeout: 90000 });
  await page.locator('input[type=email]').fill(email);
  const name = page.getByPlaceholder('Jan Kowalski');
  if (await name.count()) await name.fill('Two Tabs Buyer');
  await card.locator('input[name=number]').fill('4242424242424242');
  await card.locator('input[name=expiry]').fill('1234');
  await card.locator('input[name=cvc]').fill('123');
  const zip = card.locator('input[name=postalCode]');
  if (await zip.count()) await zip.fill('10001');
}

test.beforeAll(async () => {
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  expect(new URL(process.env.SUPABASE_URL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  savedTerms = await readCheckoutTerms();
  admin = await createTestAdmin('two-tabs-admin');
  product = await insert('products', {
    name: `Two tabs ${run}`, slug: `two-tabs-${run}`, price: 49, currency: 'USD',
    is_active: true, vat_exempt: true,
  });
  coupon = await insert('coupons', {
    code: `ONCE${run.toUpperCase()}`, name: 'Single use', discount_type: 'percentage', discount_value: 20,
    is_active: true, usage_limit_per_user: 1, allowed_product_ids: [product.id],
  });
});

test.afterAll(async ({ browser }) => {
  for (const id of sessions) {
    const row = await stripe.checkout.sessions.retrieve(id);
    if (row.status === 'open') await stripe.checkout.sessions.expire(id).catch(() => undefined);
  }
  if (product) {
    const tx = (await db.from('payment_transactions').select('id').eq('product_id', product.id)).data?.map(row => row.id) ?? [];
    if (coupon) {
      await db.from('coupon_redemptions').delete().eq('coupon_id', coupon.id);
      await db.from('coupon_reservations').delete().eq('coupon_id', coupon.id);
    }
    if (tx.length) await db.from('payment_line_items').delete().in('transaction_id', tx);
    await db.from('guest_purchases').delete().eq('product_id', product.id);
    await db.from('user_product_access').delete().eq('product_id', product.id);
    await db.from('payment_transactions').delete().eq('product_id', product.id);
    if (coupon) await db.from('coupons').delete().eq('id', coupon.id);
    await db.from('products').delete().eq('id', product.id);
  }
  const users = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.filter(user => user.email === email);
  for (const user of users) await db.auth.admin.deleteUser(user.id);
  try { if (admin) await restoreCheckoutTerms(browser, admin, savedTerms); }
  finally { await admin?.cleanup(); }
});

for (const locale of ['en'] as const) {
  test(`${locale}: second tab never pays a coupon price used up in the first tab @J310`, async ({ context, page }) => {
    test.setTimeout(300000);
    await setCheckoutTerms(page, admin, false);
    const tabA = page;
    const tabB = await context.newPage();
    const sessionsA = trackSessions(tabA);
    const sessionsB = trackSessions(tabB);
    const metadataB: Array<{ status: number; body: Record<string, unknown> }> = [];
    tabB.on('response', async response => {
      if (response.url().endsWith('/api/update-payment-metadata')) {
        metadataB.push({ status: response.status(), body: await response.json().catch(() => ({})) });
      }
    });

    await openAndFill(tabA);
    await openAndFill(tabB);
    const discountedB = sessionsB.at(-1)!;
    expect((await stripe.checkout.sessions.retrieve(discountedB)).amount_total).toBe(3920);

    // Tab A pays with the coupon; the payment-status page completes the order.
    await tabA.bringToFront();
    await tabA.locator('button[type=submit]').click();
    await tabA.waitForURL(/payment-status/, { timeout: 90000 });
    await expect.poll(async () => (await db.from('payment_transactions').select('coupon_id, status')
      .eq('product_id', product.id).eq('status', 'completed')).data ?? [], { timeout: 60000 })
      .toEqual([{ coupon_id: coupon.id, status: 'completed' }]);
    expect(sessionsA.length).toBeGreaterThan(0);

    // Tab B still shows the old discounted price; Pay must stop with a coupon-specific message.
    await tabB.bringToFront();
    await expect(tabB.getByTestId('order-summary-total')).toContainText('39.20');
    await tabB.locator('button[type=submit]').click();
    await expect.poll(() => metadataB.map(r => r.status)).toContain(409);
    expect(metadataB.find(r => r.status === 409)!.body).toMatchObject({ code: 'coupon_unavailable' });
    await expect(tabB.getByRole('alert').filter({ hasText: /no longer available/i }).first()).toBeVisible({ timeout: 30000 });
    await expect(tabB.getByText('Could not save your details')).toHaveCount(0);

    // The price is recalculated before any payment: screen and Stripe agree on 49.00.
    await expect(tabB.getByTestId('order-summary-total')).toContainText('49.00', { timeout: 60000 });
    await expect.poll(() => sessionsB.length, { timeout: 60000 }).toBeGreaterThan(1);
    const repriced = sessionsB.at(-1)!;
    expect((await stripe.checkout.sessions.retrieve(repriced)).amount_total).toBe(4900);
    expect((await stripe.checkout.sessions.retrieve(discountedB)).status).not.toBe('complete');
    const completed = (await db.from('payment_transactions').select('id').eq('product_id', product.id).eq('status', 'completed')).data ?? [];
    expect(completed).toHaveLength(1);
  });
}
