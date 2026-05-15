import { test, expect, Page } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';

/**
 * Payment Status Redirect E2E Tests
 *
 * Strategy: Insert mock payment data directly into database.
 * Creates own test data - independent from seed.sql
 */

// For browser-side login
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Will be set in beforeAll
let TEST_USER: { id: string; email: string; password: string };
let PRODUCTS: {
  otoActive: string;
  productRedirect: string;
  customRedirect: string;
  otoOwned: string;
  noRedirect: string;
  otoTarget: string;
};
let PRODUCT_IDS: Record<string, string> = {};
let OTO_OFFER_IDS: string[] = [];

const GUEST_EMAIL = `guest-test-${Date.now()}@example.com`;

async function loginAsTestUser(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await setAuthSession(page, TEST_USER.email, TEST_USER.password);

  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function getProductBySlug(slug: string) {
  const { data } = await supabaseAdmin
    .from('products')
    .select('id, name, slug')
    .eq('slug', slug)
    .single();
  return data;
}

async function createMockPayment(params: {
  sessionId: string;
  productSlug: string;
  email: string;
  userId?: string;
  amount?: number;
}) {
  const product = await getProductBySlug(params.productSlug);
  if (!product) throw new Error(`Product not found: ${params.productSlug}`);

  const { data: transaction, error: txError } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      session_id: params.sessionId,
      product_id: product.id,
      customer_email: params.email,
      user_id: params.userId || null,
      amount: (params.amount || 1999) / 100,
      currency: 'usd',
      status: 'completed',
      stripe_payment_intent_id: `pi_test_${params.sessionId}`,
    })
    .select()
    .single();

  if (txError) throw txError;

  if (params.userId) {
    await supabaseAdmin
      .from('user_product_access')
      .upsert({
        user_id: params.userId,
        product_id: product.id,
        access_granted_at: new Date().toISOString(),
      }, { onConflict: 'user_id,product_id' });
  }

  return transaction;
}

async function cleanupMockPayment(sessionId: string) {
  await supabaseAdmin
    .from('payment_transactions')
    .delete()
    .eq('session_id', sessionId);
}

