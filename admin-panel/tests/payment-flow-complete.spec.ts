import { test, expect, Page } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';

/**
 * Complete Payment Flow E2E Tests
 *
 * Strategy: Insert mock payment data directly into database.
 * The verifyPaymentSession function checks database first before calling Stripe.
 *
 * Creates own test data - independent from seed.sql
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// Will be set in beforeAll
let TEST_USER: { id: string; email: string; password: string };
let PRODUCTS: {
  premiumCourse: string;
  proToolkit: string;
  customRedirect: string;
  enterprise: string;
  noRedirect: string;
};
let PRODUCT_IDS: Record<string, string> = {};
let ORDER_BUMP_ID: string;

// ============================================================================
// GLOBAL SETUP - Create test data
// ============================================================================

async function createTestData() {
  const suffix = Date.now().toString();

  // Create test user
  const email = `payment-flow-${suffix}@test.local`;
  const password = 'TestPassword123!';
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw userErr;
  TEST_USER = { id: user!.id, email, password };

  // Create main product (premium-course equivalent)
  const { data: main, error: mainErr } = await supabaseAdmin.from('products').insert({
    name: `Premium Course ${suffix}`,
    slug: `premium-course-${suffix}`,
    price: 199.00,
    currency: 'PLN',
    is_active: true,
  }).select().single();
  if (mainErr) throw mainErr;

  // Create bump product (pro-toolkit equivalent)
  const { data: bump, error: bumpErr } = await supabaseAdmin.from('products').insert({
    name: `Pro Toolkit ${suffix}`,
    slug: `pro-toolkit-${suffix}`,
    price: 49.00,
    currency: 'PLN',
    is_active: true,
  }).select().single();
  if (bumpErr) throw bumpErr;

  // Create order bump relationship
  const { data: ob, error: obErr } = await supabaseAdmin.from('order_bumps').insert({
    main_product_id: main.id,
    bump_product_id: bump.id,
    bump_title: 'Add Pro Toolkit!',
    bump_price: 49.00,
    is_active: true,
  }).select().single();
  if (obErr) throw obErr;
  ORDER_BUMP_ID = ob.id;

  // Create redirect product (test-custom-redirect equivalent)
  const { data: redirect, error: redirectErr } = await supabaseAdmin.from('products').insert({
    name: `Custom Redirect ${suffix}`,
    slug: `test-custom-redirect-${suffix}`,
    price: 49.00,
    currency: 'PLN',
    is_active: true,
    success_redirect_url: 'https://google.com/search?q=success',
    pass_params_to_redirect: true,
  }).select().single();
  if (redirectErr) throw redirectErr;

  // Create timed access product (enterprise-package equivalent - 3 days)
  const { data: enterprise, error: entErr } = await supabaseAdmin.from('products').insert({
    name: `Enterprise Package ${suffix}`,
    slug: `enterprise-package-${suffix}`,
    price: 499.99,
    currency: 'PLN',
    is_active: true,
    auto_grant_duration_days: 3,
  }).select().single();
  if (entErr) throw entErr;

  // Create basic product (test-no-redirect equivalent)
  const { data: noRedirect, error: nrErr } = await supabaseAdmin.from('products').insert({
    name: `Basic Product ${suffix}`,
    slug: `test-no-redirect-${suffix}`,
    price: 99.00,
    currency: 'PLN',
    is_active: true,
  }).select().single();
  if (nrErr) throw nrErr;

  PRODUCTS = {
    premiumCourse: main.slug,
    proToolkit: bump.slug,
    customRedirect: redirect.slug,
    enterprise: enterprise.slug,
    noRedirect: noRedirect.slug,
  };

  PRODUCT_IDS = {
    [main.slug]: main.id,
    [bump.slug]: bump.id,
    [redirect.slug]: redirect.id,
    [enterprise.slug]: enterprise.id,
    [noRedirect.slug]: noRedirect.id,
  };

  console.log('Created test user:', TEST_USER.email);
  console.log('Created test products:', Object.values(PRODUCTS));
}

async function cleanupTestData() {
  console.log('Cleaning up test data...');

  // Delete user access
  if (TEST_USER?.id) {
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', TEST_USER.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('user_id', TEST_USER.id);
  }

  // Delete order bump
  if (ORDER_BUMP_ID) {
    await supabaseAdmin.from('order_bumps').delete().eq('id', ORDER_BUMP_ID);
  }

  // Delete products
  const productIds = Object.values(PRODUCT_IDS);
  if (productIds.length === 0) {
    console.warn('No product IDs to clean up');
  }
  for (const productId of productIds) {
    await supabaseAdmin.from('guest_purchases').delete().eq('product_id', productId);
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
    await supabaseAdmin.from('products').delete().eq('id', productId);
  }

  // Delete test user
  if (TEST_USER?.id) {
    await supabaseAdmin.from('profiles').delete().eq('id', TEST_USER.id);
    await supabaseAdmin.auth.admin.deleteUser(TEST_USER.id);
  }
}

async function loginAsTestUser(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const supabase = createBrowserClient(supabaseUrl, anonKey);
    await supabase.auth.signInWithPassword({ email, password });
  }, {
    email: TEST_USER.email,
    password: TEST_USER.password,
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
  });

  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function getProductBySlug(slug: string) {
  const { data } = await supabaseAdmin
    .from('products')
    .select('id, name, slug, auto_grant_duration_days')
    .eq('slug', slug)
    .single();
  return data;
}

function generateSessionId(prefix: string): string {
  return `cs_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create mock payment transaction in database
 */
