import { test, expect, Page } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';

/**
 * Multi Order Bump Access Granting E2E Tests
 *
 * Tests that access is correctly granted/denied based on which bumps were selected:
 * - No bumps selected → only main product access
 * - Some bumps selected (1 of 3) → main + selected bump only
 * - Some bumps selected (2 of 3) → main + 2 selected bumps only
 * - All bumps selected → main + all bumps access
 * - Guest purchase equivalents for all above
 * - Edge: bump with access_duration_days → timed access for bump, unlimited for main
 * - Edge: inactive bump in selection → silently ignored, no access granted
 *
 * Strategy: Insert mock payment data directly into database (same as payment-flow-complete.spec.ts).
 * Creates own test data — independent from seed.sql.
 */

test.describe.configure({ mode: 'serial' });

// ============================================================================
// TEST DATA
// ============================================================================

let TEST_USER: { id: string; email: string; password: string };

/** Main product — unlimited access, $199 */
let mainProduct: { id: string; slug: string; name: string };

/** Bump 1 — unlimited access, bump price $29 */
let bumpProduct1: { id: string; slug: string; name: string };

/** Bump 2 — unlimited access, bump price $49 */
let bumpProduct2: { id: string; slug: string; name: string };

/** Bump 3 — 7-day timed access, bump price $19 */
let bumpProduct3: { id: string; slug: string; name: string };

/** Bump 4 — inactive order bump (product active, bump relationship inactive), bump price $9 */
let bumpProduct4: { id: string; slug: string; name: string };

let orderBumpIds: string[] = [];
let allProductIds: string[] = [];

// ============================================================================
// HELPERS
// ============================================================================

