/**
 * V1 API Seller Permissions Tests
 *
 * Verifies that seller admin (via session auth) can:
 * - Access their own products, coupons, order bumps, payments, users
 * - NOT see platform owner (seller_main) data
 * - Manage users within their own schema
 *
 * Uses seed data: Kowalski Digital seller with products.
 * REQUIRES: Supabase running + db reset + dev server running
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ===== SETUP =====

let sellerOwnerEmail: string;
let sellerOwnerPassword: string;
let sellerOwnerUserId: string;
let platformAdminEmail: string;
let platformAdminPassword: string;
let platformAdminUserId: string;

test.beforeAll(async () => {
  const rnd = Math.random().toString(36).substring(7);
  sellerOwnerPassword = 'password123';
  platformAdminPassword = 'password123';

  // Create seller owner user
  sellerOwnerEmail = `seller-v1-${Date.now()}-${rnd}@example.com`;
  const { data: { user: sellerUser }, error: sellerErr } = await supabaseAdmin.auth.admin.createUser({
    email: sellerOwnerEmail,
    password: sellerOwnerPassword,
    email_confirm: true,
  });
  if (sellerErr) throw sellerErr;
  sellerOwnerUserId = sellerUser!.id;

  // Assign as Kowalski Digital owner
  await supabaseAdmin
    .from('sellers')
    .update({ user_id: sellerOwnerUserId })
    .eq('slug', 'kowalski_digital');

  // Create platform admin
  platformAdminEmail = `platform-v1-${Date.now()}-${rnd}@example.com`;
  const { data: { user: adminUser }, error: adminErr } = await supabaseAdmin.auth.admin.createUser({
    email: platformAdminEmail,
    password: platformAdminPassword,
    email_confirm: true,
  });
  if (adminErr) throw adminErr;
  platformAdminUserId = adminUser!.id;
  await supabaseAdmin.from('admin_users').insert({ user_id: platformAdminUserId });
});

test.afterAll(async () => {
  // Restore original seller ownership (seed user)
  await supabaseAdmin
    .from('sellers')
    .update({ user_id: 'eeeeeeee-1111-4000-a000-000000000001' })
    .eq('slug', 'kowalski_digital');

  // Cleanup seller API keys
  const { data: kowalskiSeller } = await supabaseAdmin
    .from('sellers')
    .select('id')
    .eq('slug', 'kowalski_digital')
    .single();
  if (kowalskiSeller) {
    await supabaseAdmin.from('api_keys').delete().eq('seller_id', kowalskiSeller.id);
  }

  // Cleanup users
  await supabaseAdmin.from('admin_users').delete().eq('user_id', platformAdminUserId);
  await supabaseAdmin.auth.admin.deleteUser(sellerOwnerUserId).catch(() => {});
  await supabaseAdmin.auth.admin.deleteUser(platformAdminUserId).catch(() => {});
});

// ===== SELLER ADMIN: ACCESS OWN DATA =====

test.describe('Seller admin V1 API - own data access', () => {
  test('seller can list their own products via V1 API', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.get('/api/v1/products');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data).toBeDefined();

    // Should see Kowalski Digital products
    const productNames = body.data.map((p: { name: string }) => p.name);
    expect(productNames).toContain('Kurs E-commerce od Zera');
  });

  test('seller sees ONLY their products, NOT seller_main products', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.get('/api/v1/products');
    const body = await response.json();

    const productNames = body.data.map((p: { name: string }) => p.name);

    // Should have Kowalski products
    expect(productNames).toContain('Kurs E-commerce od Zera');

    // Should NOT have seller_main products (e.g., seed products from seller_main)
    // Kowalski has: kurs-ecommerce, szablon-sklepu, konsultacja, pakiet-start
    // All returned products should be from Kowalski's schema
    for (const name of productNames) {
      const isKowalskiProduct = [
        'Kurs E-commerce od Zera',
        'Szablon Sklepu Premium',
        'Konsultacja 1:1',
        'Pakiet Start',
        'Darmowy Poradnik E-commerce',
      ].includes(name);
      expect(isKowalskiProduct, `Unexpected product "${name}" - should only see Kowalski products`).toBe(true);
    }
  });

  test('seller can list their own order bumps', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.get('/api/v1/order-bumps');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('seller can view payment stats', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.get('/api/v1/payments/stats');
    expect(response.status()).toBe(200);
  });

  test('seller can view analytics dashboard', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.get('/api/v1/analytics/dashboard');
    expect(response.status()).toBe(200);
  });
});

// ===== SELLER ADMIN: USER MANAGEMENT (OWN SCHEMA) =====

test.describe('Seller admin V1 API - user management', () => {
  // Test users created per-describe for deterministic data
  let sellerBuyerUserId: string;
  let platformBuyerUserId: string;
  let sellerProductId: string;

  test.beforeAll(async () => {
    const rnd = Math.random().toString(36).substring(7);

    // Create a buyer and grant access in SELLER schema (seller_kowalski_digital)
    const { data: { user: sellerBuyer } } = await supabaseAdmin.auth.admin.createUser({
      email: `seller-buyer-${Date.now()}-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    sellerBuyerUserId = sellerBuyer!.id;

    // Get a product from seller's schema
    const sellerSchema = 'seller_kowalski_digital';
    const { data: products } = await supabaseAdmin
      .schema(sellerSchema)
      .from('products')
      .select('id')
      .eq('is_active', true)
      .limit(1);
    sellerProductId = products![0].id;

    // Grant access in seller schema
    await supabaseAdmin
      .schema(sellerSchema)
      .from('user_product_access')
      .insert({ user_id: sellerBuyerUserId, product_id: sellerProductId });

    // Create a buyer and grant access in PLATFORM schema (seller_main)
    const { data: { user: platformBuyer } } = await supabaseAdmin.auth.admin.createUser({
      email: `platform-buyer-${Date.now()}-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    platformBuyerUserId = platformBuyer!.id;

    const { data: mainProducts } = await supabaseAdmin
      .schema('seller_main')
      .from('products')
      .select('id')
      .eq('is_active', true)
      .limit(1);
    if (mainProducts && mainProducts.length > 0) {
      await supabaseAdmin
        .schema('seller_main')
        .from('user_product_access')
        .insert({ user_id: platformBuyerUserId, product_id: mainProducts[0].id });
    }
  });

  test.afterAll(async () => {
    // Cleanup access + users (ignore errors from already-deleted records)
    try {
      await supabaseAdmin
        .schema('seller_kowalski_digital')
        .from('user_product_access')
        .delete()
        .eq('user_id', sellerBuyerUserId);
    } catch { /* ignore */ }
    try {
      await supabaseAdmin
        .schema('seller_main')
        .from('user_product_access')
        .delete()
        .eq('user_id', platformBuyerUserId);
    } catch { /* ignore */ }
    try { await supabaseAdmin.auth.admin.deleteUser(sellerBuyerUserId); } catch { /* ignore */ }
    try { await supabaseAdmin.auth.admin.deleteUser(platformBuyerUserId); } catch { /* ignore */ }
  });

  test('seller CAN list users from their schema', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.get('/api/v1/users');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    // Must have at least the buyer we created in beforeAll
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('seller can view a specific user by ID', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    // Use the known buyer we created
    const response = await page.request.get(`/api/v1/users/${sellerBuyerUserId}`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.id).toBe(sellerBuyerUserId);
  });

  test('seller sees ONLY their schema users, NOT seller_main users', async ({ page }) => {
    // Seller's list
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);
    const sellerResponse = await page.request.get('/api/v1/users');
    const sellerBody = await sellerResponse.json();
    const sellerUserIds = sellerBody.data.map((u: { id: string }) => u.id);

    // Seller MUST see the buyer we added to their schema
    expect(sellerUserIds, 'Seller must see buyer from their schema').toContain(sellerBuyerUserId);

    // Seller must NOT see the buyer we added to seller_main
    expect(sellerUserIds, 'Seller must NOT see buyer from seller_main').not.toContain(platformBuyerUserId);
  });

  test('platform admin sees ONLY seller_main users, NOT seller schema users', async ({ page }) => {
    await setAuthSession(page, platformAdminEmail, platformAdminPassword);
    const adminResponse = await page.request.get('/api/v1/users');
    const adminBody = await adminResponse.json();
    const adminUserIds = adminBody.data.map((u: { id: string }) => u.id);

    // Platform admin MUST see the buyer we added to seller_main
    expect(adminUserIds, 'Platform admin must see buyer from seller_main').toContain(platformBuyerUserId);

    // Platform admin must NOT see the buyer from seller schema
    expect(adminUserIds, 'Platform admin must NOT see buyer from seller schema').not.toContain(sellerBuyerUserId);
  });

  test('seller can grant access to their product for a user', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    // Create a fresh test user
    const rnd = Math.random().toString(36).substring(7);
    const testBuyerEmail = `buyer-grant-${Date.now()}-${rnd}@example.com`;
    const { data: { user: buyerUser }, error: buyerErr } = await supabaseAdmin.auth.admin.createUser({
      email: testBuyerEmail,
      password: 'password123',
      email_confirm: true,
    });
    expect(buyerErr).toBeNull();

    try {
      // Grant access via seller's API
      const grantResponse = await page.request.post(`/api/v1/users/${buyerUser!.id}/access`, {
        headers: { 'Content-Type': 'application/json' },
        data: { product_id: sellerProductId },
      });
      expect(grantResponse.status()).toBe(201);

      const grantBody = await grantResponse.json();
      expect(grantBody.data.product_id).toBe(sellerProductId);
      expect(grantBody.data.user_id).toBe(buyerUser!.id);

      // Verify the user now appears in seller's user list
      const listResponse = await page.request.get('/api/v1/users');
      const listBody = await listResponse.json();
      const userIds = listBody.data.map((u: { id: string }) => u.id);
      expect(userIds, 'Newly granted user must appear in seller user list').toContain(buyerUser!.id);
    } finally {
      // Cleanup
      try {
        await supabaseAdmin
          .schema('seller_kowalski_digital')
          .from('user_product_access')
          .delete()
          .eq('user_id', buyerUser!.id);
      } catch { /* ignore */ }
      try { await supabaseAdmin.auth.admin.deleteUser(buyerUser!.id); } catch { /* ignore */ }
    }
  });

  test('seller cannot see user from another seller schema via direct ID', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    // Try to view the platform buyer directly — should 404 (not in seller's schema)
    const response = await page.request.get(`/api/v1/users/${platformBuyerUserId}`);
    expect(response.status()).toBe(404);
  });
});