function generateSessionId(prefix: string): string {
  return `cs_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Global setup - create test data
test.beforeAll(async () => {
  const suffix = Date.now().toString();

  // Create test user
  const email = `redirect-test-${suffix}@test.local`;
  const password = 'TestPassword123!';
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (userErr) throw userErr;
  TEST_USER = { id: user!.id, email, password };

  // Create OTO target product first (needed by other products)
  const { data: otoTarget } = await supabaseAdmin.from('products').insert({
    name: `OTO Target ${suffix}`, slug: `test-oto-target-${suffix}`,
    price: 9.99, currency: 'USD', is_active: true,
  }).select().single();

  // Create test-oto-active (has OTO offer)
  const { data: otoActive } = await supabaseAdmin.from('products').insert({
    name: `OTO Active ${suffix}`, slug: `test-oto-active-${suffix}`,
    price: 19.99, currency: 'USD', is_active: true,
  }).select().single();

  // Create test-product-redirect (internal redirect)
  const { data: productRedirect } = await supabaseAdmin.from('products').insert({
    name: `Product Redirect ${suffix}`, slug: `test-product-redirect-${suffix}`,
    price: 29.99, currency: 'USD', is_active: true,
    success_redirect_url: `/p/test-oto-target-${suffix}`, pass_params_to_redirect: true,
  }).select().single();

  // Create test-custom-redirect (external URL)
  const { data: customRedirect } = await supabaseAdmin.from('products').insert({
    name: `Custom Redirect ${suffix}`, slug: `test-custom-redirect-${suffix}`,
    price: 39.99, currency: 'USD', is_active: true,
    success_redirect_url: 'https://google.com', pass_params_to_redirect: true,
  }).select().single();

  // Create test-oto-owned (OTO but user owns target)
  const { data: otoOwned } = await supabaseAdmin.from('products').insert({
    name: `OTO Owned ${suffix}`, slug: `test-oto-owned-${suffix}`,
    price: 24.99, currency: 'USD', is_active: true,
  }).select().single();

  // Create test-no-redirect (plain product)
  const { data: noRedirect } = await supabaseAdmin.from('products').insert({
    name: `No Redirect ${suffix}`, slug: `test-no-redirect-${suffix}`,
    price: 14.99, currency: 'USD', is_active: true,
  }).select().single();

  PRODUCTS = {
    otoActive: otoActive!.slug,
    productRedirect: productRedirect!.slug,
    customRedirect: customRedirect!.slug,
    otoOwned: otoOwned!.slug,
    noRedirect: noRedirect!.slug,
    otoTarget: otoTarget!.slug,
  };

  PRODUCT_IDS = {
    [otoActive!.slug]: otoActive!.id,
    [productRedirect!.slug]: productRedirect!.id,
    [customRedirect!.slug]: customRedirect!.id,
    [otoOwned!.slug]: otoOwned!.id,
    [noRedirect!.slug]: noRedirect!.id,
    [otoTarget!.slug]: otoTarget!.id,
  };

  // Create OTO offers
  const { data: oto1 } = await supabaseAdmin.from('oto_offers').insert({
    source_product_id: otoActive!.id, oto_product_id: otoTarget!.id,
    discount_type: 'percentage', discount_value: 20, duration_minutes: 15, is_active: true,
  }).select().single();
  const { data: oto2 } = await supabaseAdmin.from('oto_offers').insert({
    source_product_id: otoOwned!.id, oto_product_id: otoTarget!.id,
    discount_type: 'percentage', discount_value: 25, duration_minutes: 20, is_active: true,
  }).select().single();
  OTO_OFFER_IDS = [oto1!.id, oto2!.id];

  // Give TEST_USER access to otoTarget (for test-oto-owned scenario)
  await supabaseAdmin.from('user_product_access').insert({
    user_id: TEST_USER.id, product_id: otoTarget!.id,
    access_granted_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  console.log('Created test user:', TEST_USER.email);
  console.log('Created test products:', Object.values(PRODUCTS));
});

// Global teardown - cleanup test data
test.afterAll(async () => {
  console.log('Cleaning up test data...');

  if (TEST_USER?.id) {
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', TEST_USER.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('user_id', TEST_USER.id);
  }

  for (const otoId of OTO_OFFER_IDS) {
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoId);
  }

  for (const productId of Object.values(PRODUCT_IDS)) {
    await supabaseAdmin.from('guest_purchases').delete().eq('product_id', productId);
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
    await supabaseAdmin.from('products').delete().eq('id', productId);
  }

  if (TEST_USER?.id) {
    await supabaseAdmin.from('profiles').delete().eq('id', TEST_USER.id);
    await supabaseAdmin.auth.admin.deleteUser(TEST_USER.id);
  }
});

test.describe('Payment Status Redirect - Logged-in User', () => {
  // Run tests serially because they share TEST_USER's product access data
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('test-oto-active: should redirect to OTO checkout after purchase', async ({ page }) => {
    const sessionId = generateSessionId('oto_active');
    const otoTarget = await getProductBySlug(PRODUCTS.otoTarget);

    // Remove access to OTO target so OTO will be shown
    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', TEST_USER.id)
      .eq('product_id', otoTarget!.id);

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.otoActive,
        email: TEST_USER.email,
        userId: TEST_USER.id,
      });

      await page.goto(`/p/${PRODUCTS.otoActive}/payment-status?session_id=${sessionId}`);

      // payment-status now server-redirects straight to /checkout/<otoSlug>
      // with the OTO coupon pre-applied — the interstitial offer card was
      // removed in the funnel-downsell-and-attribution migration.
      await page.waitForURL(new RegExp(`/checkout/${PRODUCTS.otoTarget}`), { timeout: 15000 });
      await expect(page.getByTestId('oto-countdown-banner')).toBeVisible({ timeout: 15000 });
    } finally {
      // Restore access
      await supabaseAdmin
        .from('user_product_access')
        .upsert({
          user_id: TEST_USER.id,
          product_id: otoTarget!.id,
          access_granted_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'user_id,product_id' });
      await cleanupMockPayment(sessionId);
    }
  });

  test('test-product-redirect: should redirect to internal product', async ({ page }) => {
    const sessionId = generateSessionId('product_redirect');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.productRedirect,
        email: TEST_USER.email,
        userId: TEST_USER.id,
      });

      await page.goto(`/p/${PRODUCTS.productRedirect}/payment-status?session_id=${sessionId}`);

      // Should redirect to otoTarget product (configured in setup)
      await page.waitForURL(new RegExp(`/p/${PRODUCTS.otoTarget}`), { timeout: 15000 });
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });

  test('test-custom-redirect: should redirect to external URL', async ({ page }) => {
    const sessionId = generateSessionId('custom_redirect');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.customRedirect,
        email: TEST_USER.email,
        userId: TEST_USER.id,
      });

      let redirectUrl: string | null = null;
      await page.route('https://google.com/**', async (route) => {
        redirectUrl = route.request().url();
        await route.abort();
      });

      await page.goto(`/p/${PRODUCTS.customRedirect}/payment-status?session_id=${sessionId}`);

      // Wait for external redirect attempt
      await page.waitForTimeout(8000);
      expect(redirectUrl).toContain('google.com');
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });

  test('test-oto-owned: should skip OTO (user owns OTO product)', async ({ page }) => {
    const sessionId = generateSessionId('oto_owned');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.otoOwned,
        email: TEST_USER.email,
        userId: TEST_USER.id,
      });

      await page.goto(`/p/${PRODUCTS.otoOwned}/payment-status?session_id=${sessionId}`);

      // Wait for any client-side navigation to settle
      await page.waitForTimeout(3000);

      // payment-status must NOT redirect to /checkout/<otoTarget> when the
      // buyer already owns the upsell product. URL stays on payment-status
      // (or follows success_redirect_url, but never the OTO checkout).
      expect(page.url()).not.toMatch(new RegExp(`/checkout/${PRODUCTS.otoTarget}`));
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });

  test('test-no-redirect: should redirect to product page', async ({ page }) => {
    const sessionId = generateSessionId('no_redirect');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.noRedirect,
        email: TEST_USER.email,
        userId: TEST_USER.id,
      });

      await page.goto(`/p/${PRODUCTS.noRedirect}/payment-status?session_id=${sessionId}`);

      // Should eventually land on product page (payment-status → product page)
      await page.waitForURL(new RegExp(`/p/${PRODUCTS.noRedirect}($|[?#])`), { timeout: 15000 });
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });
});

