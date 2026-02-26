/**
 * API Integration Tests: Refund Requests
 *
 * Migrated from api-v1-refund-requests.spec.ts (Playwright → Vitest)
 * Tests refund request list, single request, and approve/reject operations.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, patch, deleteTestApiKey, API_URL, supabase } from './setup';

interface RefundRequest {
  id: string;
  transaction_id: string;
  user_id: string;
  customer_email: string;
  product_id: string;
  requested_amount: number;
  currency: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_response?: string;
  processed_at?: string;
  product?: {
    id: string;
    name: string;
    slug: string;
  };
  transaction?: {
    id: string;
    customer_email: string;
    amount: number;
  };
  created_at: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { cursor: string | null; next_cursor: string | null; has_more: boolean; limit: number };
}

describe('Refund Requests API v1', () => {
  let testProductId: string;
  let testTransactionId: string;
  let testRefundRequestId: string;
  let testUserId: string;

  beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create a test user
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: `refund-test-${randomStr}@example.com`,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    if (userError) throw userError;
    testUserId = userData.user!.id;

    // Create a test product
    const { data: product, error: productError } = await supabase
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
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .insert({
        customer_email: `customer-${randomStr}@example.com`,
        amount: 9900,
        currency: 'PLN',
        status: 'completed',
        stripe_payment_intent_id: `pi_test_${randomStr}`,
        product_id: testProductId,
        user_id: testUserId,
        session_id: `cs_test_${randomStr}`,
        metadata: { test: true },
      })
      .select('id')
      .single();

    if (txError) throw txError;
    testTransactionId = transaction.id;

    // Create a test refund request
    const { data: refundRequest, error: refundError } = await supabase
      .from('refund_requests')
      .insert({
        transaction_id: testTransactionId,
        user_id: testUserId,
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

  afterAll(async () => {
    // Cleanup - delete in reverse order of foreign key dependencies
    if (testRefundRequestId) {
      await supabase.from('refund_requests').delete().eq('id', testRefundRequestId);
    }
    if (testTransactionId) {
      await supabase.from('payment_transactions').delete().eq('id', testTransactionId);
    }
    if (testProductId) {
      await supabase.from('products').delete().eq('id', testProductId);
    }
    if (testUserId) {
      await supabase.auth.admin.deleteUser(testUserId);
    }
    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests to list refund requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/refund-requests`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated requests to single refund request', async () => {
      const response = await fetch(`${API_URL}/api/v1/refund-requests/${testRefundRequestId}`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated PATCH requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/refund-requests/${testRefundRequestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/refund-requests', () => {
    it('should return paginated list of refund requests', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>('/api/v1/refund-requests');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('has_more');
      expect(data.pagination).toHaveProperty('next_cursor');
    });

    it('should include test refund request in list', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>('/api/v1/refund-requests');

      expect(status).toBe(200);
      const testRequest = data.data!.find((r) => r.id === testRefundRequestId);
      expect(testRequest).toBeDefined();
      expect(testRequest!.status).toBe('pending');
      expect(testRequest!.requested_amount).toBe(9900);
    });

    it('should support status filter - pending', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>(
        '/api/v1/refund-requests?status=pending'
      );

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const r of data.data!) {
        expect(r.status).toBe('pending');
      }
    });

    it('should return 400 for invalid status filter', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>(
        '/api/v1/refund-requests?status=invalid'
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should support user_id filter', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>(
        `/api/v1/refund-requests?user_id=${testUserId}`
      );

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const r of data.data!) {
        expect(r.user_id).toBe(testUserId);
      }
    });

    it('should support product_id filter', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>(
        `/api/v1/refund-requests?product_id=${testProductId}`
      );

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const r of data.data!) {
        expect(r.product_id).toBe(testProductId);
      }
    });

    it('should support limit parameter', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>(
        '/api/v1/refund-requests?limit=5'
      );

      expect(status).toBe(200);
      expect(data.data!.length).toBeLessThanOrEqual(5);
    });

    it('should include product details in response', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>('/api/v1/refund-requests');

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      const requestWithProduct = data.data!.find((r) => r.product !== null);
      expect(requestWithProduct).toBeDefined();
      expect(requestWithProduct!.product).toHaveProperty('id');
      expect(requestWithProduct!.product).toHaveProperty('name');
      expect(requestWithProduct!.product).toHaveProperty('slug');
    });

    it('should include transaction details in response', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>('/api/v1/refund-requests');

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      const requestWithTx = data.data!.find((r) => r.transaction !== null);
      expect(requestWithTx).toBeDefined();
      expect(requestWithTx!.transaction).toHaveProperty('id');
      expect(requestWithTx!.transaction).toHaveProperty('customer_email');
      expect(requestWithTx!.transaction).toHaveProperty('amount');
    });
  });

  describe('GET /api/v1/refund-requests/:id', () => {
    it('should return refund request details', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest>>(
        `/api/v1/refund-requests/${testRefundRequestId}`
      );

      expect(status).toBe(200);
      expect(data.data!.id).toBe(testRefundRequestId);
      expect(data.data!.status).toBe('pending');
      expect(data.data!.requested_amount).toBe(9900);
      expect(data.data).toHaveProperty('product');
      expect(data.data).toHaveProperty('transaction');
      expect(data.data).toHaveProperty('created_at');
    });

    it('should return 404 for non-existent refund request', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest>>(
        '/api/v1/refund-requests/11111111-1111-4111-a111-111111111111'
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid refund request ID format', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest>>(
        '/api/v1/refund-requests/invalid-id'
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('PATCH /api/v1/refund-requests/:id', () => {
    it('should return 400 for missing action', async () => {
      const { status, data } = await patch<ApiResponse<RefundRequest>>(
        `/api/v1/refund-requests/${testRefundRequestId}`,
        {}
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
      expect(data.error!.message.toLowerCase()).toContain('action');
    });

    it('should return 400 for invalid action', async () => {
      const { status, data } = await patch<ApiResponse<RefundRequest>>(
        `/api/v1/refund-requests/${testRefundRequestId}`,
        { action: 'invalid' }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 404 for non-existent refund request', async () => {
      const { status, data } = await patch<ApiResponse<RefundRequest>>(
        '/api/v1/refund-requests/11111111-1111-4111-a111-111111111111',
        { action: 'reject' }
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid refund request ID format', async () => {
      const { status, data } = await patch<ApiResponse<RefundRequest>>(
        '/api/v1/refund-requests/invalid-id',
        { action: 'reject' }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should reject a pending refund request', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create a new transaction for this test
      const { data: newTransaction } = await supabase
        .from('payment_transactions')
        .insert({
          customer_email: `reject-tx-${randomStr}@example.com`,
          amount: 5000,
          currency: 'PLN',
          status: 'completed',
          stripe_payment_intent_id: `pi_reject_${randomStr}`,
          product_id: testProductId,
          user_id: testUserId,
          session_id: `cs_reject_${randomStr}`,
        })
        .select('id')
        .single();

      // Create a new request to reject
      const { data: newRequest } = await supabase
        .from('refund_requests')
        .insert({
          transaction_id: newTransaction!.id,
          user_id: testUserId,
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
        const { status, data } = await patch<ApiResponse<RefundRequest>>(
          `/api/v1/refund-requests/${newRequest!.id}`,
          {
            action: 'reject',
            admin_response: 'Does not meet refund criteria',
          }
        );

        expect(status).toBe(200);
        expect(data.data!.status).toBe('rejected');

        // Verify the request was updated
        const { data: updated } = await supabase
          .from('refund_requests')
          .select('status, admin_response')
          .eq('id', newRequest!.id)
          .single();

        expect(updated!.status).toBe('rejected');
        expect(updated!.admin_response).toBe('Does not meet refund criteria');
      } finally {
        await supabase.from('refund_requests').delete().eq('id', newRequest!.id);
        await supabase.from('payment_transactions').delete().eq('id', newTransaction!.id);
      }
    });

    it('should return 400 for already processed request', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create a new transaction for this test
      const { data: newTransaction } = await supabase
        .from('payment_transactions')
        .insert({
          customer_email: `processed-tx-${randomStr}@example.com`,
          amount: 5000,
          currency: 'PLN',
          status: 'completed',
          stripe_payment_intent_id: `pi_processed_${randomStr}`,
          product_id: testProductId,
          user_id: testUserId,
          session_id: `cs_processed_${randomStr}`,
        })
        .select('id')
        .single();

      // Create and reject a request
      const { data: processedRequest } = await supabase
        .from('refund_requests')
        .insert({
          transaction_id: newTransaction!.id,
          user_id: testUserId,
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
        const { status, data } = await patch<ApiResponse<RefundRequest>>(
          `/api/v1/refund-requests/${processedRequest!.id}`,
          { action: 'approve' }
        );

        expect(status).toBe(400);
        expect(data.error!.code).toBe('INVALID_INPUT');
        expect(data.error!.message).toContain('pending');
      } finally {
        await supabase.from('refund_requests').delete().eq('id', processedRequest!.id);
        await supabase.from('payment_transactions').delete().eq('id', newTransaction!.id);
      }
    });
  });

  describe('Cursor Pagination', () => {
    it('should support cursor-based pagination', async () => {
      // Get first page with limit 1
      const response1 = await get<ApiResponse<RefundRequest[]>>('/api/v1/refund-requests?limit=1');
      expect(response1.status).toBe(200);

      if (!response1.data.pagination?.has_more || !response1.data.pagination?.next_cursor) {
        // Only one refund request exists — pagination cannot be tested, but at least we got data
        expect(response1.data.data!.length).toBe(1);
        return;
      }

      // Get second page using cursor
      const response2 = await get<ApiResponse<RefundRequest[]>>(
        `/api/v1/refund-requests?limit=1&cursor=${response1.data.pagination.next_cursor}`
      );
      expect(response2.status).toBe(200);
      expect(response2.data.data!.length).toBeGreaterThan(0);
      expect(response2.data.data![0].id).not.toBe(response1.data.data![0].id);
    });

    it('should return 400 for invalid cursor format', async () => {
      const { status, data } = await get<ApiResponse<RefundRequest[]>>(
        '/api/v1/refund-requests?cursor=invalid-cursor'
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });
});