// ===== SELLER ADMIN: OWN API KEYS =====

test.describe('Seller admin V1 API - API keys management', () => {
  test('seller can list their own API keys', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.get('/api/v1/api-keys');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data).toBeDefined();
    // Array of keys (may be empty or have leftover keys from previous runs)
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('seller can create an API key scoped to their schema', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.post('/api/v1/api-keys', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        name: 'Kowalski Test Key',
        scopes: ['products:read', 'analytics:read'],
      },
    });

    expect(response.status()).toBe(201);

    const body = await response.json();
    expect(body.data).toBeDefined();
    expect(body.data.name).toBe('Kowalski Test Key');
    // Key should have been created — key_prefix starts with sf_
    expect(body.data.key_prefix).toBeTruthy();
  });

  test('seller sees only their own key after creation', async ({ page }) => {
    await setAuthSession(page, sellerOwnerEmail, sellerOwnerPassword);

    const response = await page.request.get('/api/v1/api-keys');
    const body = await response.json();

    // Should see the key we just created
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].name).toBe('Kowalski Test Key');
  });
});

// ===== PLATFORM ADMIN: FULL ACCESS =====

test.describe('Platform admin V1 API - full access', () => {
  test('platform admin can list seller_main products', async ({ page }) => {
    await setAuthSession(page, platformAdminEmail, platformAdminPassword);

    const response = await page.request.get('/api/v1/products');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data).toBeDefined();
  });

  test('platform admin can list users', async ({ page }) => {
    await setAuthSession(page, platformAdminEmail, platformAdminPassword);

    const response = await page.request.get('/api/v1/users');
    expect(response.status()).toBe(200);
  });

  test('platform admin can manage API keys', async ({ page }) => {
    await setAuthSession(page, platformAdminEmail, platformAdminPassword);

    const response = await page.request.get('/api/v1/api-keys');
    expect(response.status()).toBe(200);
  });
});