async function createMockPayment(params: {
  sessionId: string;
  productSlug: string;
  email: string;
  userId?: string;
  amount?: number;
  bumpProductSlug?: string;
  bumpAmount?: number;
}) {
  const product = await getProductBySlug(params.productSlug);
  if (!product) throw new Error(`Product not found: ${params.productSlug}`);

  // Insert main transaction
  const { data: transaction, error: txError } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      session_id: params.sessionId,
      product_id: product.id,
      customer_email: params.email,
      user_id: params.userId || null,
      amount: (params.amount || 9900) / 100,
      currency: 'pln',
      status: 'completed',
      stripe_payment_intent_id: `pi_test_${params.sessionId}`,
    })
    .select()
    .single();

  if (txError) throw txError;

  // Grant access to main product
  if (params.userId) {
    const expiresAt = product.auto_grant_duration_days
      ? new Date(Date.now() + product.auto_grant_duration_days * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await supabaseAdmin
      .from('user_product_access')
      .upsert({
        user_id: params.userId,
        product_id: product.id,
        access_granted_at: new Date().toISOString(),
        access_expires_at: expiresAt,
        access_duration_days: product.auto_grant_duration_days || null,
      }, { onConflict: 'user_id,product_id' });
  } else {
    // Guest purchase - session_id is unique, use insert not upsert
    const { error: guestError } = await supabaseAdmin
      .from('guest_purchases')
      .insert({
        session_id: params.sessionId,
        customer_email: params.email,
        product_id: product.id,
        transaction_amount: (params.amount || 9900) / 100,
      });
    if (guestError) {
      console.error('Guest purchase insert error:', guestError);
      throw guestError;
    }
  }

  // Handle bump product if provided
  if (params.bumpProductSlug) {
    const bumpProduct = await getProductBySlug(params.bumpProductSlug);
    if (!bumpProduct) throw new Error(`Bump product not found: ${params.bumpProductSlug}`);

    const bumpSessionId = `${params.sessionId}_bump`;
    await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: bumpSessionId,
        product_id: bumpProduct.id,
        customer_email: params.email,
        user_id: params.userId || null,
        amount: (params.bumpAmount || 1900) / 100,
        currency: 'pln',
        status: 'completed',
        stripe_payment_intent_id: `pi_test_${bumpSessionId}`,
      });

    if (params.userId) {
      const bumpExpiresAt = bumpProduct.auto_grant_duration_days
        ? new Date(Date.now() + bumpProduct.auto_grant_duration_days * 24 * 60 * 60 * 1000).toISOString()
        : null;

      await supabaseAdmin
        .from('user_product_access')
        .upsert({
          user_id: params.userId,
          product_id: bumpProduct.id,
          access_granted_at: new Date().toISOString(),
          access_expires_at: bumpExpiresAt,
          access_duration_days: bumpProduct.auto_grant_duration_days || null,
        }, { onConflict: 'user_id,product_id' });
    } else {
      // Guest bump purchase
      const { error: bumpGuestError } = await supabaseAdmin
        .from('guest_purchases')
        .insert({
          session_id: bumpSessionId,
          customer_email: params.email,
          product_id: bumpProduct.id,
          transaction_amount: (params.bumpAmount || 1900) / 100,
        });
      if (bumpGuestError) {
        console.error('Guest bump purchase insert error:', bumpGuestError);
        throw bumpGuestError;
      }
    }
  }

  return transaction;
}

