import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

/**
 * Rate Limiting Tests for V1 API
 *
 * Tests verify rate limiting functionality for the /api/v1/* endpoints.
 * V1 API uses two levels of rate limiting:
 *
 * 1. API Key Rate Limiting (per-key per-minute limit in middleware.ts)
 * 2. Endpoint-specific Rate Limiting (sensitive operations via checkRateLimit)
 *
 * These require RATE_LIMIT_TEST_MODE=true on the dev server.
 *
 * Run as part of the full suite:
 *   bun ttt   (chromium tests first, then rate-limiting with fresh server)
 *   bun tttt  (same but with DB reset first)
 *
 * Run standalone:
 *   RATE_LIMIT_TEST_MODE=true npx playwright test --project=rate-limiting-v1
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run rate limit tests.');
}
if (process.env.RATE_LIMIT_TEST_MODE !== 'true') {
  throw new Error('RATE_LIMIT_TEST_MODE is not set. Run via: RATE_LIMIT_TEST_MODE=true npx playwright test --project=rate-limiting-v1 (or use bun ttt)');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY!);

// Helper to login as admin via browser context
async function loginAsAdmin(page: Page, email: string, password: string) {
  await page.goto('/login');

  await setAuthSession(page, email, password);

  await page.reload();
  // Wait for page to fully load
  await page.waitForLoadState('networkidle');
}

test.describe('V1 API Rate Limiting', () => {
  test.describe.configure({ mode: 'serial' });

  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let testProductId: string;
  let testApiKey: string;
  let testApiKeyId: string;

  test.beforeAll(async () => {
    // Clear stale rate limit entries from previous test runs (60 min window can overlap)
    await supabaseAdmin.from('rate_limits').delete().lt('window_start', new Date().toISOString());

    // Create admin user
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `rate-limit-v1-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (error) throw error;
    adminUserId = user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create a test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Rate Limit Test Product V1 ${randomStr}`,
        slug: `rate-limit-test-v1-${randomStr}`,
        description: 'Test product for v1 rate limiting',
        price: 1000,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();

    if (productError) throw productError;
    testProductId = product.id;
  });

  test.afterAll(async () => {
    // Cleanup API key
    if (testApiKeyId) {
      await supabaseAdmin.from('api_keys').delete().eq('id', testApiKeyId);
    }

    // Cleanup product
    if (testProductId) {
      await supabaseAdmin.from('products').delete().eq('id', testProductId);
    }

    // Cleanup admin user
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.beforeEach(async () => {
    // Clean up rate limit entries before each test
    await supabaseAdmin.from('application_rate_limits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test.afterEach(async () => {
    // Clean up rate limit entries after each test so other tests aren't affected
    await supabaseAdmin.from('application_rate_limits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  });

  // ============================================
  // API KEY CREATION AND RATE LIMITING
  // ============================================

  test.describe('API Key Rate Limiting', () => {
    test('should create API key with low rate limit for testing', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Rate Limit Test Key V1',
          scopes: ['*'],
          rate_limit_per_minute: 3,
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      expect(data.data.key).toBeDefined();
      expect(data.data.key).toMatch(/^sf_(live|test)_/);

      testApiKey = data.data.key;
      testApiKeyId = data.data.id;
    });

    test('should enforce per-key rate limit (requests/minute)', async ({ request }) => {
      expect(testApiKey, 'API key should have been created by previous test').toBeTruthy();

      let successCount = 0;
      let rateLimited = false;

      // The key has 3/min limit, try 10 requests
      for (let i = 0; i < 10; i++) {
        const response = await request.get('/api/v1/products', {
          headers: {
            'X-API-Key': testApiKey,
          },
        });

        if (response.status() === 429) {
          rateLimited = true;
          break;
        }

        if (response.status() === 200) {
          successCount++;
        }
      }

      expect(rateLimited).toBe(true);
      expect(successCount).toBeGreaterThanOrEqual(1);
      expect(successCount).toBeLessThanOrEqual(3);
    });

    test('rate limit error should have proper format', async ({ request }) => {
      expect(testApiKey, 'API key should have been created by previous test').toBeTruthy();

      // Exhaust rate limit
      let rateLimitResponse: { error: { code: string; message: string } } | null = null;
      for (let i = 0; i < 10; i++) {
        const response = await request.get('/api/v1/products', {
          headers: {
            'X-API-Key': testApiKey,
          },
        });

        if (response.status() === 429) {
          rateLimitResponse = await response.json();
          break;
        }
      }

      expect(rateLimitResponse, 'Expected to hit 429 rate limit within 10 requests').not.toBeNull();
      expect(rateLimitResponse!.error).toBeDefined();
      expect(rateLimitResponse!.error.code).toBe('RATE_LIMITED');
      expect(rateLimitResponse!.error.message).toContain('Rate limit exceeded');
    });

    test('different API keys should have separate rate limits', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create second API key
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Second Rate Limit Test Key V1',
          scopes: ['*'],
          rate_limit_per_minute: 3,
        },
      });

      expect(createResponse.status()).toBe(201);
      const { data: keyData } = await createResponse.json();
      const secondApiKey = keyData.key;
      const secondApiKeyId = keyData.id;

      try {
        // Exhaust first key's rate limit
        for (let i = 0; i < 5; i++) {
          await request.get('/api/v1/products', {
            headers: { 'X-API-Key': testApiKey },
          });
        }

        // Second key should still work
        const response = await request.get('/api/v1/products', {
          headers: { 'X-API-Key': secondApiKey },
        });

        expect(response.status()).toBe(200);
      } finally {
        await supabaseAdmin.from('api_keys').delete().eq('id', secondApiKeyId);
      }
    });
  });

  // ============================================
  // SESSION AUTH - ENDPOINT RATE LIMITING
  // ============================================

  test.describe('Session Auth - Endpoint Rate Limiting', () => {
    test('payments stats should be rate limited (30/5min)', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      let successCount = 0;
      let rateLimited = false;

      // Stats endpoint has 30/5min limit
      for (let i = 0; i < 35; i++) {
        const response = await page.request.get('/api/v1/payments/stats');

        if (response.status() === 429) {
          rateLimited = true;
          break;
        }

        if (response.status() === 200) {
          successCount++;
        }
      }

      expect(rateLimited).toBe(true);
      expect(successCount).toBeGreaterThan(0);
      expect(successCount).toBeLessThanOrEqual(30);
    });

    test('payments export should be rate limited (5/hour)', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      let successCount = 0;
      let rateLimited = false;

      // Export endpoint has 5/hour limit (POST method)
      for (let i = 0; i < 10; i++) {
        const response = await page.request.post('/api/v1/payments/export', {
          data: { status: 'all' },
        });

        if (response.status() === 429) {
          rateLimited = true;
          break;
        }

        if (response.status() === 200) {
          successCount++;
        }
      }

      expect(rateLimited).toBe(true);
      expect(successCount).toBeGreaterThan(0);
      expect(successCount).toBeLessThanOrEqual(5);
    });

    test('refund should be rate limited (10/hour)', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create multiple test payments for refund testing
      const paymentIds: string[] = [];

      for (let i = 0; i < 15; i++) {
        const { data: payment, error } = await supabaseAdmin
          .from('payment_transactions')
          .insert({
            product_id: testProductId,
            session_id: `cs_test_refund_v1_${Date.now()}_${i}`,
            amount: 100,
            currency: 'USD',
            status: 'completed',
            customer_email: `refund-test-${i}@example.com`,
            stripe_payment_intent_id: `pi_test_refund_v1_${Date.now()}_${i}`,
          })
          .select('id')
          .single();

        if (!error && payment) {
          paymentIds.push(payment.id);
        }
      }

      let successCount = 0;
      let rateLimited = false;

      // Refund endpoint has 10/hour limit
      for (const paymentId of paymentIds) {
        const response = await page.request.post(`/api/v1/payments/${paymentId}/refund`, {
          data: {
            reason: 'requested_by_customer',
          },
        });

        if (response.status() === 429) {
          rateLimited = true;
          break;
        }

        // Count non-rate-limited requests (even if they fail at Stripe level)
        successCount++;
      }

      // Cleanup test payments
      for (const id of paymentIds) {
        await supabaseAdmin.from('payment_transactions').delete().eq('id', id);
      }

      expect(rateLimited).toBe(true);
      expect(successCount).toBeLessThanOrEqual(10);
    });
  });

  // ============================================
  // V1 ENDPOINTS - GENERAL RATE LIMITING
  // ============================================

  test.describe('V1 Endpoints - General Access', () => {
    test('products list endpoint should work without endpoint-level rate limiting', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      let successCount = 0;

      // Make many requests - no endpoint-level limit
      for (let i = 0; i < 50; i++) {
        const response = await page.request.get('/api/v1/products');

        if (response.status() === 200) {
          successCount++;
        }
      }

      // Should succeed for many requests (no endpoint-level limit for session auth)
      expect(successCount).toBeGreaterThan(30);
    });

    test('coupons list endpoint should work without endpoint-level rate limiting', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      let successCount = 0;

      for (let i = 0; i < 50; i++) {
        const response = await page.request.get('/api/v1/coupons');

        if (response.status() === 200) {
          successCount++;
        }
      }

      expect(successCount).toBeGreaterThan(30);
    });

    test('users list endpoint should work without endpoint-level rate limiting', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      let successCount = 0;

      for (let i = 0; i < 50; i++) {
        const response = await page.request.get('/api/v1/users');

        if (response.status() === 200) {
          successCount++;
        }
      }

      expect(successCount).toBeGreaterThan(30);
    });

    test('system status endpoint should work without endpoint-level rate limiting', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      let successCount = 0;

      for (let i = 0; i < 50; i++) {
        const response = await page.request.get('/api/v1/system/status');

        if (response.status() === 200) {
          successCount++;
        }
      }

      expect(successCount).toBeGreaterThan(30);
    });
  });

  // ============================================
  // API KEY SCOPES WITH RATE LIMITING
  // ============================================

  test.describe('API Key Scopes with Rate Limiting', () => {
    let readOnlyApiKey: string;
    let readOnlyApiKeyId: string;

    test.beforeAll(async ({ browser }) => {
      // Create read-only API key with low rate limit using browser context
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        await loginAsAdmin(page, adminEmail, adminPassword);

        const response = await page.request.post('/api/v1/api-keys', {
          data: {
            name: 'Read Only Rate Limit Test V1',
            scopes: ['products:read', 'users:read'],
            rate_limit_per_minute: 5,
          },
        });

        if (response.status() === 201) {
          const data = await response.json();
          readOnlyApiKey = data.data.key;
          readOnlyApiKeyId = data.data.id;
        }
      } finally {
        await context.close();
      }
    });

    test.afterAll(async () => {
      if (readOnlyApiKeyId) {
        await supabaseAdmin.from('api_keys').delete().eq('id', readOnlyApiKeyId);
      }
    });

    test('read-only key should be rate limited on allowed endpoints', async ({ request }) => {
      expect(readOnlyApiKey, 'Read-only API key should have been created in beforeAll').toBeTruthy();

      let successCount = 0;
      let rateLimited = false;

      for (let i = 0; i < 10; i++) {
        const response = await request.get('/api/v1/products', {
          headers: {
            'X-API-Key': readOnlyApiKey,
          },
        });

        if (response.status() === 429) {
          rateLimited = true;
          break;
        }

        if (response.status() === 200) {
          successCount++;
        }
      }

      expect(rateLimited).toBe(true);
      expect(successCount).toBeLessThanOrEqual(5);
    });

    test('insufficient scope should return 403 before rate limiting', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a fresh read-only API key with high rate limit to avoid rate limiting
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Scope Test Key V1',
          scopes: ['products:read'], // Read only, no write
          rate_limit_per_minute: 100, // High limit to avoid rate limiting
        },
      });

      expect(createResponse.status()).toBe(201);
      const { data: keyData } = await createResponse.json();
      const scopeTestKey = keyData.key;
      const scopeTestKeyId = keyData.id;

      try {
        // Try to write (should fail with 403, not rate limit)
        const response = await request.post('/api/v1/products', {
          headers: {
            'X-API-Key': scopeTestKey,
            'Content-Type': 'application/json',
          },
          data: {
            name: 'Test Product',
            slug: 'test-product-scope-test',
            description: 'Test',
            price: 1000,
          },
        });

        expect(response.status()).toBe(403);
        const data = await response.json();
        expect(data.error.code).toBe('FORBIDDEN');
        expect(data.error.message).toContain('permission');
      } finally {
        await supabaseAdmin.from('api_keys').delete().eq('id', scopeTestKeyId);
      }
    });
  });

  // ============================================
  // RATE LIMIT BEHAVIOR TESTS
  // ============================================

  test.describe('Rate Limit Behavior', () => {
    test('rate limited response should return 429 status', async ({ request }) => {
      expect(testApiKey, 'API key should have been created by previous test').toBeTruthy();

      let got429 = false;
      for (let i = 0; i < 10; i++) {
        const response = await request.get('/api/v1/products', {
          headers: {
            'X-API-Key': testApiKey,
          },
        });

        if (response.status() === 429) {
          got429 = true;
          break;
        }
      }

      expect(got429).toBe(true);
    });

    test('rate limited response should have proper error structure', async ({ request }) => {
      expect(testApiKey, 'API key should have been created by previous test').toBeTruthy();

      let rateLimitResponse: { error: { code: string; message: string } } | null = null;
      for (let i = 0; i < 10; i++) {
        const response = await request.get('/api/v1/products', {
          headers: {
            'X-API-Key': testApiKey,
          },
        });

        if (response.status() === 429) {
          rateLimitResponse = await response.json();
          break;
        }
      }

      expect(rateLimitResponse, 'Expected to hit 429 rate limit within 10 requests').not.toBeNull();
      expect(rateLimitResponse!.error).toBeDefined();
      expect(rateLimitResponse!.error.code).toBe('RATE_LIMITED');
      expect(rateLimitResponse!.error.message).toBeDefined();
      expect(typeof rateLimitResponse!.error.message).toBe('string');
    });
  });

  // ============================================
  // CONCURRENT REQUEST HANDLING
  // ============================================

  test.describe('Concurrent Request Handling', () => {
    test('concurrent requests should be properly rate limited', async ({ page, request }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a fresh API key for this test
      const createResponse = await page.request.post('/api/v1/api-keys', {
        data: {
          name: 'Concurrent Test Key V1',
          scopes: ['products:read'],
          rate_limit_per_minute: 5,
        },
      });

      expect(createResponse.status()).toBe(201);
      const { data: keyData } = await createResponse.json();
      const concurrentApiKey = keyData.key;
      const concurrentApiKeyId = keyData.id;

      try {
        // Send 10 concurrent requests
        const promises = Array.from({ length: 10 }, () =>
          request.get('/api/v1/products', {
            headers: { 'X-API-Key': concurrentApiKey },
          })
        );

        const responses = await Promise.all(promises);
        const statusCodes = responses.map(r => r.status());

        const successCount = statusCodes.filter(s => s === 200).length;
        const rateLimitedCount = statusCodes.filter(s => s === 429).length;

        // Should have some successes and some rate limited
        expect(successCount).toBeGreaterThan(0);
        expect(successCount).toBeLessThanOrEqual(5);
        expect(rateLimitedCount).toBeGreaterThan(0);
      } finally {
        await supabaseAdmin.from('api_keys').delete().eq('id', concurrentApiKeyId);
      }
    });
  });
});
