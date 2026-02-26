/**
 * Tests for Order Bumps API v1
 *
 * Tests CRUD operations, validation, authentication, and authorization.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to login as admin via browser context
async function loginAsAdmin(page: any, email: string, password: string) {
  await page.goto('/login');

  await page.evaluate(async ({ email, password, url, anonKey }: { email: string; password: string; url: string; anonKey: string }) => {
    // @ts-ignore
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const sb = createBrowserClient(url, anonKey);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, {
    email,
    password,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  });

  await page.reload();
}

test.describe('Order Bumps API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let mainProduct: any;
  let bumpProduct: any;
  const testOrderBumps: string[] = [];

  test.beforeAll(async () => {
    // Create admin user for all tests
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `order-bump-api-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Order Bump API Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // Make user an admin
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create test products
    const { data: main, error: mainErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Main Product ${randomStr}`,
        slug: `main-product-${randomStr}`,
        price: 100.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (mainErr) throw mainErr;
    mainProduct = main;

    const { data: bump, error: bumpErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Bump Product ${randomStr}`,
        slug: `bump-product-${randomStr}`,
        price: 20.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (bumpErr) throw bumpErr;
    bumpProduct = bump;
  });

  test.afterAll(async () => {
    // Cleanup test order bumps
    for (const orderBumpId of testOrderBumps) {
      await supabaseAdmin.from('order_bumps').delete().eq('id', orderBumpId);
    }

    // Cleanup test products
    if (bumpProduct) {
      await supabaseAdmin.from('products').delete().eq('id', bumpProduct.id);
    }
    if (mainProduct) {
      await supabaseAdmin.from('products').delete().eq('id', mainProduct.id);
    }

    // Cleanup admin user
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated GET requests', async ({ request }) => {
      const response = await request.get('/api/v1/order-bumps');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for unauthenticated POST requests', async ({ request }) => {
      const response = await request.post('/api/v1/order-bumps', {
        data: {
          main_product_id: mainProduct?.id,
          bump_product_id: bumpProduct?.id,
          bump_title: 'Test Bump',
        }
      });

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  test.describe('GET /api/v1/order-bumps', () => {
    test('should return order bumps list', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/order-bumps');

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
    });

    test('should filter by product_id', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create an order bump first
      const createResponse = await page.request.post('/api/v1/order-bumps', {
        data: {
          main_product_id: mainProduct.id,
          bump_product_id: bumpProduct.id,
          bump_title: 'Filter Test Bump',
          bump_price: 15.00,
        }
      });
      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json();
      testOrderBumps.push(created.data.id);

      // Filter by product_id
      const response = await page.request.get(`/api/v1/order-bumps?product_id=${mainProduct.id}`);

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      const matchingBumps = body.data.filter((ob: any) => ob.main_product_id === mainProduct.id);
      expect(matchingBumps.length).toBeGreaterThanOrEqual(1);
    });

    test('should return 400 for invalid product_id format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/order-bumps?product_id=invalid-uuid');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('POST /api/v1/order-bumps', () => {
    test('should create order bump with required fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a unique bump product for this test to avoid conflicts
      const randomStr = Math.random().toString(36).substring(7);
      const { data: uniqueBump } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Unique Bump ${randomStr}`,
          slug: `unique-bump-${randomStr}`,
          price: 15.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const response = await page.request.post('/api/v1/order-bumps', {
        data: {
          main_product_id: mainProduct.id,
          bump_product_id: uniqueBump!.id,
          bump_title: 'Created via API Test',
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body.data.main_product_id).toBe(mainProduct.id);
      expect(body.data.bump_product_id).toBe(uniqueBump!.id);
      expect(body.data.bump_title).toBe('Created via API Test');

      // Cleanup: delete order bump then product
      await supabaseAdmin.from('order_bumps').delete().eq('id', body.data.id);
      await supabaseAdmin.from('products').delete().eq('id', uniqueBump!.id);
    });

    test('should create order bump with all fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create another bump product for this test
      const randomStr = Math.random().toString(36).substring(7);
      const { data: anotherBump } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Another Bump ${randomStr}`,
          slug: `another-bump-${randomStr}`,
          price: 30.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const response = await page.request.post('/api/v1/order-bumps', {
        data: {
          main_product_id: mainProduct.id,
          bump_product_id: anotherBump!.id,
          bump_title: 'Full Test Bump',
          bump_price: 25.00,
          bump_description: 'A great addition!',
          is_active: true,
          display_order: 1,
          access_duration_days: 30,
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body.data.bump_price).toBe(25.00);
      expect(body.data.bump_description).toBe('A great addition!');
      expect(body.data.display_order).toBe(1);
      expect(body.data.access_duration_days).toBe(30);
      testOrderBumps.push(body.data.id);

      // Cleanup extra product
      await supabaseAdmin.from('order_bumps').delete().eq('id', body.data.id);
      await supabaseAdmin.from('products').delete().eq('id', anotherBump!.id);
      testOrderBumps.pop();
    });

    test('should return 400 for missing required fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/order-bumps', {
        data: {
          main_product_id: mainProduct.id,
          // Missing bump_product_id and bump_title
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 for invalid main_product_id format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/order-bumps', {
        data: {
          main_product_id: 'invalid-uuid',
          bump_product_id: bumpProduct.id,
          bump_title: 'Invalid Test',
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 400 for non-existent product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/order-bumps', {
        data: {
          main_product_id: '00000000-0000-0000-0000-000000000000',
          bump_product_id: bumpProduct.id,
          bump_title: 'Non-existent Product Test',
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('not found');
    });

    test('should return 400 for inactive main product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create inactive product
      const randomStr = Math.random().toString(36).substring(7);
      const { data: inactiveProduct } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Inactive Product ${randomStr}`,
          slug: `inactive-product-${randomStr}`,
          price: 50.00,
          currency: 'USD',
          is_active: false,
        })
        .select()
        .single();

      try {
        const response = await page.request.post('/api/v1/order-bumps', {
          data: {
            main_product_id: inactiveProduct!.id,
            bump_product_id: bumpProduct.id,
            bump_title: 'Inactive Main Test',
          }
        });

        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(body.error.message).toContain('inactive');
      } finally {
        await supabaseAdmin.from('products').delete().eq('id', inactiveProduct!.id);
      }
    });

    test('should return 400 for negative bump_price', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create another product for this test
      const randomStr = Math.random().toString(36).substring(7);
      const { data: testProduct } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Price Test Bump ${randomStr}`,
          slug: `price-test-bump-${randomStr}`,
          price: 10.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const response = await page.request.post('/api/v1/order-bumps', {
          data: {
            main_product_id: mainProduct.id,
            bump_product_id: testProduct!.id,
            bump_title: 'Negative Price Test',
            bump_price: -10.00,
          }
        });

        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.error.code).toBe('VALIDATION_ERROR');
        // Error message may vary - just ensure we got a validation error
      } finally {
        await supabaseAdmin.from('products').delete().eq('id', testProduct!.id);
      }
    });

    test('should return 409 for duplicate order bump', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create first order bump
      const randomStr = Math.random().toString(36).substring(7);
      const { data: dupBump } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Dup Bump ${randomStr}`,
          slug: `dup-bump-${randomStr}`,
          price: 15.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const firstResponse = await page.request.post('/api/v1/order-bumps', {
        data: {
          main_product_id: mainProduct.id,
          bump_product_id: dupBump!.id,
          bump_title: 'First Bump',
        }
      });
      expect(firstResponse.status()).toBe(201);
      const first = await firstResponse.json();
      testOrderBumps.push(first.data.id);

      try {
        // Try to create duplicate
        const response = await page.request.post('/api/v1/order-bumps', {
          data: {
            main_product_id: mainProduct.id,
            bump_product_id: dupBump!.id,
            bump_title: 'Duplicate Bump',
          }
        });

        expect(response.status()).toBe(409);
        const body = await response.json();
        expect(body.error.code).toBe('CONFLICT');
      } finally {
        await supabaseAdmin.from('order_bumps').delete().eq('id', first.data.id);
        await supabaseAdmin.from('products').delete().eq('id', dupBump!.id);
        testOrderBumps.pop();
      }
    });
  });

  test.describe('GET /api/v1/order-bumps/:id', () => {
    let testOrderBump: any;

    test.beforeAll(async () => {
      // Create a test order bump
      const randomStr = Math.random().toString(36).substring(7);
      const { data: bump } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Get Test Bump ${randomStr}`,
          slug: `get-test-bump-${randomStr}`,
          price: 12.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: ob } = await supabaseAdmin
        .from('order_bumps')
        .insert({
          main_product_id: mainProduct.id,
          bump_product_id: bump!.id,
          bump_title: 'Get Test Bump',
          bump_price: 10.00,
        })
        .select()
        .single();

      testOrderBump = { ...ob, bumpProductId: bump!.id };
      testOrderBumps.push(ob!.id);
    });

    test.afterAll(async () => {
      if (testOrderBump) {
        await supabaseAdmin.from('order_bumps').delete().eq('id', testOrderBump.id);
        await supabaseAdmin.from('products').delete().eq('id', testOrderBump.bumpProductId);
        const idx = testOrderBumps.indexOf(testOrderBump.id);
        if (idx > -1) testOrderBumps.splice(idx, 1);
      }
    });

    test('should return order bump by ID', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/order-bumps/${testOrderBump.id}`);

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.id).toBe(testOrderBump.id);
      expect(body.data.bump_title).toBe('Get Test Bump');
      expect(body.data.main_product).toBeDefined();
      expect(body.data.bump_product).toBeDefined();
    });

    test('should return 404 for non-existent order bump', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/order-bumps/00000000-0000-0000-0000-000000000000');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid UUID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/order-bumps/invalid-uuid');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('PATCH /api/v1/order-bumps/:id', () => {
    let updateTestBump: any;

    test.beforeAll(async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: bump } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Update Test Bump ${randomStr}`,
          slug: `update-test-bump-${randomStr}`,
          price: 18.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: ob } = await supabaseAdmin
        .from('order_bumps')
        .insert({
          main_product_id: mainProduct.id,
          bump_product_id: bump!.id,
          bump_title: 'Original Title',
          bump_price: 15.00,
          is_active: true,
        })
        .select()
        .single();

      updateTestBump = { ...ob, bumpProductId: bump!.id };
      testOrderBumps.push(ob!.id);
    });

    test.afterAll(async () => {
      if (updateTestBump) {
        await supabaseAdmin.from('order_bumps').delete().eq('id', updateTestBump.id);
        await supabaseAdmin.from('products').delete().eq('id', updateTestBump.bumpProductId);
        const idx = testOrderBumps.indexOf(updateTestBump.id);
        if (idx > -1) testOrderBumps.splice(idx, 1);
      }
    });

    test('should update order bump title', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch(`/api/v1/order-bumps/${updateTestBump.id}`, {
        data: {
          bump_title: 'Updated Title',
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.bump_title).toBe('Updated Title');
    });

    test('should update order bump price', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch(`/api/v1/order-bumps/${updateTestBump.id}`, {
        data: {
          bump_price: 12.50,
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.bump_price).toBe(12.50);
    });

    test('should update order bump is_active', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch(`/api/v1/order-bumps/${updateTestBump.id}`, {
        data: {
          is_active: false,
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.is_active).toBe(false);

      // Restore for other tests
      await page.request.patch(`/api/v1/order-bumps/${updateTestBump.id}`, {
        data: { is_active: true }
      });
    });

    test('should return 404 for non-existent order bump', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch('/api/v1/order-bumps/00000000-0000-0000-0000-000000000000', {
        data: { bump_title: 'Should Fail' }
      });

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid UUID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch('/api/v1/order-bumps/invalid-uuid', {
        data: { bump_title: 'Should Fail' }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 400 for negative bump_price', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch(`/api/v1/order-bumps/${updateTestBump.id}`, {
        data: { bump_price: -5.00 }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  test.describe('DELETE /api/v1/order-bumps/:id', () => {
    test('should delete order bump', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a bump to delete
      const randomStr = Math.random().toString(36).substring(7);
      const { data: delBump } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Delete Test Bump ${randomStr}`,
          slug: `delete-test-bump-${randomStr}`,
          price: 8.00,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: ob } = await supabaseAdmin
        .from('order_bumps')
        .insert({
          main_product_id: mainProduct.id,
          bump_product_id: delBump!.id,
          bump_title: 'To Be Deleted',
        })
        .select()
        .single();

      // Delete it
      const response = await page.request.delete(`/api/v1/order-bumps/${ob!.id}`);
      expect(response.status()).toBe(204);

      // Verify it's gone
      const checkResponse = await page.request.get(`/api/v1/order-bumps/${ob!.id}`);
      expect(checkResponse.status()).toBe(404);

      // Cleanup product
      await supabaseAdmin.from('products').delete().eq('id', delBump!.id);
    });

    test('should return 404 for non-existent order bump', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.delete('/api/v1/order-bumps/00000000-0000-0000-0000-000000000000');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid UUID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.delete('/api/v1/order-bumps/invalid-uuid');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });
});

// =============================================================================
// IDOR TESTS
// =============================================================================

test.describe('Order Bumps API v1 - IDOR Tests', () => {
  let adminUser1: { id: string; email: string };
  let adminUser2: { id: string; email: string };
  const password = 'TestPassword123!';
  let product1: any;
  let product2: any;
  let bumpProduct: any;
  let orderBump1: any;

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create two admin users
    const { data: { user: user1 } } = await supabaseAdmin.auth.admin.createUser({
      email: `idor-admin1-${randomStr}@example.com`,
      password,
      email_confirm: true,
    });
    adminUser1 = { id: user1!.id, email: `idor-admin1-${randomStr}@example.com` };
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUser1.id });

    const { data: { user: user2 } } = await supabaseAdmin.auth.admin.createUser({
      email: `idor-admin2-${randomStr}@example.com`,
      password,
      email_confirm: true,
    });
    adminUser2 = { id: user2!.id, email: `idor-admin2-${randomStr}@example.com` };
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUser2.id });

    // Create test products and order bump
    const { data: p1 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `IDOR Main ${randomStr}`,
        slug: `idor-main-${randomStr}`,
        price: 50.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    product1 = p1;

    const { data: bp } = await supabaseAdmin
      .from('products')
      .insert({
        name: `IDOR Bump ${randomStr}`,
        slug: `idor-bump-${randomStr}`,
        price: 10.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    bumpProduct = bp;

    const { data: ob } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: product1.id,
        bump_product_id: bumpProduct.id,
        bump_title: 'IDOR Test Bump',
        bump_price: 8.00,
      })
      .select()
      .single();
    orderBump1 = ob;
  });

  test.afterAll(async () => {
    if (orderBump1) {
      await supabaseAdmin.from('order_bumps').delete().eq('id', orderBump1.id);
    }
    if (bumpProduct) {
      await supabaseAdmin.from('products').delete().eq('id', bumpProduct.id);
    }
    if (product1) {
      await supabaseAdmin.from('products').delete().eq('id', product1.id);
    }
    if (adminUser1) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUser1.id);
      await supabaseAdmin.auth.admin.deleteUser(adminUser1.id);
    }
    if (adminUser2) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUser2.id);
      await supabaseAdmin.auth.admin.deleteUser(adminUser2.id);
    }
  });

  test('both admins can view order bumps (shared resource)', async ({ page }) => {
    // In GateFlow, order bumps are global admin resources, not per-user
    // Both admins should be able to view them
    await loginAsAdmin(page, adminUser1.email, password);

    const response = await page.request.get(`/api/v1/order-bumps/${orderBump1.id}`);
    expect(response.status()).toBe(200);

    // Login as second admin
    await loginAsAdmin(page, adminUser2.email, password);

    const response2 = await page.request.get(`/api/v1/order-bumps/${orderBump1.id}`);
    expect(response2.status()).toBe(200);
  });

  test('non-admin user should not access order bumps', async ({ page }) => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create a regular (non-admin) user
    const { data: { user: regularUser } } = await supabaseAdmin.auth.admin.createUser({
      email: `regular-user-${randomStr}@example.com`,
      password,
      email_confirm: true,
    });

    try {
      await loginAsAdmin(page, `regular-user-${randomStr}@example.com`, password);

      const response = await page.request.get('/api/v1/order-bumps');
      // Should be 401 or 403 for non-admin
      expect([401, 403]).toContain(response.status());
    } finally {
      await supabaseAdmin.auth.admin.deleteUser(regularUser!.id);
    }
  });
});