// ===== UNAUTHENTICATED: ALL BLOCKED =====

test.describe('Unauthenticated V1 API - all blocked', () => {
  test('unauthenticated user cannot access products API', async ({ page }) => {
    // No auth session set
    const response = await page.request.get('/api/v1/products');
    expect(response.status()).toBe(401);
  });

  test('unauthenticated user cannot access payments API', async ({ page }) => {
    const response = await page.request.get('/api/v1/payments');
    expect(response.status()).toBe(401);
  });
});

// ===== REGULAR USER (NOT ADMIN, NOT SELLER): ALL BLOCKED =====

test.describe('Regular user V1 API - all blocked', () => {
  let regularEmail: string;
  let regularUserId: string;
  const regularPassword = 'password123';

  test.beforeAll(async () => {
    const rnd = Math.random().toString(36).substring(7);
    regularEmail = `regular-v1-${Date.now()}-${rnd}@example.com`;
    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: regularEmail,
      password: regularPassword,
      email_confirm: true,
    });
    if (error) throw error;
    regularUserId = user!.id;
  });

  test.afterAll(async () => {
    await supabaseAdmin.auth.admin.deleteUser(regularUserId).catch(() => {});
  });

  test('regular user (not admin, not seller) gets 401 or 403', async ({ page }) => {
    await setAuthSession(page, regularEmail, regularPassword);

    const response = await page.request.get('/api/v1/products');
    // V1 middleware: session auth fails for non-admin/non-seller → returns null → 401
    expect([401, 403]).toContain(response.status());
  });
});
