/**
 * Tests for Refund Requests API v1
 *
 * Tests refund request list, single request, and approve/reject operations.
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

test.describe('Refund Requests API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let testProductId: string;
  let testTransactionId: string;
  let testRefundRequestId: string;

  test.beforeAll(async () => {
    // Create admin user for all tests
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `refund-api-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Refund API Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // Make user an admin
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create a test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Test Refund Product ${randomStr}`,
        slug: `test-refund-product-${randomStr}`,
        description: 'Product for refund testing',
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

    // Create a test refund request
    const { data: refundRequest, error: refundError } = await supabaseAdmin
      .from('refund_requests')
      .insert({
        transaction_id: testTransactionId,
        user_id: adminUserId,
        customer_email: `customer-${randomStr}@example.com`,
        product_id: testProductId,
        requested_amount: 9900,
        currency: 'PLN',
        reason: 'Test refund request',
        status: 'pending',
      })
      .select('id')
      .single();

    if (refundError) throw refundError;
    testRefundRequestId = refundRequest.id;
  });

  test.afterAll(async () => {
    // Cleanup - delete in reverse order of foreign key dependencies
    if (testRefundRequestId) {
      await supabaseAdmin.from('refund_requests').delete().eq('id', testRefundRequestId);
    }
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
    test('should return 401 for unauthenticated requests to list refund requests', async ({ request }) => {
      const response = await request.get('/api/v1/refund-requests');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for unauthenticated requests to single refund request', async ({ request }) => {
      const response = await request.get(`/api/v1/refund-requests/${testRefundRequestId}`);

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for unauthenticated PATCH requests', async ({ request }) => {
      const response = await request.patch(`/api/v1/refund-requests/${testRefundRequestId}`, {
        data: {
          action: 'approve'
        }
      });

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  test.describe('GET /api/v1/refund-requests', () => {
    test('should return paginated list of refund requests', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('pagination');
      expect(body.pagination).toHaveProperty('has_more');
      expect(body.pagination).toHaveProperty('next_cursor');
    });

    test('should include test refund request in list', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests');

      expect(response.status()).toBe(200);
      const body = await response.json();

      const testRequest = body.data.find((r: any) => r.id === testRefundRequestId);
      expect(testRequest).toBeDefined();
      expect(testRequest.status).toBe('pending');
      expect(testRequest.requested_amount).toBe(9900);
    });

    test('should support status filter - pending', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests?status=pending');

      expect(response.status()).toBe(200);
      const body = await response.json();

      body.data.forEach((r: any) => {
        expect(r.status).toBe('pending');
      });
    });

    test('should return 400 for invalid status filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests?status=invalid');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should support user_id filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/refund-requests?user_id=${adminUserId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      body.data.forEach((r: any) => {
        expect(r.user_id).toBe(adminUserId);
      });
    });

    test('should support product_id filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/refund-requests?product_id=${testProductId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      body.data.forEach((r: any) => {
        expect(r.product_id).toBe(testProductId);
      });
    });

    test('should support limit parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests?limit=5');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.length).toBeLessThanOrEqual(5);
    });

    test('should include product details in response', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests');

      expect(response.status()).toBe(200);
      const body = await response.json();

      const requestWithProduct = body.data.find((r: any) => r.product !== null);
      if (requestWithProduct) {
        expect(requestWithProduct.product).toHaveProperty('id');
        expect(requestWithProduct.product).toHaveProperty('name');
        expect(requestWithProduct.product).toHaveProperty('slug');
      } else {
        expect.fail('Expected at least one refund request with product details but none found');
      }
    });

    test('should include transaction details in response', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests');

      expect(response.status()).toBe(200);
      const body = await response.json();

      const requestWithTx = body.data.find((r: any) => r.transaction !== null);
      if (requestWithTx) {
        expect(requestWithTx.transaction).toHaveProperty('id');
        expect(requestWithTx.transaction).toHaveProperty('customer_email');
        expect(requestWithTx.transaction).toHaveProperty('amount');
      } else {
        expect.fail('Expected at least one refund request with transaction details but none found');
      }
    });
  });

  test.describe('GET /api/v1/refund-requests/:id', () => {
    test('should return refund request details', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/refund-requests/${testRefundRequestId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.id).toBe(testRefundRequestId);
      expect(body.data.status).toBe('pending');
      expect(body.data.requested_amount).toBe(9900);
      expect(body.data).toHaveProperty('product');
      expect(body.data).toHaveProperty('transaction');
      expect(body.data).toHaveProperty('created_at');
    });

    test('should return 404 for non-existent refund request', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests/11111111-1111-4111-a111-111111111111');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid refund request ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests/invalid-id');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('PATCH /api/v1/refund-requests/:id', () => {
    test('should return 400 for missing action', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch(`/api/v1/refund-requests/${testRefundRequestId}`, {
        data: {}
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message.toLowerCase()).toContain('action');
    });

    test('should return 400 for invalid action', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch(`/api/v1/refund-requests/${testRefundRequestId}`, {
        data: {
          action: 'invalid'
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 404 for non-existent refund request', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch('/api/v1/refund-requests/11111111-1111-4111-a111-111111111111', {
        data: {
          action: 'reject'
        }
      });

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid refund request ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch('/api/v1/refund-requests/invalid-id', {
        data: {
          action: 'reject'
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should reject a pending refund request', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a new transaction for this test
      const randomStr = Math.random().toString(36).substring(7);
      const { data: newTransaction } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          customer_email: `reject-tx-${randomStr}@example.com`,
          amount: 5000,
          currency: 'PLN',
          status: 'completed',
          stripe_payment_intent_id: `pi_reject_${randomStr}`,
          product_id: testProductId,
          user_id: adminUserId,
          session_id: `cs_reject_${randomStr}`,
        })
        .select('id')
        .single();

      // Create a new request to reject
      const { data: newRequest } = await supabaseAdmin
        .from('refund_requests')
        .insert({
          transaction_id: newTransaction!.id,
          user_id: adminUserId,
          customer_email: `reject-test-${randomStr}@example.com`,
          product_id: testProductId,
          requested_amount: 5000,
          currency: 'PLN',
          reason: 'Request to reject',
          status: 'pending',
        })
        .select('id')
        .single();

      try {
        const response = await page.request.patch(`/api/v1/refund-requests/${newRequest!.id}`, {
          data: {
            action: 'reject',
            admin_response: 'Does not meet refund criteria'
          }
        });

        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.data.status).toBe('rejected');

        // Verify the request was updated
        const { data: updated } = await supabaseAdmin
          .from('refund_requests')
          .select('status, admin_response')
          .eq('id', newRequest!.id)
          .single();

        expect(updated!.status).toBe('rejected');
        expect(updated!.admin_response).toBe('Does not meet refund criteria');
      } finally {
        await supabaseAdmin.from('refund_requests').delete().eq('id', newRequest!.id);
        await supabaseAdmin.from('payment_transactions').delete().eq('id', newTransaction!.id);
      }
    });

    test('should return 400 for already processed request', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a new transaction for this test
      const randomStr = Math.random().toString(36).substring(7);
      const { data: newTransaction } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          customer_email: `processed-tx-${randomStr}@example.com`,
          amount: 5000,
          currency: 'PLN',
          status: 'completed',
          stripe_payment_intent_id: `pi_processed_${randomStr}`,
          product_id: testProductId,
          user_id: adminUserId,
          session_id: `cs_processed_${randomStr}`,
        })
        .select('id')
        .single();

      // Create and reject a request
      const { data: processedRequest } = await supabaseAdmin
        .from('refund_requests')
        .insert({
          transaction_id: newTransaction!.id,
          user_id: adminUserId,
          customer_email: `processed-test-${randomStr}@example.com`,
          product_id: testProductId,
          requested_amount: 5000,
          currency: 'PLN',
          reason: 'Already processed',
          status: 'rejected',
          admin_response: 'Already rejected',
          processed_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      try {
        const response = await page.request.patch(`/api/v1/refund-requests/${processedRequest!.id}`, {
          data: {
            action: 'approve'
          }
        });

        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.error.code).toBe('INVALID_INPUT');
        expect(body.error.message).toContain('pending');
      } finally {
        await supabaseAdmin.from('refund_requests').delete().eq('id', processedRequest!.id);
        await supabaseAdmin.from('payment_transactions').delete().eq('id', newTransaction!.id);
      }
    });
  });

  test.describe('Cursor Pagination', () => {
    test('should support cursor-based pagination', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Get first page with limit 1
      const response1 = await page.request.get('/api/v1/refund-requests?limit=1');
      expect(response1.status()).toBe(200);
      const body1 = await response1.json();

      if (body1.pagination.has_more && body1.pagination.next_cursor) {
        // Get second page using cursor
        const response2 = await page.request.get(
          `/api/v1/refund-requests?limit=1&cursor=${body1.pagination.next_cursor}`
        );
        expect(response2.status()).toBe(200);
        const body2 = await response2.json();

        // Second page should have different items
        expect(body2.data.length).toBeGreaterThan(0);
        expect(body2.data[0].id).not.toBe(body1.data[0].id);
      } else {
        expect.fail('Expected pagination with has_more=true and next_cursor but got none (need more than 1 refund request)');
      }
    });

    test('should return 400 for invalid cursor format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/refund-requests?cursor=invalid-cursor');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });
});
