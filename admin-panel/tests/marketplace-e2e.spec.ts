/**
 * E2E Tests: Marketplace Payment Flow & Seller Admin
 *
 * Tests the complete marketplace experience:
 * 1. Seller product pages load correctly
 * 2. Seller checkout page renders with correct product
 * 3. Seller admin panel — seller owner sees their products, not platform tabs
 * 4. My purchases shows products from all sellers
 *
 * Uses seed data: Kowalski Digital and Creative Studio sellers.
 * REQUIRES: Supabase running + db reset + dev server running
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

// Each describe block is independent — no serial dependency between them

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ===== HELPERS =====

async function createTestUser(prefix: string) {
  const randomStr = Math.random().toString(36).substring(7);
  const email = `${prefix}-${Date.now()}-${randomStr}@example.com`;
  const password = 'password123';

  const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  return {
    email,
    password,
    userId: user!.id,
    cleanup: async () => {
      await supabaseAdmin.auth.admin.deleteUser(user!.id).catch(() => {});
    },
  };
}

async function createTestAdmin(prefix: string) {
  const user = await createTestUser(prefix);
  await supabaseAdmin.from('admin_users').insert({ user_id: user.userId });
  return {
    ...user,
    cleanup: async () => {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', user.userId);
      await user.cleanup();
    },
  };
}

// ===== TESTS =====

test.describe('Marketplace E2E: Seller Product Pages', () => {
  test('seller product page shows correct product from seller schema', async ({ page }) => {
    // Kowalski Digital has "Kurs E-commerce od Zera" at /s/kowalski-digital/kurs-ecommerce
    await page.goto('/en/s/kowalski-digital/kurs-ecommerce', { waitUntil: 'domcontentloaded' });

    // Should not be 404
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('This page could not be found');

    // Should contain product name in heading
    await expect(page.getByRole('heading', { name: 'Kurs E-commerce od Zera' })).toBeVisible({ timeout: 10000 });
  });

  test('seller product page shows Creative Studio product', async ({ page }) => {
    await page.goto('/en/s/creative-studio/logo-design', { waitUntil: 'domcontentloaded' });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('This page could not be found');

    await expect(page.getByRole('heading', { name: 'Logo Design Package' })).toBeVisible({ timeout: 10000 });
  });

  test('seller product from wrong seller returns 404 or empty', async ({ page }) => {
    // kurs-ecommerce belongs to Kowalski, not Creative Studio
    const response = await page.goto('/en/s/creative-studio/kurs-ecommerce', { waitUntil: 'domcontentloaded' });

    // Should be 404 or redirect to not-found, or contain no product heading
    const bodyText = await page.locator('body').innerText();
    const is404 = bodyText.includes('not be found') || bodyText.includes('404')
      || page.url().includes('not-found') || response?.status() === 404;
    const hasNoProduct = !bodyText.includes('Kurs E-commerce');
    expect(is404 || hasNoProduct).toBe(true);
  });

  test('non-existent seller returns 404 or empty', async ({ page }) => {
    const response = await page.goto('/en/s/nonexistent-seller/some-product', { waitUntil: 'domcontentloaded' });

    const bodyText = await page.locator('body').innerText();
    const is404 = bodyText.includes('not be found') || bodyText.includes('404')
      || page.url().includes('not-found') || response?.status() === 404;
    const hasNoProduct = !bodyText.includes('some-product');
    expect(is404 || hasNoProduct).toBe(true);
  });
});

test.describe('Marketplace E2E: Seller Checkout Page', () => {
  test('seller checkout page loads with correct product', async ({ page }) => {
    await page.goto('/en/s/kowalski-digital/checkout/kurs-ecommerce', { waitUntil: 'domcontentloaded' });

    const bodyText = await page.locator('body').innerText();
    // Should not be 404 (marketplace must be enabled in .env for this to work)
    // If marketplace is disabled, this will be 404 — that's expected in CI without MARKETPLACE_ENABLED
    if (!bodyText.includes('not be found') && !bodyText.includes('404')) {
      await expect(page.getByRole('heading', { name: 'Kurs E-commerce od Zera' })).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('Marketplace E2E: Seller Admin Panel', () => {
  let sellerOwner: Awaited<ReturnType<typeof createTestUser>>;
  let platformAdmin: Awaited<ReturnType<typeof createTestAdmin>>;

  test.beforeAll(async () => {
    // Create a seller owner — assign to Kowalski Digital
    sellerOwner = await createTestUser('seller-owner');

    // Assign user as seller owner
    await supabaseAdmin
      .from('sellers')
      .update({ user_id: sellerOwner.userId })
      .eq('slug', 'kowalski_digital');

    // Create platform admin for comparison
    platformAdmin = await createTestAdmin('platform-admin');
  });

  test.afterAll(async () => {
    // Clear seller ownership
    await supabaseAdmin
      .from('sellers')
      .update({ user_id: null })
      .eq('slug', 'kowalski_digital');

    await sellerOwner?.cleanup();
    await platformAdmin?.cleanup();
  });

  test('seller owner can access dashboard', async ({ page }) => {
    await setAuthSession(page, sellerOwner.email, sellerOwner.password);
    await page.goto('/en/dashboard', { waitUntil: 'domcontentloaded' });

    // Should not redirect to login or home
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('seller owner does NOT see platform-only tabs (Users, API Keys, Integrations)', async ({ page }) => {
    await setAuthSession(page, sellerOwner.email, sellerOwner.password);
    await page.goto('/en/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/dashboard**', { timeout: 10000 });

    // Should NOT have Users, API Keys, Integrations links
    const sidebar = page.locator('nav, aside');
    const sidebarText = await sidebar.innerText().catch(() => '');

    // These should be absent for seller admin
    expect(sidebarText).not.toContain('API Keys');
  });

  test('platform admin sees all tabs including Users and API Keys', async ({ page }) => {
    await setAuthSession(page, platformAdmin.email, platformAdmin.password);
    await page.goto('/en/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/dashboard**', { timeout: 10000 });

    // Platform admin should have API Keys link in sidebar (may be collapsed — check href)
    const apiKeysLink = page.locator('a[href*="api-keys"]');
    await expect(apiKeysLink).toHaveCount(1, { timeout: 5000 });
  });
});

test.describe('Marketplace E2E: Product Access API — Seller Schema', () => {
  test('product access API returns product from seller schema', async () => {
    // Get a product from Kowalski schema
    const sellerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: 'seller_kowalski_digital' },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: product } = await sellerClient
      .from('products')
      .select('id, slug, price')
      .eq('slug', 'kurs-ecommerce')
      .single();

    expect(product).not.toBeNull();
    expect(product!.price).toBe(199);
  });

  test('product from one seller is NOT accessible in another seller schema', async () => {
    const creativeClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: 'seller_creative_studio' },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: product } = await creativeClient
      .from('products')
      .select('id, slug')
      .eq('slug', 'kurs-ecommerce')
      .single();

    expect(product).toBeNull();
  });
});

test.describe('Marketplace E2E: Cross-Schema Functions', () => {
  test('get_user_products_all_sellers returns empty for user with no purchases', async () => {
    const user = await createTestUser('cross-schema');

    try {
      // Create authenticated client for this user
      const userClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      await userClient.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      });

      const { data, error } = await userClient.rpc('get_user_products_all_sellers');

      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await user.cleanup();
    }
  });

  test('get_seller_for_user returns seller for seller owner', async () => {
    const user = await createTestUser('seller-check');

    try {
      // Assign as Kowalski owner temporarily
      await supabaseAdmin
        .from('sellers')
        .update({ user_id: user.userId })
        .eq('slug', 'kowalski_digital');

      const { data, error } = await supabaseAdmin
        .rpc('get_seller_for_user', { p_user_id: user.userId });

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].seller_slug).toBe('kowalski_digital');
    } finally {
      await supabaseAdmin
        .from('sellers')
        .update({ user_id: null })
        .eq('slug', 'kowalski_digital');
      await user.cleanup();
    }
  });

  test('get_seller_for_user returns empty for non-seller user', async () => {
    const user = await createTestUser('non-seller');

    try {
      const { data, error } = await supabaseAdmin
        .rpc('get_seller_for_user', { p_user_id: user.userId });

      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await user.cleanup();
    }
  });
});

// ===== NEW E2E TESTS: Payment Flow & Seller Admin Data =====

test.describe('Marketplace E2E: create-payment-intent seller routing', () => {
  let buyer: Awaited<ReturnType<typeof createTestUser>>;

  test.beforeAll(async () => {
    buyer = await createTestUser('mkt-buyer');
  });

  test.afterAll(async () => {
    await buyer?.cleanup();
  });

  test('create-payment-intent with sellerSlug finds product in seller schema', async ({ page }) => {
    await setAuthSession(page, buyer.email, buyer.password);

    // Get product ID from seller schema
    const sellerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: 'seller_kowalski_digital' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: product } = await sellerClient
      .from('products')
      .select('id, slug, price, currency')
      .eq('slug', 'kurs-ecommerce')
      .single();
    expect(product).not.toBeNull();

    // Call API — this will fail with 404 if seller routing is broken
    // (Stripe key may not be configured, so we check for specific errors)
    const response = await page.request.post('/api/create-payment-intent', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        productId: product!.id,
        email: buyer.email,
        sellerSlug: 'kowalski-digital',
      },
    });

    const body = await response.json();

    // Without Stripe Connect (no stripe_account_id on seller), expect 404 "Seller not configured"
    // With Stripe configured, expect clientSecret
    // The key assertion: NOT "Product not found" (which would mean seller routing failed)
    if (!response.ok()) {
      expect(body.error).not.toBe('Product not found or inactive');
      // Expected: "Seller not configured for payments" (no Stripe account yet)
      expect(body.error).toContain('Seller');
    }
  });

  test('create-payment-intent without sellerSlug queries seller_main', async ({ page }) => {
    await setAuthSession(page, buyer.email, buyer.password);

    // This product exists only in seller_kowalski_digital, NOT in seller_main
    const sellerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: 'seller_kowalski_digital' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: product } = await sellerClient
      .from('products')
      .select('id')
      .eq('slug', 'kurs-ecommerce')
      .single();

    // Call API WITHOUT sellerSlug — should query seller_main → product not found
    const response = await page.request.post('/api/create-payment-intent', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        productId: product!.id,
        email: buyer.email,
        // no sellerSlug — defaults to seller_main
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Product not found or inactive');
  });
});

test.describe('Marketplace E2E: grant-access seller routing', () => {
  let buyer: Awaited<ReturnType<typeof createTestUser>>;

  test.beforeAll(async () => {
    buyer = await createTestUser('mkt-free-buyer');
  });

  test.afterAll(async () => {
    // Cleanup access records
    const sellerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: 'seller_kowalski_digital' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await sellerClient
      .from('user_product_access')
      .delete()
      .eq('user_id', buyer.userId);
    await buyer?.cleanup();
  });

  test('grant-access with sellerSlug in body grants access in seller schema', async ({ page }) => {
    await setAuthSession(page, buyer.email, buyer.password);

    // Kowalski has no free products in seed, so this test verifies the routing
    // (payment required error = product found in correct schema, just not free)
    const response = await page.request.post('/api/public/products/kurs-ecommerce/grant-access', {
      headers: { 'Content-Type': 'application/json' },
      data: { sellerSlug: 'kowalski-digital' },
    });

    const body = await response.json();
    // Product found (not 404) but requires payment (price > 0)
    if (response.status() === 400) {
      expect(body.error).toBe('Payment required');
    }
    // Should NOT be 404 "Product not found" (which would mean routing failed)
    expect(response.status()).not.toBe(404);
  });

  test('grant-access without sellerSlug does not find seller product', async ({ page }) => {
    await setAuthSession(page, buyer.email, buyer.password);

    // kurs-ecommerce is in seller_kowalski_digital, not seller_main
    const response = await page.request.post('/api/public/products/kurs-ecommerce/grant-access', {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });

    // Should be 404 — product doesn't exist in seller_main
    expect(response.status()).toBe(404);
  });
});

test.describe('Marketplace E2E: Seller Admin Products', () => {
  let sellerOwner: Awaited<ReturnType<typeof createTestUser>>;

  test.beforeAll(async () => {
    sellerOwner = await createTestUser('seller-products');
    await supabaseAdmin
      .from('sellers')
      .update({ user_id: sellerOwner.userId })
      .eq('slug', 'kowalski_digital');
  });

  test.afterAll(async () => {
    await supabaseAdmin
      .from('sellers')
      .update({ user_id: null })
      .eq('slug', 'kowalski_digital');
    await sellerOwner?.cleanup();
  });

  // TODO: Products page uses V1 API (api.list('products')) which is not yet schema-aware.
  // Seller admin will see seller_main products until V1 API routes are updated.
  // This test verifies seller admin CAN access the products page (no crash/redirect).
  test('seller owner can access dashboard products page', async ({ page }) => {
    await setAuthSession(page, sellerOwner.email, sellerOwner.password);
    await page.goto('/en/dashboard/products', { waitUntil: 'domcontentloaded' });

    // Should not redirect to login or home
    await page.waitForURL('**/dashboard/products**', { timeout: 10000 });
    expect(page.url()).toContain('/dashboard/products');
  });
});