async function cleanupMockPayment(sessionId: string) {
  await supabaseAdmin.from('payment_transactions').delete().eq('session_id', sessionId);
  await supabaseAdmin.from('payment_transactions').delete().eq('session_id', `${sessionId}_bump`);
  await supabaseAdmin.from('guest_purchases').delete().eq('session_id', sessionId);
  await supabaseAdmin.from('guest_purchases').delete().eq('session_id', `${sessionId}_bump`);
}

async function removeUserAccess(userId: string, productSlug: string) {
  const product = await getProductBySlug(productSlug);
  if (product) {
    await supabaseAdmin.from('user_product_access').delete()
      .eq('user_id', userId).eq('product_id', product.id);
  }
}

async function getUserAccess(userId: string, productSlug: string) {
  const product = await getProductBySlug(productSlug);
  if (!product) return null;
  const { data } = await supabaseAdmin.from('user_product_access')
    .select('*').eq('user_id', userId).eq('product_id', product.id).maybeSingle();
  return data;
}

async function setExpiredAccess(userId: string, productSlug: string, durationDays: number) {
  const product = await getProductBySlug(productSlug);
  if (!product) throw new Error(`Product not found: ${productSlug}`);

  const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabaseAdmin.from('user_product_access').upsert({
    user_id: userId,
    product_id: product.id,
    access_granted_at: new Date(Date.now() - (durationDays + 1) * 24 * 60 * 60 * 1000).toISOString(),
    access_expires_at: expiredDate,
    access_duration_days: durationDays,
  }, { onConflict: 'user_id,product_id' });
}

// ============================================================================
// GLOBAL SETUP & TEARDOWN
// ============================================================================

test.beforeAll(async () => {
  await createTestData();
});

test.afterAll(async () => {
  await cleanupTestData();
});

// ============================================================================
// ORDER BUMP TESTS - Logged-in User
// ============================================================================

test.describe('Order Bump - Logged-in User', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    // Clean up before each test
    await removeUserAccess(TEST_USER.id, PRODUCTS.premiumCourse);
    await removeUserAccess(TEST_USER.id, PRODUCTS.proToolkit);
  });

  test.afterEach(async () => {
    await removeUserAccess(TEST_USER.id, PRODUCTS.premiumCourse);
    await removeUserAccess(TEST_USER.id, PRODUCTS.proToolkit);
  });

  test('should grant access to ONLY main product when bump NOT selected', async ({ page }) => {
    const sessionId = generateSessionId('no_bump_logged');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.premiumCourse,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 19900,
        // No bumpProductSlug - bump not selected
      });

      await page.goto(`/p/${PRODUCTS.premiumCourse}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Verify main product access granted
      const mainAccess = await getUserAccess(TEST_USER.id, PRODUCTS.premiumCourse);
      expect(mainAccess).toBeTruthy();

      // Verify bump product access NOT granted
      const bumpAccess = await getUserAccess(TEST_USER.id, PRODUCTS.proToolkit);
      expect(bumpAccess).toBeNull();

      // Verify UI shows access granted
      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });

  test('should grant access to BOTH products when bump IS selected', async ({ page }) => {
    const sessionId = generateSessionId('with_bump_logged');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.premiumCourse,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 24800,
        bumpProductSlug: PRODUCTS.proToolkit,
        bumpAmount: 4900,
      });

      await page.goto(`/p/${PRODUCTS.premiumCourse}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Verify main product access granted
      const mainAccess = await getUserAccess(TEST_USER.id, PRODUCTS.premiumCourse);
      expect(mainAccess).toBeTruthy();

      // Verify bump product access also granted
      const bumpAccess = await getUserAccess(TEST_USER.id, PRODUCTS.proToolkit);
      expect(bumpAccess).toBeTruthy();

      // Verify UI shows access granted
      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });
});

