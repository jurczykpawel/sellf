import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

/**
 * Full-discount (100%) Coupon E2E
 *
 * Regression guard for the "100% coupon feels like PWYW=0" unified flow.
 * Covers the three things that used to break:
 *   1. Logged-in user: clicking the free-access button grants access and
 *      records a row in coupon_redemptions (proves the coupon side-effects ran).
 *   2. Guest (?coupon=...): sees the email/magic-link form, never the generic
 *      "Payment Error" toast that used to come from create-payment-intent.
 *   3. Paid product without coupon: Stripe Elements still render normally.
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

let adminEmail: string;
let adminPassword: string;
let adminUserId: string;
let adminCleanup: () => Promise<void>;

let productId: string;
const productSlug = `coupon-100-${Date.now()}`;
let couponId: string;
const couponCode = `VIP100-${Date.now()}`;
let fixedProductId: string;
const fixedProductSlug = `coupon-fixed-full-${Date.now()}`;
let fixedCouponId: string;
const fixedCouponCode = `VIPFIXED-${Date.now()}`;

test.beforeAll(async () => {
  const admin = await createTestAdmin('coupon-100');
  adminEmail = admin.email;
  adminPassword = admin.password;
  adminCleanup = admin.cleanup;

  const { data: userRow } = await supabaseAdminClient
    .from('users' as never)
    .select('id' as never)
    .eq('email' as never, adminEmail)
    .single();
  // users view may not exist in every env; fall back to auth.users
  if (userRow?.id) {
    adminUserId = (userRow as { id: string }).id;
  } else {
    const { data: authList } = await supabaseAdminClient.auth.admin.listUsers();
    const match = authList?.users.find(u => u.email === adminEmail);
    adminUserId = match?.id ?? '';
  }

  const { data: product, error: productErr } = await supabaseAdminClient
    .from('products')
    .insert({
      name: 'Enterprise 100% Coupon Product',
      slug: productSlug,
      price: 99,
      currency: 'PLN',
      description: 'Paid product unlockable only via 100% coupon',
      is_active: true,
    })
    .select()
    .single();
  if (productErr) throw productErr;
  productId = product.id;

  const { data: coupon, error: couponErr } = await supabaseAdminClient
    .from('coupons')
    .insert({
      code: couponCode,
      name: '100% off — e2e',
      discount_type: 'percentage',
      discount_value: 100,
      is_active: true,
      usage_limit_global: 100,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select()
    .single();
  if (couponErr) throw couponErr;
  couponId = coupon.id;

  const { data: fixedProduct, error: fixedProductErr } = await supabaseAdminClient
    .from('products')
    .insert({
      name: 'Enterprise Fixed Full Coupon Product',
      slug: fixedProductSlug,
      price: 99,
      currency: 'PLN',
      description: 'Paid product unlockable via fixed full-discount coupon',
      is_active: true,
    })
    .select()
    .single();
  if (fixedProductErr) throw fixedProductErr;
  fixedProductId = fixedProduct.id;

  const { data: fixedCoupon, error: fixedCouponErr } = await supabaseAdminClient
    .from('coupons')
    .insert({
      code: fixedCouponCode,
      name: 'Fixed full off - e2e',
      discount_type: 'fixed',
      discount_value: 99,
      currency: 'PLN',
      is_active: true,
      usage_limit_global: 100,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      allowed_product_ids: [fixedProduct.id],
    })
    .select()
    .single();
  if (fixedCouponErr) throw fixedCouponErr;
  fixedCouponId = fixedCoupon.id;
});

test.afterAll(async () => {
  if (couponId) {
    await supabaseAdminClient.from('coupon_redemptions').delete().eq('coupon_id', couponId);
    await supabaseAdminClient.from('coupon_reservations').delete().eq('coupon_id', couponId);
    await supabaseAdminClient.from('coupons').delete().eq('id', couponId);
  }
  if (productId) {
    await supabaseAdminClient.from('user_product_access').delete().eq('product_id', productId);
    await supabaseAdminClient.from('products').delete().eq('id', productId);
  }
  if (fixedCouponId) {
    await supabaseAdminClient.from('coupon_redemptions').delete().eq('coupon_id', fixedCouponId);
    await supabaseAdminClient.from('coupon_reservations').delete().eq('coupon_id', fixedCouponId);
    await supabaseAdminClient.from('coupons').delete().eq('id', fixedCouponId);
  }
  if (fixedProductId) {
    await supabaseAdminClient.from('user_product_access').delete().eq('product_id', fixedProductId);
    await supabaseAdminClient.from('products').delete().eq('id', fixedProductId);
  }
  await adminCleanup();
});

test.describe('Full-discount coupon flow', () => {
  test('guest checkout with ?coupon=CODE shows the free-access form, not a payment error', async ({ page }) => {
    await page.goto(`/pl/checkout/${productSlug}?coupon=${couponCode}`);
    await page.waitForLoadState('domcontentloaded');

    // The green free-access card is the same UI PWYW=0 uses.
    const freeCard = page.locator('.bg-sf-success-soft').first();
    await expect(freeCard).toBeVisible({ timeout: 10_000 });

    // Email input must be present (guest magic-link path)
    const emailInput = freeCard.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();

    // Generic "Payment Error / Failed to load" toast must NOT appear — that
    // was the symptom of the bug this flow replaces.
    await expect(page.getByText(/Nie udało się załadować płatności|Failed to load checkout/i))
      .toHaveCount(0);
  });

  test('logged-in user: applying 100% coupon grants access + records redemption', async ({ page }) => {
    // Ensure no stale access from previous runs
    if (adminUserId) {
      await supabaseAdminClient
        .from('user_product_access')
        .delete()
        .eq('product_id', productId)
        .eq('user_id', adminUserId);
    }
    await supabaseAdminClient.from('coupon_redemptions').delete().eq('coupon_id', couponId);

    await loginAsAdmin(page, adminEmail, adminPassword);

    await page.goto(`/pl/checkout/${productSlug}?coupon=${couponCode}`);
    await page.waitForLoadState('domcontentloaded');

    const freeCard = page.locator('.bg-sf-success-soft').first();
    await expect(freeCard).toBeVisible({ timeout: 10_000 });

    // For logged-in users the PWYW-style "Odbierz" button is shown
    // (our coupon UI uses the "redeemCoupon" label).
    const redeemBtn = freeCard.locator('button').filter({ hasText: /Odbierz|Redeem/i });
    await expect(redeemBtn).toBeVisible();
    await redeemBtn.click();

    // Success card appears (hasAccess=true)
    await expect(page.getByText(/Dostęp przyznany|Access granted/i)).toBeVisible({ timeout: 10_000 });

    // Redemption row must exist — proves the side effects (insert + increment + reservation cleanup) ran
    const { data: redemptions } = await supabaseAdminClient
      .from('coupon_redemptions')
      .select('id, user_id, customer_email')
      .eq('coupon_id', couponId);
    expect(redemptions?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(redemptions?.[0].customer_email).toBe(adminEmail);
  });

  test('guest checkout with fixed full-discount coupon shows the free-access form, not a payment error', async ({ page }) => {
    await page.goto(`/pl/checkout/${fixedProductSlug}?coupon=${fixedCouponCode}`);
    await page.waitForLoadState('domcontentloaded');

    const freeCard = page.locator('.bg-sf-success-soft').first();
    await expect(freeCard).toBeVisible({ timeout: 10_000 });
    await expect(freeCard.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByText(/Payment Error|Błąd płatności|Please log in to use this coupon/i))
      .toHaveCount(0);
  });

  test('paid product without coupon still renders Stripe Elements (regression)', async ({ page }) => {
    // Remove access so the page renders the checkout, not the "already have access" card
    if (adminUserId) {
      await supabaseAdminClient
        .from('user_product_access')
        .delete()
        .eq('product_id', productId)
        .eq('user_id', adminUserId);
    }
    await loginAsAdmin(page, adminEmail, adminPassword);

    await page.goto(`/pl/checkout/${productSlug}`); // no ?coupon
    await page.waitForLoadState('domcontentloaded');

    // The first __privateStripeFrame is Stripe's controller iframe (body has display:none by design),
    // so we check attachment, not visibility — matches payment-method-config-checkout.spec.ts.
    await expect(page.locator('iframe[name^="__privateStripeFrame"]').first())
      .toBeAttached({ timeout: 15_000 });
  });
});