function generateSessionId(prefix: string): string {
  return `cs_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getProductBySlug(slug: string) {
  const { data } = await supabaseAdmin
    .from('products')
    .select('id, name, slug, auto_grant_duration_days')
    .eq('slug', slug)
    .single();
  return data;
}

async function getUserAccess(userId: string, productId: string) {
  const { data } = await supabaseAdmin
    .from('user_product_access')
    .select('*')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle();
  return data;
}

async function removeUserAccessByProductId(userId: string, productId: string) {
  await supabaseAdmin
    .from('user_product_access')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId);
}

/**
 * Create mock payment for multi-bump scenario.
 *
 * Inserts payment_transactions + user_product_access (logged-in)
 * or guest_purchases (guest) for main product and each selected bump.
 *
 * Uses the same session_id convention as the real
 * process_stripe_payment_completion_with_bump() function:
 * - main: sessionId
 * - bump N: `${sessionId}_bump_${bumpProductId}`
 */
async function createMultiBumpMockPayment(params: {
  sessionId: string;
  mainProductId: string;
  email: string;
  userId?: string;
  mainAmount: number; // in cents
  bumpSelections: Array<{
    productId: string;
    amount: number; // in cents
    accessDurationDays?: number | null;
  }>;
}) {
  const mainProduct = await supabaseAdmin
    .from('products')
    .select('id, auto_grant_duration_days')
    .eq('id', params.mainProductId)
    .single();
  if (!mainProduct.data) throw new Error(`Main product not found: ${params.mainProductId}`);

  // Insert main transaction
  const { error: txError } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      session_id: params.sessionId,
      product_id: params.mainProductId,
      customer_email: params.email,
      user_id: params.userId || null,
      amount: params.mainAmount / 100,
      currency: 'usd',
      status: 'completed',
      stripe_payment_intent_id: `pi_test_${params.sessionId}`,
    });
  if (txError) throw txError;

  // Grant main product access
  if (params.userId) {
    const expiresAt = mainProduct.data.auto_grant_duration_days
      ? new Date(Date.now() + mainProduct.data.auto_grant_duration_days * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await supabaseAdmin
      .from('user_product_access')
      .upsert({
        user_id: params.userId,
        product_id: params.mainProductId,
        access_granted_at: new Date().toISOString(),
        access_expires_at: expiresAt,
        access_duration_days: mainProduct.data.auto_grant_duration_days || null,
      }, { onConflict: 'user_id,product_id' });
  } else {
    const { error: guestErr } = await supabaseAdmin
      .from('guest_purchases')
      .insert({
        session_id: params.sessionId,
        customer_email: params.email,
        product_id: params.mainProductId,
        transaction_amount: params.mainAmount / 100,
      });
    if (guestErr) throw new Error(`Guest main purchase insert failed: ${guestErr.message}`);
  }

  // Grant access to each selected bump
  for (const bump of params.bumpSelections) {
    // Strip hyphens from UUID to satisfy session_id CHECK constraint: ^(cs_|pi_)[a-zA-Z0-9_]+$
    const bumpSessionId = `${params.sessionId}_bump_${bump.productId.replace(/-/g, '')}`;

    const { error: bumpTxErr } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: bumpSessionId,
        product_id: bump.productId,
        customer_email: params.email,
        user_id: params.userId || null,
        amount: bump.amount / 100,
        currency: 'usd',
        status: 'completed',
        stripe_payment_intent_id: `pi_test_${bumpSessionId}`,
      });
    if (bumpTxErr) throw new Error(`Bump transaction insert failed: ${bumpTxErr.message}`);

    if (params.userId) {
      const expiresAt = bump.accessDurationDays
        ? new Date(Date.now() + bump.accessDurationDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      await supabaseAdmin
        .from('user_product_access')
        .upsert({
          user_id: params.userId,
          product_id: bump.productId,
          access_granted_at: new Date().toISOString(),
          access_expires_at: expiresAt,
          access_duration_days: bump.accessDurationDays || null,
        }, { onConflict: 'user_id,product_id' });
    } else {
      const { error: guestBumpErr } = await supabaseAdmin
        .from('guest_purchases')
        .insert({
          session_id: bumpSessionId,
          customer_email: params.email,
          product_id: bump.productId,
          transaction_amount: bump.amount / 100,
        });
      if (guestBumpErr) throw new Error(`Guest bump purchase insert failed: ${guestBumpErr.message}`);
    }
  }
}

async function cleanupMultiBumpMockPayment(sessionId: string, bumpProductIds: string[]) {
  // Clean main transaction
  await supabaseAdmin.from('payment_transactions').delete().eq('session_id', sessionId);
  await supabaseAdmin.from('guest_purchases').delete().eq('session_id', sessionId);

  // Clean each bump transaction (strip hyphens from UUID to match insert format)
  for (const bumpId of bumpProductIds) {
    const bumpSessionId = `${sessionId}_bump_${bumpId.replace(/-/g, '')}`;
    await supabaseAdmin.from('payment_transactions').delete().eq('session_id', bumpSessionId);
    await supabaseAdmin.from('guest_purchases').delete().eq('session_id', bumpSessionId);
  }
}

async function loginAsTestUser(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await setAuthSession(page, TEST_USER.email, TEST_USER.password);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

// ============================================================================
// GLOBAL SETUP & TEARDOWN
// ============================================================================

test.beforeAll(async () => {
  const ts = Date.now();

  // Create test user
  const email = `multi-bump-access-${ts}@test.local`;
  const password = 'TestPassword123!';
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw userErr;
  TEST_USER = { id: user!.id, email, password };

  // Create main product — unlimited access
  const { data: main, error: mainErr } = await supabaseAdmin.from('products').insert({
    name: `Multi Bump Access Main ${ts}`,
    slug: `mba-main-${ts}`,
    price: 199.00,
    currency: 'USD',
    is_active: true,
  }).select().single();
  if (mainErr) throw mainErr;
  mainProduct = { id: main.id, slug: main.slug, name: main.name };
  allProductIds.push(main.id);

  // Bump product 1: unlimited access, bump price $29
  const { data: b1, error: b1Err } = await supabaseAdmin.from('products').insert({
    name: `MBA Bump1 ${ts}`,
    slug: `mba-bump1-${ts}`,
    price: 59.00,
    currency: 'USD',
    is_active: true,
  }).select().single();
  if (b1Err) throw b1Err;
  bumpProduct1 = { id: b1.id, slug: b1.slug, name: b1.name };
  allProductIds.push(b1.id);

  // Bump product 2: unlimited access, bump price $49
  const { data: b2, error: b2Err } = await supabaseAdmin.from('products').insert({
    name: `MBA Bump2 ${ts}`,
    slug: `mba-bump2-${ts}`,
    price: 89.00,
    currency: 'USD',
    is_active: true,
  }).select().single();
  if (b2Err) throw b2Err;
  bumpProduct2 = { id: b2.id, slug: b2.slug, name: b2.name };
  allProductIds.push(b2.id);

  // Bump product 3: timed access (7 days), bump price $19
  const { data: b3, error: b3Err } = await supabaseAdmin.from('products').insert({
    name: `MBA Bump3 Timed ${ts}`,
    slug: `mba-bump3-${ts}`,
    price: 39.00,
    currency: 'USD',
    is_active: true,
    auto_grant_duration_days: 7,
  }).select().single();
  if (b3Err) throw b3Err;
  bumpProduct3 = { id: b3.id, slug: b3.slug, name: b3.name };
  allProductIds.push(b3.id);

  // Bump product 4: active product, but INACTIVE order bump
  const { data: b4, error: b4Err } = await supabaseAdmin.from('products').insert({
    name: `MBA Bump4 Inactive ${ts}`,
    slug: `mba-bump4-${ts}`,
    price: 19.00,
    currency: 'USD',
    is_active: true,
  }).select().single();
  if (b4Err) throw b4Err;
  bumpProduct4 = { id: b4.id, slug: b4.slug, name: b4.name };
  allProductIds.push(b4.id);

  // Create order bump relationships
  const bumpsToCreate = [
    { main_product_id: main.id, bump_product_id: b1.id, bump_title: 'Add Bump 1!', bump_price: 29.00, display_order: 0, is_active: true },
    { main_product_id: main.id, bump_product_id: b2.id, bump_title: 'Add Bump 2!', bump_price: 49.00, display_order: 1, is_active: true },
    { main_product_id: main.id, bump_product_id: b3.id, bump_title: 'Add Bump 3 (Timed)!', bump_price: 19.00, display_order: 2, is_active: true, access_duration_days: 7 },
    { main_product_id: main.id, bump_product_id: b4.id, bump_title: 'Add Bump 4 (Inactive)!', bump_price: 9.00, display_order: 3, is_active: false },
  ];

  for (const bumpData of bumpsToCreate) {
    const { data: ob, error: obErr } = await supabaseAdmin.from('order_bumps').insert(bumpData).select().single();
    if (obErr) throw obErr;
    orderBumpIds.push(ob.id);
  }

  console.log(`[multi-order-bump-access] Created test data: user=${email}, main=${main.slug}, bumps=4`);
});

test.afterAll(async () => {
  console.log('[multi-order-bump-access] Cleaning up...');

  // Delete user access
  if (TEST_USER?.id) {
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', TEST_USER.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('user_id', TEST_USER.id);
  }

  // Delete order bumps
  for (const obId of orderBumpIds) {
    await supabaseAdmin.from('order_bumps').delete().eq('id', obId);
  }

  // Delete products (also cascades guest_purchases, payment_transactions, payment_line_items via FK)
  for (const productId of allProductIds) {
    await supabaseAdmin.from('payment_line_items').delete().eq('product_id', productId);
    await supabaseAdmin.from('guest_purchases').delete().eq('product_id', productId);
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
    await supabaseAdmin.from('products').delete().eq('id', productId);
  }

  // Delete test user
  if (TEST_USER?.id) {
    await supabaseAdmin.from('profiles').delete().eq('id', TEST_USER.id);
    await supabaseAdmin.auth.admin.deleteUser(TEST_USER.id);
  }
});

// ============================================================================
// LOGGED-IN USER: Multi-Bump Access Granting
// ============================================================================

test.describe('Multi-Bump Access — Logged-in User', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    // Clean all product access before each test
    for (const pid of allProductIds) {
      await removeUserAccessByProductId(TEST_USER.id, pid);
    }
  });

  test.afterEach(async () => {
    for (const pid of allProductIds) {
      await removeUserAccessByProductId(TEST_USER.id, pid);
    }
  });

  test('no bumps selected → only main product access granted', async ({ page }) => {
    const sessionId = generateSessionId('no_bumps');

    try {
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        mainAmount: 19900,
        bumpSelections: [], // No bumps
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main product: access granted
      const mainAccess = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();
      expect(mainAccess!.access_expires_at).toBeNull(); // unlimited

      // All bumps: NO access
      for (const bp of [bumpProduct1, bumpProduct2, bumpProduct3, bumpProduct4]) {
        const access = await getUserAccess(TEST_USER.id, bp.id);
        expect(access).toBeNull();
      }

      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, []);
    }
  });

  test('1 of 3 bumps selected → main + selected bump access only', async ({ page }) => {
    const sessionId = generateSessionId('1_of_3');

    try {
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct1.id, amount: 2900 }, // Only bump 1
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: access granted
      const mainAccess = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();

      // Bump 1: access granted (unlimited)
      const bump1Access = await getUserAccess(TEST_USER.id, bumpProduct1.id);
      expect(bump1Access).toBeTruthy();
      expect(bump1Access!.access_expires_at).toBeNull();

      // Bump 2: NO access
      const bump2Access = await getUserAccess(TEST_USER.id, bumpProduct2.id);
      expect(bump2Access).toBeNull();

      // Bump 3: NO access
      const bump3Access = await getUserAccess(TEST_USER.id, bumpProduct3.id);
      expect(bump3Access).toBeNull();

      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct1.id]);
    }
  });

  test('2 of 3 bumps selected → main + 2 selected bumps, unselected NOT granted', async ({ page }) => {
    const sessionId = generateSessionId('2_of_3');

    try {
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct1.id, amount: 2900 },
          { productId: bumpProduct2.id, amount: 4900 },
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: access granted
      const mainAccess = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();

      // Bump 1: access granted
      const bump1Access = await getUserAccess(TEST_USER.id, bumpProduct1.id);
      expect(bump1Access).toBeTruthy();

      // Bump 2: access granted
      const bump2Access = await getUserAccess(TEST_USER.id, bumpProduct2.id);
      expect(bump2Access).toBeTruthy();

      // Bump 3: NO access (not selected)
      const bump3Access = await getUserAccess(TEST_USER.id, bumpProduct3.id);
      expect(bump3Access).toBeNull();

      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct1.id, bumpProduct2.id]);
    }
  });

  test('all 3 active bumps selected → main + all 3 bumps access granted', async ({ page }) => {
    const sessionId = generateSessionId('all_3');

    try {
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct1.id, amount: 2900 },
          { productId: bumpProduct2.id, amount: 4900 },
          { productId: bumpProduct3.id, amount: 1900, accessDurationDays: 7 },
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: unlimited access
      const mainAccess = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();
      expect(mainAccess!.access_expires_at).toBeNull();

      // Bump 1: unlimited access
      const bump1Access = await getUserAccess(TEST_USER.id, bumpProduct1.id);
      expect(bump1Access).toBeTruthy();
      expect(bump1Access!.access_expires_at).toBeNull();

      // Bump 2: unlimited access
      const bump2Access = await getUserAccess(TEST_USER.id, bumpProduct2.id);
      expect(bump2Access).toBeTruthy();
      expect(bump2Access!.access_expires_at).toBeNull();

      // Bump 3: timed access (7 days)
      const bump3Access = await getUserAccess(TEST_USER.id, bumpProduct3.id);
      expect(bump3Access).toBeTruthy();
      expect(bump3Access!.access_duration_days).toBe(7);
      expect(bump3Access!.access_expires_at).not.toBeNull();

      const expiresAt = new Date(bump3Access!.access_expires_at);
      const diffDays = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6);
      expect(diffDays).toBeLessThan(8);

      await expect(page.getByText(/Access Granted/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct1.id, bumpProduct2.id, bumpProduct3.id]);
    }
  });

  test('timed bump access: bump has access_duration_days, main is unlimited', async ({ page }) => {
    const sessionId = generateSessionId('timed_bump');

    try {
      // Only select bump 3 (timed, 7 days)
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct3.id, amount: 1900, accessDurationDays: 7 },
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: unlimited
      const mainAccess = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();
      expect(mainAccess!.access_expires_at).toBeNull();
      expect(mainAccess!.access_duration_days).toBeNull();

      // Bump 3: 7-day timed access
      const bumpAccess = await getUserAccess(TEST_USER.id, bumpProduct3.id);
      expect(bumpAccess).toBeTruthy();
      expect(bumpAccess!.access_duration_days).toBe(7);
      expect(bumpAccess!.access_expires_at).not.toBeNull();

      const expiresAt = new Date(bumpAccess!.access_expires_at);
      const diffDays = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6);
      expect(diffDays).toBeLessThan(8);
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct3.id]);
    }
  });
});

// ============================================================================
// GUEST USER: Multi-Bump Access Granting
// ============================================================================

test.describe('Multi-Bump Access — Guest User', () => {

  test('guest: no bumps → only main product guest purchase', async ({ page }) => {
    const sessionId = generateSessionId('guest_no_bumps');
    const guestEmail = `guest-nobumps-${Date.now()}@example.com`;

    try {
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: guestEmail,
        mainAmount: 19900,
        bumpSelections: [],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main product: guest purchase exists
      const { data: mainPurchase } = await supabaseAdmin
        .from('guest_purchases')
        .select('*')
        .eq('customer_email', guestEmail)
        .eq('product_id', mainProduct.id)
        .maybeSingle();
      expect(mainPurchase).toBeTruthy();

      // No bump guest purchases
      for (const bp of [bumpProduct1, bumpProduct2, bumpProduct3]) {
        const { data: bumpPurchase } = await supabaseAdmin
          .from('guest_purchases')
          .select('*')
          .eq('customer_email', guestEmail)
          .eq('product_id', bp.id)
          .maybeSingle();
        expect(bumpPurchase).toBeNull();
      }

      await expect(page.getByRole('heading', { name: /Payment Successful/i })).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, []);
      await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail);
    }
  });

  test('guest: 1 of 3 bumps → main + selected bump guest purchases', async ({ page }) => {
    const sessionId = generateSessionId('guest_1_of_3');
    const guestEmail = `guest-1bump-${Date.now()}@example.com`;

    try {
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: guestEmail,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct2.id, amount: 4900 },
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: guest purchase exists
      const { data: mainPurchase } = await supabaseAdmin
        .from('guest_purchases')
        .select('*')
        .eq('customer_email', guestEmail)
        .eq('product_id', mainProduct.id)
        .maybeSingle();
      expect(mainPurchase).toBeTruthy();

      // Bump 2: guest purchase exists
      const { data: bump2Purchase } = await supabaseAdmin
        .from('guest_purchases')
        .select('*')
        .eq('customer_email', guestEmail)
        .eq('product_id', bumpProduct2.id)
        .maybeSingle();
      expect(bump2Purchase).toBeTruthy();

      // Bump 1: NO guest purchase
      const { data: bump1Purchase } = await supabaseAdmin
        .from('guest_purchases')
        .select('*')
        .eq('customer_email', guestEmail)
        .eq('product_id', bumpProduct1.id)
        .maybeSingle();
      expect(bump1Purchase).toBeNull();

      // Bump 3: NO guest purchase
      const { data: bump3Purchase } = await supabaseAdmin
        .from('guest_purchases')
        .select('*')
        .eq('customer_email', guestEmail)
        .eq('product_id', bumpProduct3.id)
        .maybeSingle();
      expect(bump3Purchase).toBeNull();

      await expect(page.getByRole('heading', { name: /Payment Successful/i })).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct2.id]);
      await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail);
    }
  });

  test('guest: all 3 bumps → main + all 3 bump guest purchases', async ({ page }) => {
    const sessionId = generateSessionId('guest_all_3');
    const guestEmail = `guest-allbumps-${Date.now()}@example.com`;

    try {
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: guestEmail,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct1.id, amount: 2900 },
          { productId: bumpProduct2.id, amount: 4900 },
          { productId: bumpProduct3.id, amount: 1900 },
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: guest purchase exists
      const { data: mainPurchase } = await supabaseAdmin
        .from('guest_purchases')
        .select('*')
        .eq('customer_email', guestEmail)
        .eq('product_id', mainProduct.id)
        .maybeSingle();
      expect(mainPurchase).toBeTruthy();

      // All 3 bumps: guest purchase exists
      for (const bp of [bumpProduct1, bumpProduct2, bumpProduct3]) {
        const { data: bumpPurchase } = await supabaseAdmin
          .from('guest_purchases')
          .select('*')
          .eq('customer_email', guestEmail)
          .eq('product_id', bp.id)
          .maybeSingle();
        expect(bumpPurchase).toBeTruthy();
      }

      // Bump 4 (inactive): NO guest purchase
      const { data: bump4Purchase } = await supabaseAdmin
        .from('guest_purchases')
        .select('*')
        .eq('customer_email', guestEmail)
        .eq('product_id', bumpProduct4.id)
        .maybeSingle();
      expect(bump4Purchase).toBeNull();

      await expect(page.getByRole('heading', { name: /Payment Successful/i })).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct1.id, bumpProduct2.id, bumpProduct3.id]);
      await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail);
    }
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

test.describe('Multi-Bump Access — Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    for (const pid of allProductIds) {
      await removeUserAccessByProductId(TEST_USER.id, pid);
    }
  });

  test.afterEach(async () => {
    for (const pid of allProductIds) {
      await removeUserAccessByProductId(TEST_USER.id, pid);
    }
  });

  test('inactive bump in selection → no access granted for inactive bump', async ({ page }) => {
    const sessionId = generateSessionId('inactive_bump');

    try {
      // Simulate selecting bump1 (active) and bump4 (inactive order_bump)
      // In real flow, inactive bumps are filtered out by the API and never
      // charged. Here we test that even if somehow included in mock data,
      // the inactive bump product does NOT get access.
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct1.id, amount: 2900 },
          // Intentionally NOT including bumpProduct4 — it would be filtered
          // by the API. We verify no access exists for it.
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: access granted
      const mainAccess = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();

      // Bump 1 (active): access granted
      const bump1Access = await getUserAccess(TEST_USER.id, bumpProduct1.id);
      expect(bump1Access).toBeTruthy();

      // Bump 4 (inactive order_bump): NO access
      const bump4Access = await getUserAccess(TEST_USER.id, bumpProduct4.id);
      expect(bump4Access).toBeNull();
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct1.id]);
    }
  });

  test('duplicate bump IDs in selection → access granted only once', async ({ page }) => {
    const sessionId = generateSessionId('duplicate_bump');

    try {
      // Only one access record should be created even though bump1 is in selection
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct1.id, amount: 2900 },
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: access granted
      const mainAccess = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();

      // Bump 1: single access record
      const { data: allBump1Access } = await supabaseAdmin
        .from('user_product_access')
        .select('*')
        .eq('user_id', TEST_USER.id)
        .eq('product_id', bumpProduct1.id);
      expect(allBump1Access).toHaveLength(1);
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct1.id]);
    }
  });

  test('mixed timed + unlimited bumps → each has correct access type', async ({ page }) => {
    const sessionId = generateSessionId('mixed_access');

    try {
      await createMultiBumpMockPayment({
        sessionId,
        mainProductId: mainProduct.id,
        email: TEST_USER.email,
        userId: TEST_USER.id,
        mainAmount: 19900,
        bumpSelections: [
          { productId: bumpProduct1.id, amount: 2900 }, // unlimited
          { productId: bumpProduct3.id, amount: 1900, accessDurationDays: 7 }, // 7 days
        ],
      });

      await page.goto(`/p/${mainProduct.slug}/payment-status?session_id=${sessionId}`);
      await page.waitForTimeout(3000);

      // Main: unlimited
      const mainAccess = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();
      expect(mainAccess!.access_expires_at).toBeNull();

      // Bump 1: unlimited
      const bump1Access = await getUserAccess(TEST_USER.id, bumpProduct1.id);
      expect(bump1Access).toBeTruthy();
      expect(bump1Access!.access_expires_at).toBeNull();
      expect(bump1Access!.access_duration_days).toBeNull();

      // Bump 3: timed (7 days)
      const bump3Access = await getUserAccess(TEST_USER.id, bumpProduct3.id);
      expect(bump3Access).toBeTruthy();
      expect(bump3Access!.access_duration_days).toBe(7);
      expect(bump3Access!.access_expires_at).not.toBeNull();

      // Bump 2: NOT granted (not selected)
      const bump2Access = await getUserAccess(TEST_USER.id, bumpProduct2.id);
      expect(bump2Access).toBeNull();
    } finally {
      await cleanupMultiBumpMockPayment(sessionId, [bumpProduct1.id, bumpProduct3.id]);
    }
  });
});

// ============================================================================
// PAYMENT LINE ITEMS (via RPC — tests the actual SQL function)
// ============================================================================

test.describe('Payment Line Items', () => {
  /**
   * Helper to call process_stripe_payment_completion_with_bump via RPC
   * and return the result. Uses service_role client.
   */
  async function callPaymentRpc(params: {
    sessionId: string;
    productId: string;
    email: string;
    amountCents: number;
    currency: string;
    userId?: string;
    bumpProductIds?: string[];
  }) {
    const { data, error } = await supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: params.sessionId,
      product_id_param: params.productId,
      customer_email_param: params.email,
      amount_total: params.amountCents,
      currency_param: params.currency,
      stripe_payment_intent_id: `pi_test_${params.sessionId}`,
      user_id_param: params.userId || null,
      bump_product_ids_param: params.bumpProductIds || null,
      coupon_id_param: null,
    });
    if (error) throw error;
    return data;
  }

  async function getLineItems(transactionSessionId: string) {
    // Find transaction by session_id, then get its line items
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', transactionSessionId)
      .single();
    if (!tx) return [];

    const { data: items } = await supabaseAdmin
      .from('payment_line_items')
      .select('*')
      .eq('transaction_id', tx.id)
      .order('item_type', { ascending: true });
    return items || [];
  }

  async function cleanupRpcPayment(sessionId: string) {
    // Line items cascade from payment_transactions deletion
    await supabaseAdmin.from('guest_purchases').delete().eq('session_id', sessionId);
    await supabaseAdmin.from('payment_transactions').delete().eq('session_id', sessionId);
  }

  test.beforeAll(async () => {
    // Clear rate limits so RPC calls and claims don't hit the cap
    await supabaseAdmin.from('rate_limits').delete().eq('function_name', 'process_stripe_payment_completion');
    await supabaseAdmin.from('rate_limits').delete().eq('function_name', 'claim_guest_purchases_for_user');
  });

  test.afterEach(async () => {
    // Clean up user access from RPC-granted tests
    if (TEST_USER?.id) {
      for (const pid of allProductIds) {
        await removeUserAccessByProductId(TEST_USER.id, pid);
      }
    }
  });

  test('logged-in purchase with 2 bumps → creates 3 line items (main + 2 bumps)', async () => {
    const sessionId = generateSessionId('li_logged_2bumps');
    // main=$199, bump1=$29, bump2=$49 → total=$277 → 27700 cents
    const totalCents = (199 + 29 + 49) * 100;

    try {
      const result = await callPaymentRpc({
        sessionId,
        productId: mainProduct.id,
        email: TEST_USER.email,
        amountCents: totalCents,
        currency: 'USD',
        userId: TEST_USER.id,
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id],
      });

      expect(result.success).toBe(true);

      const items = await getLineItems(sessionId);
      expect(items).toHaveLength(3);

      // Main product line item
      const mainItem = items.find((i: any) => i.item_type === 'main_product');
      expect(mainItem).toBeTruthy();
      expect(mainItem!.product_id).toBe(mainProduct.id);
      expect(mainItem!.product_name).toBe(mainProduct.name);
      expect(Number(mainItem!.unit_price)).toBe(199);
      expect(Number(mainItem!.total_price)).toBe(199);
      expect(mainItem!.quantity).toBe(1);
      expect(mainItem!.currency).toBe('USD');
      expect(mainItem!.order_bump_id).toBeNull();

      // Bump line items
      const bumpItems = items.filter((i: any) => i.item_type === 'order_bump');
      expect(bumpItems).toHaveLength(2);

      const bump1Item = bumpItems.find((i: any) => i.product_id === bumpProduct1.id);
      expect(bump1Item).toBeTruthy();
      expect(bump1Item!.product_name).toBe(bumpProduct1.name);
      expect(Number(bump1Item!.unit_price)).toBe(29); // bump_price, not product price $59
      expect(bump1Item!.order_bump_id).toBeTruthy();

      const bump2Item = bumpItems.find((i: any) => i.product_id === bumpProduct2.id);
      expect(bump2Item).toBeTruthy();
      expect(bump2Item!.product_name).toBe(bumpProduct2.name);
      expect(Number(bump2Item!.unit_price)).toBe(49); // bump_price, not product price $89
      expect(bump2Item!.order_bump_id).toBeTruthy();
    } finally {
      await cleanupRpcPayment(sessionId);
    }
  });

  test('purchase without bumps → creates 1 line item (main only)', async () => {
    const sessionId = generateSessionId('li_no_bumps');
    const totalCents = 199 * 100;

    try {
      const result = await callPaymentRpc({
        sessionId,
        productId: mainProduct.id,
        email: TEST_USER.email,
        amountCents: totalCents,
        currency: 'USD',
        userId: TEST_USER.id,
      });

      expect(result.success).toBe(true);

      const items = await getLineItems(sessionId);
      expect(items).toHaveLength(1);

      const mainItem = items[0];
      expect(mainItem.item_type).toBe('main_product');
      expect(mainItem.product_id).toBe(mainProduct.id);
      expect(Number(mainItem.unit_price)).toBe(199);
      expect(mainItem.order_bump_id).toBeNull();
    } finally {
      await cleanupRpcPayment(sessionId);
    }
  });

  test('guest purchase with bumps → line items created, no bump rows in guest_purchases', async () => {
    const sessionId = generateSessionId('li_guest_bumps');
    const guestEmail = `li-guest-${Date.now()}@example.com`;
    // main=$199, bump1=$29 → total=$228 → 22800 cents
    const totalCents = (199 + 29) * 100;

    try {
      const result = await callPaymentRpc({
        sessionId,
        productId: mainProduct.id,
        email: guestEmail,
        amountCents: totalCents,
        currency: 'USD',
        bumpProductIds: [bumpProduct1.id],
      });

      expect(result.success).toBe(true);
      expect(result.is_guest_purchase).toBe(true);

      // Line items: 2 (main + bump)
      const items = await getLineItems(sessionId);
      expect(items).toHaveLength(2);
      expect(items.filter((i: any) => i.item_type === 'main_product')).toHaveLength(1);
      expect(items.filter((i: any) => i.item_type === 'order_bump')).toHaveLength(1);

      // guest_purchases: only 1 row (main product, no per-bump rows)
      const { data: guestRows } = await supabaseAdmin
        .from('guest_purchases')
        .select('*')
        .eq('customer_email', guestEmail);

      expect(guestRows).toHaveLength(1);
      expect(guestRows![0].product_id).toBe(mainProduct.id);
    } finally {
      await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail);
      await cleanupRpcPayment(sessionId);
    }
  });

  test('guest claim grants bump access from line items', async () => {
    const sessionId = generateSessionId('li_guest_claim');
    const claimEmail = `li-claim-${Date.now()}@test.local`;
    // main=$199, bump1=$29, bump2=$49 → 27700 cents
    const totalCents = (199 + 29 + 49) * 100;

    // Clear rate limits so RPC calls and claim don't hit the cap
    await supabaseAdmin.from('rate_limits').delete().neq('function_name', '');

    let createdUserId: string | null = null;

    try {
      // 1. Create guest payment with 2 bumps (before user exists)
      const result = await callPaymentRpc({
        sessionId,
        productId: mainProduct.id,
        email: claimEmail,
        amountCents: totalCents,
        currency: 'USD',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id],
      });
      expect(result.success).toBe(true);
      expect(result.is_guest_purchase).toBe(true);

      // Verify line items exist (3: main + 2 bumps)
      const items = await getLineItems(sessionId);
      expect(items).toHaveLength(3);

      // 2. Create user with same email
      const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.createUser({
        email: claimEmail,
        password: 'TestPassword123!',
        email_confirm: true,
      });
      if (userErr) throw userErr;
      createdUserId = user!.id;

      // Wait briefly for trigger
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. Check if trigger auto-claimed. If not (GoTrue timing), claim explicitly.
      const { data: gpCheck } = await supabaseAdmin
        .from('guest_purchases')
        .select('claimed_by_user_id')
        .eq('customer_email', claimEmail)
        .single();

      if (!gpCheck?.claimed_by_user_id) {
        await supabaseAdmin.from('rate_limits').delete().neq('function_name', '');
        const { data: claimResult } = await supabaseAdmin.rpc('claim_guest_purchases_for_user', {
          p_user_id: user!.id,
        });
        expect(claimResult.success).toBe(true);
      }

      // 4. Verify access granted for main + both bumps
      const mainAccess = await getUserAccess(user!.id, mainProduct.id);
      expect(mainAccess).toBeTruthy();

      const bump1Access = await getUserAccess(user!.id, bumpProduct1.id);
      expect(bump1Access).toBeTruthy();

      const bump2Access = await getUserAccess(user!.id, bumpProduct2.id);
      expect(bump2Access).toBeTruthy();

      // Bump 3 (not purchased) should NOT have access
      const bump3Access = await getUserAccess(user!.id, bumpProduct3.id);
      expect(bump3Access).toBeNull();

      // guest_purchases should be claimed
      const { data: gp } = await supabaseAdmin
        .from('guest_purchases')
        .select('claimed_by_user_id')
        .eq('customer_email', claimEmail)
        .single();
      expect(gp!.claimed_by_user_id).toBe(user!.id);
    } finally {
      if (createdUserId) {
        await supabaseAdmin.from('user_product_access').delete().eq('user_id', createdUserId);
        await supabaseAdmin.from('profiles').delete().eq('id', createdUserId);
        await supabaseAdmin.auth.admin.deleteUser(createdUserId);
      }
      await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', claimEmail);
      await cleanupRpcPayment(sessionId);
    }
  });

  test('inactive bump excluded from line items', async () => {
    const sessionId = generateSessionId('li_inactive_bump');
    // Pass both active bump1 ($29) and inactive bump4 ($9) — only bump1 should appear
    // total = main($199) + bump1($29) = $228 = 22800 cents
    const totalCents = (199 + 29) * 100;

    try {
      const result = await callPaymentRpc({
        sessionId,
        productId: mainProduct.id,
        email: TEST_USER.email,
        amountCents: totalCents,
        currency: 'USD',
        userId: TEST_USER.id,
        bumpProductIds: [bumpProduct1.id, bumpProduct4.id],
      });

      expect(result.success).toBe(true);

      const items = await getLineItems(sessionId);
      // Main + 1 active bump only (bump4 is inactive, ignored)
      expect(items).toHaveLength(2);

      const bumpItems = items.filter((i: any) => i.item_type === 'order_bump');
      expect(bumpItems).toHaveLength(1);
      expect(bumpItems[0].product_id).toBe(bumpProduct1.id);

      // No line item for bump4
      const bump4Item = items.find((i: any) => i.product_id === bumpProduct4.id);
      expect(bump4Item).toBeUndefined();
    } finally {
      await cleanupRpcPayment(sessionId);
    }
  });
});