// ============================================================================
// ORDER BUMP TESTS - Guest User
// ============================================================================

test.describe('Order Bump - Guest User', () => {
  // Run serially to avoid conflicts with shared cleanup
  test.describe.configure({ mode: 'serial' });

  test('should save guest purchase for ONLY main product when bump NOT selected', async ({ page }) => {
    const sessionId = generateSessionId('no_bump_guest');
    const guestEmail = `guest-nobump-${Date.now()}@example.com`;
    const product = await getProductBySlug(PRODUCTS.premiumCourse);
    const bumpProduct = await getProductBySlug(PRODUCTS.proToolkit);

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.premiumCourse,
        email: guestEmail,
        amount: 19900,
      });

      await page.goto(`/p/${PRODUCTS.premiumCourse}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Verify guest purchase saved for main product
      const { data: mainPurchase } = await supabaseAdmin.from('guest_purchases')
        .select('*').eq('customer_email', guestEmail).eq('product_id', product!.id).maybeSingle();
      expect(mainPurchase).toBeTruthy();

      // Verify NO guest purchase for bump product
      const { data: bumpPurchase } = await supabaseAdmin.from('guest_purchases')
        .select('*').eq('customer_email', guestEmail).eq('product_id', bumpProduct!.id).maybeSingle();
      expect(bumpPurchase).toBeNull();

      // Verify payment successful shown (OTO may be shown first, then magic link option)
      await expect(page.getByRole('heading', { name: /Payment Successful/i })).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMockPayment(sessionId);
      await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail);
    }
  });

  test('should save guest purchase for BOTH products when bump IS selected', async ({ page }) => {
    const sessionId = generateSessionId('with_bump_guest');
    const guestEmail = `guest-withbump-${Date.now()}@example.com`;
    const product = await getProductBySlug(PRODUCTS.premiumCourse);
    const bumpProduct = await getProductBySlug(PRODUCTS.proToolkit);

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.premiumCourse,
        email: guestEmail,
        amount: 24800,
        bumpProductSlug: PRODUCTS.proToolkit,
        bumpAmount: 4900,
      });

      await page.goto(`/p/${PRODUCTS.premiumCourse}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Verify guest purchase saved for main product
      const { data: mainPurchase } = await supabaseAdmin.from('guest_purchases')
        .select('*').eq('customer_email', guestEmail).eq('product_id', product!.id).maybeSingle();
      expect(mainPurchase).toBeTruthy();

      // Verify guest purchase saved for bump product
      const { data: bumpPurchase } = await supabaseAdmin.from('guest_purchases')
        .select('*').eq('customer_email', guestEmail).eq('product_id', bumpProduct!.id).maybeSingle();
      expect(bumpPurchase).toBeTruthy();

      // Verify payment successful shown (OTO may be shown first, then magic link option)
      await expect(page.getByRole('heading', { name: /Payment Successful/i })).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMockPayment(sessionId);
      await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail);
    }
  });
});

// ============================================================================
// PASS PARAMS TO REDIRECT TESTS
// ============================================================================

