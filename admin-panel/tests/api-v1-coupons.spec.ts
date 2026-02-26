/**
 * Tests for Coupons API v1
 *
 * Tests cursor-based pagination, CRUD operations, and error handling.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to create unique coupon code
const uniqueCode = () => `TEST-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

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

test.describe('Coupons API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  const testCoupons: string[] = [];

  test.beforeAll(async () => {
    // Create admin user for all tests
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `coupon-api-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Coupon API Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // Make user an admin
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });
  });

  test.afterAll(async () => {
    // Cleanup test coupons
    for (const couponId of testCoupons) {
      await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', couponId);
      await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', couponId);
      await supabaseAdmin.from('coupons').delete().eq('id', couponId);
    }

    // Cleanup admin user
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.get('/api/v1/coupons');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  test.describe('GET /api/v1/coupons', () => {
    test('should return coupons list with pagination', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/coupons');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toHaveProperty('next_cursor');
      expect(body.pagination).toHaveProperty('has_more');
    });

    test('should respect limit parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/coupons?limit=5');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.length).toBeLessThanOrEqual(5);
    });

    test('should filter by status=active', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create an active and inactive coupon
      const activeCode = uniqueCode();
      const inactiveCode = uniqueCode();

      await page.request.post('/api/v1/coupons', {
        data: { code: activeCode, discount_type: 'percentage', discount_value: 10, is_active: true }
      });

      await page.request.post('/api/v1/coupons', {
        data: { code: inactiveCode, discount_type: 'percentage', discount_value: 10, is_active: false }
      });

      const response = await page.request.get('/api/v1/coupons?status=active');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // All returned coupons should be active
      expect(body.data.length).toBeGreaterThan(0);
      for (const coupon of body.data) {
        expect(coupon.is_active).toBe(true);
      }

      // Cleanup
      const { data: coupons } = await supabaseAdmin.from('coupons')
        .select('id')
        .in('code', [activeCode, inactiveCode]);
      if (coupons) {
        for (const c of coupons) {
          testCoupons.push(c.id);
        }
      }
    });

    test('should support search parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a coupon with unique code
      const searchCode = `SEARCH-${Date.now()}`;
      const createResponse = await page.request.post('/api/v1/coupons', {
        data: {
          code: searchCode,
          name: 'Search Test Coupon',
          discount_type: 'percentage',
          discount_value: 15
        }
      });

      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json();
      testCoupons.push(created.data.id);

      // Search for it
      const response = await page.request.get(`/api/v1/coupons?search=${searchCode}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].code).toBe(searchCode);
    });
  });

  test.describe('POST /api/v1/coupons', () => {
    test('should create percentage discount coupon', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const code = uniqueCode();
      const response = await page.request.post('/api/v1/coupons', {
        data: {
          code,
          name: 'Test Percentage Coupon',
          discount_type: 'percentage',
          discount_value: 25,
          usage_limit_per_user: 1
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data.code).toBe(code);
      expect(body.data.discount_type).toBe('percentage');
      expect(body.data.discount_value).toBe(25);
      expect(body.data.is_active).toBe(true);

      testCoupons.push(body.data.id);
    });

    test('should create fixed discount coupon', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const code = uniqueCode();
      const response = await page.request.post('/api/v1/coupons', {
        data: {
          code,
          discount_type: 'fixed',
          discount_value: 1000, // 10.00 in cents
          currency: 'PLN'
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data.code).toBe(code);
      expect(body.data.discount_type).toBe('fixed');
      expect(body.data.discount_value).toBe(1000);
      expect(body.data.currency).toBe('PLN');

      testCoupons.push(body.data.id);
    });

    test('should reject percentage discount over 100%', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/coupons', {
        data: {
          code: uniqueCode(),
          discount_type: 'percentage',
          discount_value: 150
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.message).toContain('100%');
    });

    test('should reject fixed discount without currency', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/coupons', {
        data: {
          code: uniqueCode(),
          discount_type: 'fixed',
          discount_value: 1000
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.message.toLowerCase()).toContain('currency');
    });

    test('should reject duplicate coupon code', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const code = uniqueCode();

      // Create first coupon
      const response1 = await page.request.post('/api/v1/coupons', {
        data: { code, discount_type: 'percentage', discount_value: 10 }
      });
      expect(response1.status()).toBe(201);
      const body1 = await response1.json();
      testCoupons.push(body1.data.id);

      // Try to create duplicate
      const response2 = await page.request.post('/api/v1/coupons', {
        data: { code, discount_type: 'percentage', discount_value: 20 }
      });

      expect(response2.status()).toBe(409);
      const body2 = await response2.json();
      expect(body2.error.code).toBe('CONFLICT');
    });

    test('should normalize code to uppercase', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const lowerCode = `lowercase-${Date.now()}`;
      const response = await page.request.post('/api/v1/coupons', {
        data: {
          code: lowerCode,
          discount_type: 'percentage',
          discount_value: 10
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data.code).toBe(lowerCode.toUpperCase());

      testCoupons.push(body.data.id);
    });

    test('should reject missing required fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/coupons', {
        data: { name: 'Missing Fields' }
      });

      expect(response.status()).toBe(400);
    });
  });

  test.describe('GET /api/v1/coupons/:id', () => {
    test('should return coupon details', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a coupon
      const code = uniqueCode();
      const createResponse = await page.request.post('/api/v1/coupons', {
        data: {
          code,
          name: 'Details Test Coupon',
          discount_type: 'percentage',
          discount_value: 30,
          allowed_emails: ['test@example.com'],
          usage_limit_global: 100
        }
      });

      const created = await createResponse.json();
      testCoupons.push(created.data.id);

      // Get details
      const response = await page.request.get(`/api/v1/coupons/${created.data.id}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.id).toBe(created.data.id);
      expect(body.data.code).toBe(code);
      expect(body.data.name).toBe('Details Test Coupon');
      expect(body.data.discount_type).toBe('percentage');
      expect(body.data.discount_value).toBe(30);
      expect(body.data.allowed_emails).toContain('test@example.com');
      expect(body.data.usage_limit_global).toBe(100);
    });

    test('should return 404 for non-existent coupon', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/coupons/11111111-1111-4111-a111-111111111111');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid UUID', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/coupons/invalid-id');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('PATCH /api/v1/coupons/:id', () => {
    test('should update coupon fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a coupon
      const createResponse = await page.request.post('/api/v1/coupons', {
        data: {
          code: uniqueCode(),
          name: 'Original Name',
          discount_type: 'percentage',
          discount_value: 10,
          is_active: true
        }
      });

      const created = await createResponse.json();
      testCoupons.push(created.data.id);

      // Update it
      const response = await page.request.patch(`/api/v1/coupons/${created.data.id}`, {
        data: {
          name: 'Updated Name',
          discount_value: 20,
          is_active: false
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.name).toBe('Updated Name');
      expect(body.data.discount_value).toBe(20);
      expect(body.data.is_active).toBe(false);
    });

    test('should reject update with no valid fields', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a coupon
      const createResponse = await page.request.post('/api/v1/coupons', {
        data: { code: uniqueCode(), discount_type: 'percentage', discount_value: 10 }
      });

      const created = await createResponse.json();
      testCoupons.push(created.data.id);

      // Try to update with empty body
      const response = await page.request.patch(`/api/v1/coupons/${created.data.id}`, {
        data: {}
      });

      expect(response.status()).toBe(400);
    });

    test('should return 404 for non-existent coupon', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch('/api/v1/coupons/11111111-1111-4111-a111-111111111111', {
        data: { name: 'Test' }
      });

      expect(response.status()).toBe(404);
    });

    test('should reject invalid discount value', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a coupon
      const createResponse = await page.request.post('/api/v1/coupons', {
        data: { code: uniqueCode(), discount_type: 'percentage', discount_value: 10 }
      });

      const created = await createResponse.json();
      testCoupons.push(created.data.id);

      // Try to update with invalid value
      const response = await page.request.patch(`/api/v1/coupons/${created.data.id}`, {
        data: { discount_value: 150 }
      });

      expect(response.status()).toBe(400);
    });
  });

  test.describe('DELETE /api/v1/coupons/:id', () => {
    test('should delete coupon', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a coupon
      const createResponse = await page.request.post('/api/v1/coupons', {
        data: { code: uniqueCode(), discount_type: 'percentage', discount_value: 10 }
      });

      const created = await createResponse.json();
      const couponId = created.data.id;

      // Delete it
      const response = await page.request.delete(`/api/v1/coupons/${couponId}`);

      // DELETE returns 204 No Content
      expect(response.status()).toBe(204);

      // Verify it's gone
      const getResponse = await page.request.get(`/api/v1/coupons/${couponId}`);
      expect(getResponse.status()).toBe(404);
    });

    test('should return 404 for non-existent coupon', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.delete('/api/v1/coupons/11111111-1111-4111-a111-111111111111');

      expect(response.status()).toBe(404);
    });
  });

  test.describe('GET /api/v1/coupons/:id/stats', () => {
    test('should return coupon statistics', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a coupon
      const createResponse = await page.request.post('/api/v1/coupons', {
        data: {
          code: uniqueCode(),
          name: 'Stats Test Coupon',
          discount_type: 'percentage',
          discount_value: 15,
          usage_limit_global: 50
        }
      });

      const created = await createResponse.json();
      testCoupons.push(created.data.id);

      // Get stats
      const response = await page.request.get(`/api/v1/coupons/${created.data.id}/stats`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.coupon_id).toBe(created.data.id);
      expect(body.data).toHaveProperty('summary');
      expect(body.data.summary).toHaveProperty('total_redemptions');
      expect(body.data.summary).toHaveProperty('total_discount_amount');
      expect(body.data.summary).toHaveProperty('unique_users');
      expect(body.data.summary.usage_limit_global).toBe(50);
      expect(body.data).toHaveProperty('recent_redemptions');
      expect(body.data).toHaveProperty('daily_usage');
      expect(Array.isArray(body.data.daily_usage)).toBe(true);
    });

    test('should return 404 for non-existent coupon', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/coupons/11111111-1111-4111-a111-111111111111/stats');

      expect(response.status()).toBe(404);
    });
  });

  test.describe('Cursor Pagination', () => {
    test('should paginate through coupons using cursor', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create multiple coupons
      const createdCoupons: string[] = [];
      for (let i = 0; i < 5; i++) {
        const response = await page.request.post('/api/v1/coupons', {
          data: {
            code: uniqueCode(),
            discount_type: 'percentage',
            discount_value: 10 + i
          }
        });
        const body = await response.json();
        createdCoupons.push(body.data.id);
        testCoupons.push(body.data.id);
      }

      // Get first page
      const firstResponse = await page.request.get('/api/v1/coupons?limit=2');
      expect(firstResponse.status()).toBe(200);
      const firstPage = await firstResponse.json();

      expect(firstPage.data.length).toBe(2);

      // We created 5 coupons above with limit=2, so there must be more pages
      expect(firstPage.pagination.next_cursor).toBeTruthy();

      const secondResponse = await page.request.get(
        `/api/v1/coupons?limit=2&cursor=${firstPage.pagination.next_cursor}`
      );
      expect(secondResponse.status()).toBe(200);
      const secondPage = await secondResponse.json();

      // Ensure no duplicates
      const firstIds = firstPage.data.map((c: any) => c.id);
      const secondIds = secondPage.data.map((c: any) => c.id);
      const overlap = firstIds.filter((id: string) => secondIds.includes(id));
      expect(overlap.length).toBe(0);
    });
  });
});
