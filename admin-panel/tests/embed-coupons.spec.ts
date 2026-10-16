/**
 * Coupon codes in the embedded checkout, on a real cross-site seller page,
 * against Stripe TEST mode.
 *
 * Proves, through the real loader (/embed/v1/checkout.js) and the real
 * /api/embed/checkout-session route, that:
 *  - a valid coupon typed into the embed lowers the amount of the Stripe session,
 *  - a coupon prefilled with data-coupon is applied on the first request,
 *  - an invalid coupon is rejected with a clear message while a payable
 *    checkout (no coupon) stays mounted.
 *
 * Run: bunx playwright test tests/embed-coupons.spec.ts --project=chromium
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type Response } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
  throw new Error('Missing test env variables for embed coupon tests');
}
if (!/^(sk|rk)_test_/.test(STRIPE_SECRET_KEY)) {
  throw new Error('Embed coupon tests require a Stripe test-mode key');
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY);

const PRICE = 20; // USD
const DISCOUNT_PERCENT = 25;
const FULL_AMOUNT = 2000;
const DISCOUNTED_AMOUNT = 1500;

const marker = `embed-coupon-${randomUUID().slice(0, 8)}`;
const VALID_CODE = `EMBED${randomUUID().slice(0, 6).toUpperCase()}`;

let sellerPage: { origin: string; setHtml: (html: string) => void; close: () => Promise<void> };
let sellfOrigin: string;
let slug: string;
let sellerId: string;
let productId: string;
let couponId: string;
const stripeSessionIds: string[] = [];

function crossSiteHost(origin: string): string {
  return new URL(origin).hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1';
}

async function startSellerPage(host: string) {
  let html = '';
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://${host}:${port}`,
    setHtml: (next: string) => { html = next; },
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function embedHtml(extraAttrs = ''): string {
  return `<!doctype html><html><body>
  <div data-sellf-embed data-product-slug="${slug}" ${extraAttrs}></div>
  <script src="${sellfOrigin}/embed/v1/checkout.js"></script>
</body></html>`;
}

function isSessionPost(res: Response): boolean {
  return res.url().includes('/api/embed/checkout-session') && res.request().method() === 'POST';
}

function postedCoupon(res: Response): string | undefined {
  return res.request().postDataJSON()?.couponCode;
}

async function sessionAmount(res: Response): Promise<number> {
  const body = await res.json();
  expect(body.kind, JSON.stringify(body)).toBe('paid');
  stripeSessionIds.push(body.sessionId);
  const session = await stripe.checkout.sessions.retrieve(body.sessionId);
  return session.amount_total ?? -1;
}

async function applyCoupon(page: Page, code: string): Promise<Response> {
  await page.locator('.sellf-coupon input[name="coupon"]').fill(code);
  const [response] = await Promise.all([
    page.waitForResponse((res) => isSessionPost(res) && postedCoupon(res) === code),
    page.locator('.sellf-coupon button[type="submit"]').click(),
  ]);
  return response;
}

test.beforeAll(async ({ baseURL }) => {
  sellfOrigin = baseURL ?? 'http://localhost:3777';
  slug = `${marker}-paid`;
  sellerPage = await startSellerPage(crossSiteHost(sellfOrigin));

  const { data: seller, error: sellerError } = await admin.auth.admin.createUser({
    email: `${marker}-seller@example.com`,
    email_confirm: true,
  });
  expect(sellerError).toBeNull();
  sellerId = seller.user!.id;

  const { error: embedError } = await admin
    .from('seller_embed_settings')
    .upsert({ seller_id: sellerId, allowed_embed_origins: [sellerPage.origin] });
  expect(embedError).toBeNull();

  const { data: product, error: productError } = await admin
    .from('products')
    .insert({
      name: 'Embed coupon E2E',
      slug,
      price: PRICE,
      currency: 'USD',
      is_active: true,
      embed_enabled: true,
      seller_id: sellerId,
    })
    .select('id')
    .single();
  expect(productError).toBeNull();
  productId = product!.id;

  const { data: coupon, error: couponError } = await admin
    .from('coupons')
    .insert({
      code: VALID_CODE,
      name: 'Embed E2E coupon',
      discount_type: 'percentage',
      discount_value: DISCOUNT_PERCENT,
      is_active: true,
      allowed_product_ids: [],
    })
    .select('id')
    .single();
  expect(couponError).toBeNull();
  couponId = coupon!.id;
});

test.afterAll(async () => {
  for (const id of stripeSessionIds) {
    await stripe.checkout.sessions.expire(id).catch(() => undefined);
    await admin.from('payment_transactions').delete().eq('session_id', id).eq('status', 'pending');
  }
  await admin.from('coupon_reservations').delete().eq('coupon_id', couponId);
  await admin.from('coupon_redemptions').delete().eq('coupon_id', couponId);
  await admin.from('coupons').delete().eq('id', couponId);
  await admin.from('embed_checkout_log').delete().eq('product_slug', slug);
  await admin.from('products').delete().eq('id', productId);
  await admin.from('seller_embed_settings').delete().eq('seller_id', sellerId);
  await admin.auth.admin.deleteUser(sellerId);
  await sellerPage?.close();
});

test.beforeEach(async () => {
  await admin.from('application_rate_limits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await admin.from('rate_limits').delete().in('function_name', ['verify_coupon', 'global_verify_coupon']);
});

test.describe('Embedded checkout coupon', () => {
  test('a valid coupon typed into the embed lowers the Stripe session amount', async ({ page }) => {
    sellerPage.setHtml(embedHtml());

    const [first] = await Promise.all([
      page.waitForResponse(isSessionPost),
      page.goto(sellerPage.origin),
    ]);
    expect(postedCoupon(first)).toBeUndefined();
    expect(await sessionAmount(first)).toBe(FULL_AMOUNT);

    const applied = await applyCoupon(page, VALID_CODE);
    expect(applied.status()).toBe(200);
    expect(await sessionAmount(applied)).toBe(DISCOUNTED_AMOUNT);
    await expect(page.locator('.sellf-coupon [role="status"]')).toContainText(`Coupon ${VALID_CODE} applied`);
    await expect(page.locator('[data-sellf-coupon-error]')).toHaveCount(0);
  });

  test('data-coupon prefills the field and is applied on the first request', async ({ page }) => {
    sellerPage.setHtml(embedHtml(`data-coupon="${VALID_CODE}"`));

    const [first] = await Promise.all([
      page.waitForResponse(isSessionPost),
      page.goto(sellerPage.origin),
    ]);
    expect(postedCoupon(first)).toBe(VALID_CODE);
    expect(await sessionAmount(first)).toBe(DISCOUNTED_AMOUNT);
    await expect(page.locator('.sellf-coupon input[name="coupon"]')).toHaveValue(VALID_CODE);
  });

  test('an invalid coupon is rejected clearly and the payable checkout stays mounted', async ({ page }) => {
    sellerPage.setHtml(embedHtml());

    const [initial] = await Promise.all([page.waitForResponse(isSessionPost), page.goto(sellerPage.origin)]);
    expect(await sessionAmount(initial)).toBe(FULL_AMOUNT);
    await expect(page.locator('iframe').first()).toBeAttached();

    const sessionPosts: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/embed/checkout-session') && req.method() === 'POST') {
        sessionPosts.push(req.postData() ?? '');
      }
    });

    const rejected = await applyCoupon(page, 'NOT-A-REAL-CODE');
    expect(rejected.status()).toBe(400);

    const error = page.locator('[data-sellf-coupon-error]');
    await expect(error).toBeVisible();
    await expect(error).not.toHaveText('');
    await expect(page.locator('.sellf-coupon button[type="submit"]')).toBeEnabled();

    // Only the rejected attempt was sent, and the original checkout is still there.
    expect(sessionPosts).toHaveLength(1);
    await expect(page.locator('iframe').first()).toBeAttached();
    await expect(page.getByText('You cannot have multiple Embedded Checkout objects')).toHaveCount(0);

    // The buyer can still correct the code and get the discount.
    const applied = await applyCoupon(page, VALID_CODE);
    expect(await sessionAmount(applied)).toBe(DISCOUNTED_AMOUNT);
    await expect(error).toHaveCount(0);
  });
});