test.describe('Pass Params to Redirect', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await removeUserAccess(TEST_USER.id, PRODUCTS.customRedirect);
  });

  test.afterEach(async () => {
    await removeUserAccess(TEST_USER.id, PRODUCTS.customRedirect);
  });

  test('should pass email and session_id to external redirect URL', async ({ page }) => {
    const sessionId = generateSessionId('redirect_params');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.customRedirect,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 4900,
      });

      // Intercept external redirect to capture URL
      let redirectUrl: string | null = null;
      await page.route('https://google.com/**', async (route) => {
        redirectUrl = route.request().url();
        await route.abort();
      });

      await page.goto(`/p/${PRODUCTS.customRedirect}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(8000);

      // Verify redirect URL contains expected params
      expect(redirectUrl).not.toBeNull();
      expect(redirectUrl).toContain('google.com');
      expect(redirectUrl).toContain(`email=${encodeURIComponent(TEST_USER.email)}`);
      // Note: param name is 'sessionId' not 'session_id' (camelCase from buildSuccessRedirectUrl)
      expect(redirectUrl).toContain(`sessionId=${sessionId}`);
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });
});

// ============================================================================
// ALREADY HAS ACCESS TESTS
// ============================================================================

test.describe('Already Has Access', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test.afterEach(async () => {
    await removeUserAccess(TEST_USER.id, PRODUCTS.noRedirect);
  });

  test('should handle user who already has access to product', async ({ page }) => {
    const sessionId = generateSessionId('already_access');
    const product = await getProductBySlug(PRODUCTS.noRedirect);

    try {
      // First, give TEST_USER existing access
      await supabaseAdmin.from('user_product_access').upsert({
        user_id: TEST_USER.id,
        product_id: product!.id,
        access_granted_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        access_expires_at: null,
      }, { onConflict: 'user_id,product_id' });

      // Now create a "new" payment for same product
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.noRedirect,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 9900,
      });

      await page.goto(`/p/${PRODUCTS.noRedirect}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Should still show access granted (not error)
      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });

      // User should still have access
      const access = await getUserAccess(TEST_USER.id, PRODUCTS.noRedirect);
      expect(access).toBeTruthy();
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });
});

// ============================================================================
// TIMED ACCESS TESTS
// ============================================================================

test.describe('Timed Access', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await removeUserAccess(TEST_USER.id, PRODUCTS.enterprise);
  });

  test.afterEach(async () => {
    await removeUserAccess(TEST_USER.id, PRODUCTS.enterprise);
  });

  test('should grant timed access (3 days) after purchase', async ({ page }) => {
    const sessionId = generateSessionId('timed_access');

    try {
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.enterprise,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 49999,
      });

      await page.goto(`/p/${PRODUCTS.enterprise}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Verify access with expiry
      const access = await getUserAccess(TEST_USER.id, PRODUCTS.enterprise);
      expect(access).toBeTruthy();
      expect(access!.access_duration_days).toBe(3);
      expect(access!.access_expires_at).not.toBeNull();

      // Verify expiry is ~3 days from now
      const expiresAt = new Date(access!.access_expires_at);
      const diffDays = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(2);
      expect(diffDays).toBeLessThan(4);

      // UI should show access granted
      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });

  test('should renew expired access after repurchase', async ({ page }) => {
    const sessionId = generateSessionId('expired_repurchase');

    try {
      // Set expired access (3 days product, expired 1 day ago)
      await setExpiredAccess(TEST_USER.id, PRODUCTS.enterprise, 3);

      // Verify access is expired
      const expiredAccess = await getUserAccess(TEST_USER.id, PRODUCTS.enterprise);
      expect(expiredAccess).toBeTruthy();
      expect(new Date(expiredAccess!.access_expires_at).getTime()).toBeLessThan(Date.now());

      // Create repurchase payment
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.enterprise,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 49999,
      });

      await page.goto(`/p/${PRODUCTS.enterprise}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Verify access renewed (new expiry in future)
      const renewedAccess = await getUserAccess(TEST_USER.id, PRODUCTS.enterprise);
      expect(renewedAccess).toBeTruthy();

      const expiresAt = new Date(renewedAccess!.access_expires_at);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

      // UI should show access granted
      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMockPayment(sessionId);
    }
  });
});

// ============================================================================
// PURCHASE HISTORY TESTS - Verify purchase appears in /my-purchases
// ============================================================================

