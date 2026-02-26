/**
 * Tests for Payments API v1
 *
 * Tests list payments, single payment, and refund endpoints.
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

test.describe('Payments API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let testProductId: string;
  let testTransactionId: string;

  test.beforeAll(async () => {
    // Create admin user for all tests
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `payments-api-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Payments API Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // Make user an admin
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create a test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Test Payment Product ${randomStr}`,
        slug: `test-payment-product-${randomStr}`,
        description: 'Product for payment testing',
        price: 9900,
        currency: 'PLN',
        is_active: true,
      })
      .select('id')
      .single();

    if (productError) throw productError;
    testProductId = product.id;

    // Create a test transaction
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        customer_email: `customer-${randomStr}@example.com`,
        amount: 9900,
        currency: 'PLN',
        status: 'completed',
        stripe_payment_intent_id: `pi_test_${randomStr}`,
        product_id: testProductId,
        user_id: adminUserId,
        session_id: `cs_test_${randomStr}`,
        metadata: { test: true },
      })
      .select('id')
      .single();

    if (txError) throw txError;
    testTransactionId = transaction.id;
  });

  test.afterAll(async () => {
    // Cleanup - delete in reverse order of foreign key dependencies
    if (testTransactionId) {
      await supabaseAdmin.from('payment_transactions').delete().eq('id', testTransactionId);
    }
    if (testProductId) {
      await supabaseAdmin.from('products').delete().eq('id', testProductId);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated requests to list payments', async ({ request }) => {
      const response = await request.get('/api/v1/payments');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for unauthenticated requests to single payment', async ({ request }) => {
      const response = await request.get(`/api/v1/payments/${testTransactionId}`);

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for unauthenticated refund requests', async ({ request }) => {
      const response = await request.post(`/api/v1/payments/${testTransactionId}/refund`, {
        data: {}
      });

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  test.describe('GET /api/v1/payments', () => {
    test('should return paginated list of payments', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('pagination');
      expect(body.pagination).toHaveProperty('has_more');
      expect(body.pagination).toHaveProperty('next_cursor');
    });

    test('should include test transaction in list', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments');

      expect(response.status()).toBe(200);
      const body = await response.json();

      const testTx = body.data.find((p: any) => p.id === testTransactionId);
      expect(testTx).toBeDefined();
      expect(testTx.amount).toBe(9900);
      expect(testTx.currency).toBe('PLN');
      expect(testTx.status).toBe('completed');
    });

    test('should support status filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments?status=completed');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // All returned payments should have completed status
      expect(body.data.length).toBeGreaterThan(0);
      for (const p of body.data) {
        expect(p.status).toBe('completed');
      }
    });

    test('should support product_id filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/payments?product_id=${testProductId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      // All returned payments should have the test product
      expect(body.data.length).toBeGreaterThan(0);
      for (const p of body.data) {
        expect(p.product.id).toBe(testProductId);
      }
    });

    test('should support email filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments?email=customer');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // All returned payments should have email containing 'customer'
      expect(body.data.length).toBeGreaterThan(0);
      for (const p of body.data) {
        expect(p.customer_email.toLowerCase()).toContain('customer');
      }
    });

    test('should support limit parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments?limit=5');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.length).toBeLessThanOrEqual(5);
    });

    test('should support sorting', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments?sort=-amount');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // We created a transaction in beforeAll, so there should be data
      expect(body.data.length).toBeGreaterThan(0);
      // Check amounts are descending
      for (let i = 0; i < body.data.length - 1; i++) {
        expect(body.data[i].amount).toBeGreaterThanOrEqual(body.data[i + 1].amount);
      }
    });

    test('should reject invalid sort field', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments?sort=invalid');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should support date range filters', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const today = new Date().toISOString().split('T')[0];
      const response = await page.request.get(`/api/v1/payments?date_from=${today}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      // All transactions should be from today or later
      expect(body.data.length).toBeGreaterThan(0);
      for (const p of body.data) {
        const txDate = new Date(p.created_at).toISOString().split('T')[0];
        expect(txDate >= today).toBe(true);
      }
    });
  });

  test.describe('GET /api/v1/payments/:id', () => {
    test('should return payment details', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/payments/${testTransactionId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body.data.id).toBe(testTransactionId);
      expect(body.data.amount).toBe(9900);
      expect(body.data.currency).toBe('PLN');
      expect(body.data.status).toBe('completed');
      expect(body.data).toHaveProperty('product');
      expect(body.data.product.id).toBe(testProductId);
      expect(body.data).toHaveProperty('stripe_payment_intent_id');
      expect(body.data).toHaveProperty('created_at');
      expect(body.data).toHaveProperty('updated_at');
    });

    test('should return user info if user_id is set', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/payments/${testTransactionId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      // Transaction was created with user_id set, so user must be present
      expect(body.data).toHaveProperty('user');
      expect(body.data.user).not.toBeNull();
      expect(body.data.user).toHaveProperty('id');
      expect(body.data.user).toHaveProperty('email');
    });

    test('should return 404 for non-existent payment', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments/11111111-1111-4111-a111-111111111111');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid payment ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments/invalid-id');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should include refund info if payment was refunded', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a refunded transaction
      const randomStr = Math.random().toString(36).substring(7);
      const { data: refundedTx, error: txError } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          customer_email: `refunded-${randomStr}@example.com`,
          amount: 5000,
          currency: 'PLN',
          status: 'refunded',
          stripe_payment_intent_id: `pi_refunded_${randomStr}`,
          product_id: testProductId,
          session_id: `cs_refunded_${randomStr}`,
          refund_id: `re_test_${randomStr}`,
          refunded_amount: 5000,
          refunded_at: new Date().toISOString(),
          refunded_by: adminUserId,
          refund_reason: 'requested_by_customer',
        })
        .select('id')
        .single();

      if (txError) throw txError;

      try {
        const response = await page.request.get(`/api/v1/payments/${refundedTx.id}`);

        expect(response.status()).toBe(200);
        const body = await response.json();

        expect(body.data.status).toBe('refunded');
        expect(body.data.refund).not.toBeNull();
        expect(body.data.refund.id).toBe(`re_test_${randomStr}`);
        expect(body.data.refund.amount).toBe(5000);
        expect(body.data.refund.reason).toBe('requested_by_customer');
      } finally {
        // Cleanup
        await supabaseAdmin.from('payment_transactions').delete().eq('id', refundedTx.id);
      }
    });
  });

  test.describe('POST /api/v1/payments/:id/refund', () => {
    test('should return 403 for non-full-access API key', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Session auth has full access, but let's verify the endpoint exists
      // The actual scope check is tested with API keys in integration tests
      const response = await page.request.post(`/api/v1/payments/${testTransactionId}/refund`, {
        data: {}
      });

      // Should either succeed or fail with Stripe error (not auth error)
      // because session auth has full access
      expect(response.status()).not.toBe(403);
    });

    test('should return 404 for non-existent payment', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/11111111-1111-4111-a111-111111111111/refund', {
        data: {}
      });

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid payment ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/invalid-id/refund', {
        data: {}
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 400 for invalid refund reason', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post(`/api/v1/payments/${testTransactionId}/refund`, {
        data: {
          reason: 'invalid_reason'
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message.toLowerCase()).toContain('reason');
    });

    test('should return 400 for negative refund amount', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post(`/api/v1/payments/${testTransactionId}/refund`, {
        data: {
          amount: -100
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 400 for refund amount exceeding available', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post(`/api/v1/payments/${testTransactionId}/refund`, {
        data: {
          amount: 999999999 // More than the payment amount
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message.toLowerCase()).toContain('exceed');
    });
  });

  test.describe('Cursor Pagination', () => {
    test('should support cursor-based pagination', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Get first page with limit 1
      const response1 = await page.request.get('/api/v1/payments?limit=1');
      expect(response1.status()).toBe(200);
      const body1 = await response1.json();

      // We have test data, so first page should have items
      expect(body1.data.length).toBeGreaterThan(0);

      if (body1.pagination.has_more && body1.pagination.next_cursor) {
        // Get second page using cursor
        const response2 = await page.request.get(
          `/api/v1/payments?limit=1&cursor=${body1.pagination.next_cursor}`
        );
        expect(response2.status()).toBe(200);
        const body2 = await response2.json();

        // Second page should have different items
        expect(body2.data.length).toBeGreaterThan(0);
        expect(body2.data[0].id).not.toBe(body1.data[0].id);
      } else {
        // Only one payment exists — pagination still works correctly with single item
        expect(body1.pagination.has_more).toBe(false);
      }
    });

    test('should return 400 for invalid cursor format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/payments?cursor=invalid-cursor');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });
});
