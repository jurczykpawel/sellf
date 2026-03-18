/**
 * Tests for Users API v1
 *
 * Tests user listing, access management, and error handling.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to create unique slug
const uniqueSlug = () => `test-product-${Date.now()}-${Math.random().toString(36).substring(7)}`;

// Helper to login as admin via browser context
async function loginAsAdmin(page: any, email: string, password: string) {
  await page.goto('/login');

  await setAuthSession(page, email, password);

  await page.reload();
}

test.describe('Users API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';

  // Test user for access management tests
  let testUserId: string;
  let testUserEmail: string;

  // Test product for access tests
  let testProductId: string;

  // Cleanup arrays
  const createdAccessIds: string[] = [];

  test.beforeAll(async () => {
    // Create admin user
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `api-v1-users-test-${randomStr}@example.com`;

    const { data: { user: adminUser }, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'API v1 Users Tester' }
    });

    if (adminError) throw adminError;
    adminUserId = adminUser!.id;

    // Make user an admin
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create a test user (non-admin) for access management tests
    testUserEmail = `test-user-${randomStr}@example.com`;
    const { data: { user: testUser }, error: testUserError } = await supabaseAdmin.auth.admin.createUser({
      email: testUserEmail,
      password: 'TestPassword123!',
      email_confirm: true,
      user_metadata: { full_name: 'Test User' }
    });

    if (testUserError) throw testUserError;
    testUserId = testUser!.id;

    // Create a test product for access tests
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Test Product for Access',
        slug: uniqueSlug(),
        description: 'Product for testing user access',
        price: 29.99,
        is_active: true,
      })
      .select()
      .single();

    if (productError) throw productError;
    testProductId = product.id;

    // Grant access so user appears in seller_customer_stats (INNER JOIN view)
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .insert({ user_id: testUserId, product_id: testProductId })
      .select('id')
      .single();
    if (access) createdAccessIds.push(access.id);
  });

  test.afterAll(async () => {
    // Cleanup created access entries
    for (const accessId of createdAccessIds) {
      await supabaseAdmin.from('user_product_access').delete().eq('id', accessId);
    }

    // Cleanup test product
    if (testProductId) {
      await supabaseAdmin.from('products').delete().eq('id', testProductId);
    }

    // Cleanup test user
    if (testUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testUserId);
    }

    // Cleanup admin user
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.get('/api/v1/users');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  test.describe('GET /api/v1/users', () => {
    test('should return users list with pagination', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/users');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toHaveProperty('cursor');
      expect(body.pagination).toHaveProperty('next_cursor');
      expect(body.pagination).toHaveProperty('has_more');
      expect(body.pagination).toHaveProperty('limit');
    });

    test('should include user stats in response', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/users');

      expect(response.status()).toBe(200);
      const body = await response.json();

      if (body.data.length > 0) {
        const user = body.data[0];
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(user).toHaveProperty('stats');
        expect(user.stats).toHaveProperty('total_products');
        expect(user.stats).toHaveProperty('total_value');
      }
    });

    test('should support search by email', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/users?search=${testUserEmail}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.some((u: any) => u.email === testUserEmail)).toBe(true);
    });

    test('should respect limit parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/users?limit=5');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.pagination.limit).toBe(5);
      expect(body.data.length).toBeLessThanOrEqual(5);
    });
  });

  test.describe('GET /api/v1/users/:id', () => {
    test('should return user details by ID', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/users/${testUserId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.id).toBe(testUserId);
      expect(body.data.email).toBe(testUserEmail);
      expect(body.data).toHaveProperty('stats');
      expect(body.data).toHaveProperty('product_access');
    });

    test('should return 404 for non-existent user', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const fakeId = '11111111-1111-4111-a111-111111111111';
      const response = await page.request.get(`/api/v1/users/${fakeId}`);

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/users/invalid-id');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('POST /api/v1/users/:id/access', () => {
    test('should grant access to a product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a unique product for this test
      const { data: product } = await supabaseAdmin
        .from('products')
        .insert({
          name: 'Grant Access Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing grant access',
          price: 29.99,
          is_active: true,
        })
        .select()
        .single();

      const response = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: {
          product_id: product!.id
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data.user_id).toBe(testUserId);
      expect(body.data.product_id).toBe(product!.id);
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('granted_at');

      createdAccessIds.push(body.data.id);

      // Cleanup
      await supabaseAdmin.from('user_product_access').delete().eq('id', body.data.id);
      await supabaseAdmin.from('products').delete().eq('id', product!.id);
    });

    test('should return error when user already has access', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a product and grant access first
      const { data: product } = await supabaseAdmin
        .from('products')
        .insert({
          name: 'Duplicate Access Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing duplicate access',
          price: 19.99,
          is_active: true,
        })
        .select()
        .single();

      // Grant access first
      const grantResponse = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: { product_id: product!.id }
      });
      const grantBody = await grantResponse.json();

      // Try to grant access again
      const response = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: {
          product_id: product!.id
        }
      });

      expect(response.status()).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('ALREADY_EXISTS');

      // Cleanup
      await supabaseAdmin.from('user_product_access').delete().eq('id', grantBody.data.id);
      await supabaseAdmin.from('products').delete().eq('id', product!.id);
    });

    test('should grant access with duration', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a new product for this test
      const { data: product } = await supabaseAdmin
        .from('products')
        .insert({
          name: 'Duration Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing access duration',
          price: 19.99,
          is_active: true,
        })
        .select()
        .single();

      const response = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: {
          product_id: product!.id,
          access_duration_days: 30
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data.duration_days).toBe(30);
      expect(body.data.expires_at).toBeTruthy();

      createdAccessIds.push(body.data.id);

      // Cleanup
      await supabaseAdmin.from('products').delete().eq('id', product!.id);
    });

    test('should return 404 for non-existent product', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const fakeProductId = '11111111-1111-4111-a111-111111111111';
      const response = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: {
          product_id: fakeProductId
        }
      });

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  test.describe('GET /api/v1/users/:id/access', () => {
    test('should list user access', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create product and grant access for this test
      const { data: product } = await supabaseAdmin
        .from('products')
        .insert({
          name: 'List Access Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing list access',
          price: 15.99,
          is_active: true,
        })
        .select()
        .single();

      const grantResponse = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: { product_id: product!.id }
      });
      const grantBody = await grantResponse.json();

      const response = await page.request.get(`/api/v1/users/${testUserId}/access`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      const access = body.data.find((a: any) => a.product_id === product!.id);
      expect(access).toBeTruthy();
      expect(access.product_name).toBe('List Access Test Product');

      // Cleanup
      await supabaseAdmin.from('user_product_access').delete().eq('id', grantBody.data.id);
      await supabaseAdmin.from('products').delete().eq('id', product!.id);
    });
  });

  test.describe('PATCH /api/v1/users/:id/access/:accessId', () => {
    test('should extend access by days', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create product and grant access for this test
      const { data: product } = await supabaseAdmin
        .from('products')
        .insert({
          name: 'Extend Access Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing extend access',
          price: 12.99,
          is_active: true,
        })
        .select()
        .single();

      const grantResponse = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: { product_id: product!.id }
      });
      const grantBody = await grantResponse.json();
      const accessId = grantBody.data.id;

      const response = await page.request.patch(`/api/v1/users/${testUserId}/access/${accessId}`, {
        data: {
          extend_days: 30
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.expires_at).toBeTruthy();

      // Cleanup
      await supabaseAdmin.from('user_product_access').delete().eq('id', accessId);
      await supabaseAdmin.from('products').delete().eq('id', product!.id);
    });

    test('should set specific expiration date', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create product and grant access for this test
      const { data: product } = await supabaseAdmin
        .from('products')
        .insert({
          name: 'Set Expiration Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing set expiration',
          price: 11.99,
          is_active: true,
        })
        .select()
        .single();

      const grantResponse = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: { product_id: product!.id }
      });
      const grantBody = await grantResponse.json();
      const accessId = grantBody.data.id;

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const response = await page.request.patch(`/api/v1/users/${testUserId}/access/${accessId}`, {
        data: {
          access_expires_at: futureDate.toISOString()
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.expires_at).toBeTruthy();

      // Cleanup
      await supabaseAdmin.from('user_product_access').delete().eq('id', accessId);
      await supabaseAdmin.from('products').delete().eq('id', product!.id);
    });

    test('should return 404 for non-existent access', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const fakeAccessId = '11111111-1111-4111-a111-111111111111';
      const response = await page.request.patch(`/api/v1/users/${testUserId}/access/${fakeAccessId}`, {
        data: {
          extend_days: 30
        }
      });

      expect(response.status()).toBe(404);
    });
  });

  test.describe('DELETE /api/v1/users/:id/access/:accessId', () => {
    test('should revoke access', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a new product and grant access for this test
      const { data: product } = await supabaseAdmin
        .from('products')
        .insert({
          name: 'Delete Test Product',
          slug: uniqueSlug(),
          description: 'Product for testing access deletion',
          price: 9.99,
          is_active: true,
        })
        .select()
        .single();

      // Grant access
      const grantResponse = await page.request.post(`/api/v1/users/${testUserId}/access`, {
        data: { product_id: product!.id }
      });
      const grantBody = await grantResponse.json();
      const accessId = grantBody.data.id;

      // Delete access
      const deleteResponse = await page.request.delete(`/api/v1/users/${testUserId}/access/${accessId}`);

      // DELETE returns 204 No Content
      expect(deleteResponse.status()).toBe(204);

      // Verify access is gone
      const getResponse = await page.request.get(`/api/v1/users/${testUserId}/access/${accessId}`);
      expect(getResponse.status()).toBe(404);

      // Cleanup
      await supabaseAdmin.from('products').delete().eq('id', product!.id);
    });

    test('should return 404 for non-existent access', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const fakeAccessId = '11111111-1111-4111-a111-111111111111';
      const response = await page.request.delete(`/api/v1/users/${testUserId}/access/${fakeAccessId}`);

      expect(response.status()).toBe(404);
    });
  });

  test.describe('Response Format', () => {
    test('should use standardized success response format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/users/${testUserId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('email');
    });

    test('should use standardized error response format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/users/invalid-id');

      expect(response.status()).toBe(400);
      const body = await response.json();

      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });
});