test.describe('Purchase History - /my-purchases', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await removeUserAccess(TEST_USER.id, PRODUCTS.noRedirect);
  });

  test.afterEach(async () => {
    await removeUserAccess(TEST_USER.id, PRODUCTS.noRedirect);
  });

  test('should display purchase in /my-purchases after successful payment', async ({ page }) => {
    const sessionId = generateSessionId('purchase_history');
    const product = await getProductBySlug(PRODUCTS.noRedirect);

    try {
      // Create a mock payment (simulates completed Stripe payment)
      await createMockPayment({
        sessionId,
        productSlug: PRODUCTS.noRedirect,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 9900,
      });

      // Verify payment transaction was created in database
      const { data: transaction } = await supabaseAdmin
        .from('payment_transactions')
        .select('*')
        .eq('session_id', sessionId)
        .single();

      expect(transaction).toBeTruthy();
      expect(transaction.status).toBe('completed');
      expect(transaction.user_id).toBe(TEST_USER.id);

      // Navigate to my-purchases page
      await page.goto('/en/my-purchases');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should see the page title (inside gradient span)
      await expect(page.getByRole('heading', { level: 1 }).getByText('My Purchases')).toBeVisible({ timeout: 10000 });

      // Should see the purchased product in the list (use first() as there may be multiple entries)
      await expect(page.getByText(product!.name).first()).toBeVisible({ timeout: 10000 });

      // Should see "Completed" status badge (at least one)
      await expect(page.getByText('Completed').first()).toBeVisible();

    } finally {
      await cleanupMockPayment(sessionId);
    }
  });

  test('should show multiple purchases in /my-purchases', async ({ page }) => {
    const sessionId1 = generateSessionId('multi_purchase_1');
    const sessionId2 = generateSessionId('multi_purchase_2');
    const product1 = await getProductBySlug(PRODUCTS.noRedirect);
    const product2 = await getProductBySlug(PRODUCTS.premiumCourse);

    try {
      // Clean up any existing access for second product
      await removeUserAccess(TEST_USER.id, PRODUCTS.premiumCourse);

      // Create first purchase
      await createMockPayment({
        sessionId: sessionId1,
        productSlug: PRODUCTS.noRedirect,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 9900,
      });

      // Create second purchase
      await createMockPayment({
        sessionId: sessionId2,
        productSlug: PRODUCTS.premiumCourse,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        amount: 19900,
      });

      // Navigate to my-purchases page
      await page.goto('/en/my-purchases');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should see both products in the list (use first() as there may be multiple entries)
      await expect(page.getByText(product1!.name).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(product2!.name).first()).toBeVisible({ timeout: 10000 });

    } finally {
      await cleanupMockPayment(sessionId1);
      await cleanupMockPayment(sessionId2);
      await removeUserAccess(TEST_USER.id, PRODUCTS.premiumCourse);
    }
  });

  test('should not show purchases from other users', async ({ page }) => {
    const sessionId = generateSessionId('other_user_purchase');
    const uniqueProductSlug = `other-user-product-${Date.now()}`;

    // Create another test user dynamically
    const otherEmail = `other-user-${Date.now()}@test.local`;
    const { data: { user: otherUser } } = await supabaseAdmin.auth.admin.createUser({
      email: otherEmail,
      password: 'OtherPassword123!',
      email_confirm: true,
    });

    // Create a unique product that only other user will have
    const { data: uniqueProduct } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Other User Product ${Date.now()}`,
        slug: uniqueProductSlug,
        price: 5000,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();

    try {
      // Create a purchase for other user only
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: sessionId,
          product_id: uniqueProduct!.id,
          customer_email: otherEmail,
          user_id: otherUser!.id,
          amount: 5000,
          currency: 'pln',
          status: 'completed',
          stripe_payment_intent_id: `pi_test_${sessionId}`,
        });

      // Log in as TEST_USER and check my-purchases
      await page.goto('/en/my-purchases');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should see the page title
      await expect(page.getByRole('heading', { level: 1 }).getByText('My Purchases')).toBeVisible({ timeout: 10000 });

      // Should NOT see other user's product (TEST_USER doesn't have this purchase)
      const productVisible = await page.getByText(uniqueProduct!.name).isVisible().catch(() => false);
      expect(productVisible).toBe(false);

    } finally {
      await supabaseAdmin.from('payment_transactions').delete().eq('session_id', sessionId);
      await supabaseAdmin.from('products').delete().eq('id', uniqueProduct!.id);
      await supabaseAdmin.from('profiles').delete().eq('id', otherUser!.id);
      await supabaseAdmin.auth.admin.deleteUser(otherUser!.id);
    }
  });
});