test.describe('Payment Status Redirect - Guest User', () => {
  test('test-oto-active (guest): should redirect to OTO checkout', async ({ page }) => {
    const sessionId = generateSessionId('guest_oto');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.otoActive,
        email: GUEST_EMAIL,
      });

      await page.goto(`/p/${PRODUCTS.otoActive}/payment-status?session_id=${sessionId}`);

      // payment-status redirects guests too — buyer lands on /checkout/<otoSlug>
      // with the OTO coupon pre-applied; interstitial offer card no longer renders.
      await page.waitForURL(new RegExp(`/checkout/${PRODUCTS.otoTarget}`), { timeout: 15000 });
      await expect(page.getByTestId('oto-countdown-banner')).toBeVisible({ timeout: 15000 });
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });

  test('test-no-redirect (guest): should show success page', async ({ page }) => {
    const sessionId = generateSessionId('guest_no_redirect');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.noRedirect,
        email: GUEST_EMAIL,
      });

      await page.goto(`/p/${PRODUCTS.noRedirect}/payment-status?session_id=${sessionId}`);

      // Should show success or magic link section
      await expect(page.getByRole('heading', { name: /Payment|Successful|Magic Link/i })).toBeVisible({ timeout: 15000 });
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });
});

test.describe('Payment Status - Edge Cases', () => {
  test('should handle invalid session_id gracefully', async ({ page }) => {
    await page.goto(`/p/${PRODUCTS.noRedirect}/payment-status?session_id=cs_invalid_123`);
    await expect(page.getByRole('heading', { name: /Failed|Error/i })).toBeVisible({ timeout: 15000 });
  });
});
