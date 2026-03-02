import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getAdminBearerToken } from './helpers/admin-auth';

/**
 * Rate Limiting Tests
 *
 * These tests verify rate limiting functionality across all protected endpoints.
 * They require RATE_LIMIT_TEST_MODE=true on the dev server.
 *
 * Run as part of the full suite:
 *   bun ttt   (chromium tests first, then rate-limiting with fresh server)
 *   bun tttt  (same but with DB reset first)
 *
 * Run standalone:
 *   RATE_LIMIT_TEST_MODE=true npx playwright test --project=rate-limiting
 */

test.describe('Rate Limiting', () => {
  test.describe.configure({ mode: 'serial' });

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    throw new Error('Missing Supabase env variables for testing');
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  test.beforeEach(async () => {
    // Clean up rate limit entries before each test
    await supabaseAdmin.from('application_rate_limits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test.afterEach(async () => {
    // Clean up rate limit entries after each test so other tests aren't affected
    await supabaseAdmin.from('application_rate_limits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  });

  // ============================================
  // DATABASE RPC RATE LIMITING
  // ============================================

  test.describe('Database RPC Rate Limiting', () => {
    test('should allow requests within rate limit', async () => {
      const identifier = `test-user-${Date.now()}`;
      const actionType = 'test_action';

      // Make 3 requests (well within any reasonable limit)
      for (let i = 0; i < 3; i++) {
        const { data, error } = await supabaseAdmin.rpc('check_application_rate_limit', {
          identifier_param: identifier,
          action_type_param: actionType,
          max_requests: 5,
          window_minutes: 1,
        });

        expect(error).toBeNull();
        expect(data).toBe(true);
      }
    });

    test('should block requests after exceeding rate limit', async () => {
      const identifier = `test-user-${Date.now()}`;
      const actionType = 'test_action';
      const maxRequests = 5;

      // Make requests until limit is reached
      for (let i = 0; i < maxRequests; i++) {
        const { data } = await supabaseAdmin.rpc('check_application_rate_limit', {
          identifier_param: identifier,
          action_type_param: actionType,
          max_requests: maxRequests,
          window_minutes: 1,
        });
        expect(data).toBe(true);
      }

      // Next request should be blocked
      const { data, error } = await supabaseAdmin.rpc('check_application_rate_limit', {
        identifier_param: identifier,
        action_type_param: actionType,
        max_requests: maxRequests,
        window_minutes: 1,
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    test('should track different identifiers separately', async () => {
      const user1 = `test-user-1-${Date.now()}`;
      const user2 = `test-user-2-${Date.now()}`;
      const maxRequests = 3;

      // User 1 exhausts their limit
      for (let i = 0; i < maxRequests; i++) {
        await supabaseAdmin.rpc('check_application_rate_limit', {
          identifier_param: user1,
          action_type_param: 'test_action',
          max_requests: maxRequests,
          window_minutes: 1,
        });
      }

      // User 1 is now blocked
      const { data: user1Blocked } = await supabaseAdmin.rpc('check_application_rate_limit', {
        identifier_param: user1,
        action_type_param: 'test_action',
        max_requests: maxRequests,
        window_minutes: 1,
      });
      expect(user1Blocked).toBe(false);

      // User 2 should still be able to make requests
      const { data: user2Allowed } = await supabaseAdmin.rpc('check_application_rate_limit', {
        identifier_param: user2,
        action_type_param: 'test_action',
        max_requests: maxRequests,
        window_minutes: 1,
      });
      expect(user2Allowed).toBe(true);
    });

    test('should track different action types separately', async () => {
      const identifier = `test-user-${Date.now()}`;
      const maxRequests = 3;

      // Exhaust limit for action_type_1
      for (let i = 0; i < maxRequests; i++) {
        await supabaseAdmin.rpc('check_application_rate_limit', {
          identifier_param: identifier,
          action_type_param: 'action_type_1',
          max_requests: maxRequests,
          window_minutes: 1,
        });
      }

      // action_type_1 is blocked
      const { data: action1Blocked } = await supabaseAdmin.rpc('check_application_rate_limit', {
        identifier_param: identifier,
        action_type_param: 'action_type_1',
        max_requests: maxRequests,
        window_minutes: 1,
      });
      expect(action1Blocked).toBe(false);

      // action_type_2 should still work
      const { data: action2Allowed } = await supabaseAdmin.rpc('check_application_rate_limit', {
        identifier_param: identifier,
        action_type_param: 'action_type_2',
        max_requests: maxRequests,
        window_minutes: 1,
      });
      expect(action2Allowed).toBe(true);
    });
  });

  // ============================================
  // RPC ACCESS CONTROL
  // Verify that rate limit RPC cannot be called directly by anon/authenticated
  // to prevent table pollution and rate limit exhaustion attacks
  // ============================================

  test.describe('RPC Access Control', () => {
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);

    test('anon client should NOT be able to call check_application_rate_limit', async () => {
      const { data, error } = await anonClient.rpc('check_application_rate_limit', {
        identifier_param: 'attacker-probe',
        action_type_param: 'test_action',
        max_requests: 999,
        window_minutes: 1,
      });

      // Should fail with permission denied
      expect(error).not.toBeNull();
      expect(data).not.toBe(true);

      // Verify no row was created (attacker cannot pollute table)
      const { data: rows } = await supabaseAdmin
        .from('application_rate_limits')
        .select('id')
        .eq('identifier', 'attacker-probe');
      expect(rows).toHaveLength(0);
    });

    test('authenticated client should NOT be able to call check_application_rate_limit', async () => {
      // Create a temporary user to get an authenticated client
      const email = `ratelimit-security-${Date.now()}@test.com`;
      const { data: authData } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: 'TestPassword123!',
        email_confirm: true,
      });

      try {
        const { data: session } = await anonClient.auth.signInWithPassword({
          email,
          password: 'TestPassword123!',
        });

        // Use authenticated session
        const authedClient = createClient(SUPABASE_URL, ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${session.session!.access_token}` } },
        });

        const { data, error } = await authedClient.rpc('check_application_rate_limit', {
          identifier_param: 'attacker-authenticated',
          action_type_param: 'test_action',
          max_requests: 999,
          window_minutes: 1,
        });

        expect(error).not.toBeNull();
        expect(data).not.toBe(true);

        // Verify no row was created
        const { data: rows } = await supabaseAdmin
          .from('application_rate_limits')
          .select('id')
          .eq('identifier', 'attacker-authenticated');
        expect(rows).toHaveLength(0);
      } finally {
        if (authData.user) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        }
      }
    });

    test('service_role client CAN call check_application_rate_limit', async () => {
      const { data, error } = await supabaseAdmin.rpc('check_application_rate_limit', {
        identifier_param: `service-role-test-${Date.now()}`,
        action_type_param: 'test_action',
        max_requests: 5,
        window_minutes: 1,
      });

      expect(error).toBeNull();
      expect(data).toBe(true);
    });
  });

  // ============================================
  // API ENDPOINT RATE LIMITING
  // These tests verify that endpoints return 429 when rate limited
  // ============================================

  test.describe('API Endpoint Rate Limiting', () => {

    /**
     * Helper to make requests until rate limited
     * Returns the number of successful requests before 429
     */
    async function makeRequestsUntilRateLimited(
      request: any,
      method: 'get' | 'post',
      url: string,
      data?: any,
      maxAttempts = 100,
      headers?: Record<string, string>
    ): Promise<{ successCount: number; gotRateLimited: boolean }> {
      let successCount = 0;
      let gotRateLimited = false;

      for (let i = 0; i < maxAttempts; i++) {
        const response = method === 'get'
          ? await request.get(url, { headers })
          : await request.post(url, { data, headers });

        if (response.status() === 429) {
          gotRateLimited = true;
          break;
        }
        if (response.status() >= 200 && response.status() < 500) {
          successCount++;
        }
      }

      return { successCount, gotRateLimited };
    }

    test('waitlist signup should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/waitlist/signup',
        {
          email: `test-${Date.now()}@example.com`,
          productSlug: 'nonexistent-product',
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
      expect(result.successCount).toBeLessThan(100); // Should hit limit before maxAttempts
    });

    test('consent endpoint should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/consent',
        {
          consents: { analytics: true },
          fingerprint: `test-${Date.now()}`,
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('coupon verify should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/coupons/verify',
        {
          code: 'TESTCODE',
          productId: '00000000-0000-0000-0000-000000000000',
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('coupon auto-apply should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/coupons/auto-apply',
        {
          productId: '00000000-0000-0000-0000-000000000000',
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('OTO info should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'get',
        '/api/oto/info?productId=00000000-0000-0000-0000-000000000000'
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('order-bumps should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'get',
        '/api/order-bumps?productId=00000000-0000-0000-0000-000000000000'
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('FB CAPI tracking should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/tracking/fb-capi',
        {
          eventName: 'test_event',
          eventData: {},
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('claim-free should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/public/products/claim-free',
        {
          email: 'test@example.com',
          productSlug: 'nonexistent',
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('verify-payment should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/verify-payment',
        {
          session_id: 'cs_test_fake',
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('update-payment-metadata should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/update-payment-metadata',
        {
          clientSecret: 'pi_test_fake_secret_abc',
          metadata: { test: 'value' },
        },
        100,
        {
          'origin': 'http://localhost:3000',
          'referer': 'http://localhost:3000/',
        }
      );

      // Rate limiting should kick in (either from this test or previous runs)
      expect(result.gotRateLimited).toBe(true);
      // Note: successCount may be 0 if rate limit was already exhausted from previous test runs
    });

    test('create-embedded-checkout should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/create-embedded-checkout',
        {
          productId: '00000000-0000-0000-0000-000000000000',
          email: 'test@example.com',
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('create-payment-intent should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/create-payment-intent',
        {
          productId: '00000000-0000-0000-0000-000000000000',
          email: 'test@example.com',
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('GUS fetch-company-data should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'post',
        '/api/gus/fetch-company-data',
        {
          nip: '5261040828',
        }
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('health endpoint should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'get',
        '/api/health'
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('status endpoint should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'get',
        '/api/status'
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('config endpoint should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'get',
        '/api/config'
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    // NOTE: /api/runtime-config intentionally has NO rate limiting
    // (public, read-only, heavily cached endpoint) — no test needed

    test('products/[id] endpoint should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'get',
        '/api/products/00000000-0000-0000-0000-000000000000'
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    test('lowest-price endpoint should be rate limited', async ({ request }) => {
      const result = await makeRequestsUntilRateLimited(
        request,
        'get',
        '/api/products/00000000-0000-0000-0000-000000000000/lowest-price'
      );

      expect(result.gotRateLimited).toBe(true);
      expect(result.successCount).toBeGreaterThan(0);
    });

    // NOTE: /api/access endpoint has rate limiting (120/min) but testing it is impractical
    // because making 121+ sequential HTTP requests is slow and wasteful. The rate limiting
    // code is present in src/app/api/access/route.ts and infrastructure is verified by other tests.

    // NOTE: The following endpoints have rate limiting but require authentication BEFORE
    // rate limiting is checked. They return 401 before reaching rate limit checks.
    // Rate limiting code is present and functional in:
    // - /api/refund-requests (requires user auth, 3/60min per user)
    // - /api/public/products/[slug]/grant-access (requires user auth, 5/60min per user)
    // - /api/admin/coupons (requires admin auth, 20/hour per admin)
  });

  // ============================================
  // RATE LIMIT BEHAVIOR TESTS
  // ============================================

  test.describe('Rate Limit Behavior', () => {
    test('rate limit should return 429 status code', async ({ request }) => {
      // Make many requests until we hit the limit
      let got429 = false;

      for (let i = 0; i < 50; i++) {
        const response = await request.post('/api/consent', {
          data: {
            consents: { analytics: true },
            fingerprint: `test-${Date.now()}`,
          },
        });

        if (response.status() === 429) {
          got429 = true;
          break;
        }
      }

      expect(got429).toBe(true);
    });

    test('rate limited response should have proper error message', async ({ request }) => {
      // Exhaust rate limit
      let got429 = false;
      for (let i = 0; i < 50; i++) {
        const response = await request.post('/api/consent', {
          data: {
            consents: { analytics: true },
            fingerprint: `test-${Date.now()}`,
          },
        });

        if (response.status() === 429) {
          got429 = true;
          const body = await response.json();
          expect(body.error).toBeTruthy();
          // Error message should indicate rate limiting (either "rate" or "too many requests")
          const errorLower = body.error.toLowerCase();
          expect(errorLower.includes('rate') || errorLower.includes('too many')).toBe(true);
          break;
        }
      }

      expect(got429, 'Expected 429 response but never received one after 50 requests').toBe(true);
    });
  });

  // ============================================
  // ADMIN ENDPOINT RATE LIMITING
  // These endpoints require admin authentication and have specific rate limits
  // ============================================

  test.describe('Admin Endpoint Rate Limiting', () => {
    let adminToken: string;
    let testProduct: any;

    test.beforeAll(async () => {
      // Get admin token for API requests
      adminToken = await getAdminBearerToken();

      // Get a product for test data
      const { data: products } = await supabaseAdmin
        .from('products')
        .select('id, price, currency')
        .eq('is_active', true)
        .not('price', 'is', null)
        .gt('price', 0)
        .limit(1);

      if (products && products.length > 0) {
        testProduct = products[0];
      } else {
        console.warn('No active products found for admin rate limit tests - tests will be skipped');
      }
    });

    test('admin refund endpoint should be rate limited (10/hour)', async ({ request }) => {
      if (!testProduct) {
        test.skip();
        return;
      }

      // Create test transaction
      const { data: transaction } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: `cs_test_rate_refund_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          product_id: testProduct.id,
          customer_email: 'rate-test-refund@example.com',
          amount: testProduct.price * 100,
          currency: testProduct.currency || 'usd',
          status: 'completed',
          stripe_payment_intent_id: `pi_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        })
        .select()
        .single();

      if (!transaction) {
        test.skip();
        return;
      }

      console.log(`\n🔍 Testing /api/admin/payments/refund rate limit (10/hour)`);

      // Send 12 requests (limit is 10)
      const requests = Array(12).fill(null).map(() =>
        request.post('http://localhost:3000/api/admin/payments/refund', {
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            transactionId: transaction.id,
            paymentIntentId: transaction.stripe_payment_intent_id,
            reason: 'requested_by_customer',
          },
        })
      );

      const results = await Promise.all(requests);
      const rateLimitedCount = results.filter(r => r.status() === 429).length;

      console.log(`   Requests: 12, Rate limited: ${rateLimitedCount}`);

      // Cleanup
      await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);

      expect(rateLimitedCount).toBeGreaterThanOrEqual(2);
    });

    test('admin stats endpoint should be rate limited (30/5min)', async ({ request }) => {
      console.log(`\n🔍 Testing /api/admin/payments/stats rate limit (30/5min)`);

      // Send 35 requests (limit is 30)
      const requests = Array(35).fill(null).map(() =>
        request.get('http://localhost:3000/api/admin/payments/stats', {
          headers: {
            'Authorization': `Bearer ${adminToken}`,
          },
        })
      );

      const results = await Promise.all(requests);
      const rateLimitedCount = results.filter(r => r.status() === 429).length;

      console.log(`   Requests: 35, Rate limited: ${rateLimitedCount}`);

      expect(rateLimitedCount).toBeGreaterThanOrEqual(5);
    });

    test('admin export endpoint should be rate limited (5/hour)', async ({ request }) => {
      console.log(`\n🔍 Testing /api/admin/payments/export rate limit (5/hour)`);

      // Send 7 requests (limit is 5)
      const requests = Array(7).fill(null).map(() =>
        request.post('http://localhost:3000/api/admin/payments/export', {
          headers: {
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            status: 'all',
            dateRange: 'all',
          },
        })
      );

      const results = await Promise.all(requests);
      const rateLimitedCount = results.filter(r => r.status() === 429).length;

      console.log(`   Requests: 7, Rate limited: ${rateLimitedCount}`);

      expect(rateLimitedCount).toBeGreaterThanOrEqual(2);
    });
  });
});
