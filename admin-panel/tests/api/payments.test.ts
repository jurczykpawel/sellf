/**
 * API Integration Tests: Payments
 *
 * Migrated from api-v1-payments.spec.ts (Playwright → Vitest)
 * Tests list payments, single payment, filters, and refund endpoints.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, post, deleteTestApiKey, API_URL, supabase } from './setup';

interface Payment {
  id: string;
  customer_email: string;
  amount: number;
  currency: string;
  status: string;
  stripe_payment_intent_id: string;
  product: {
    id: string;
    name: string;
    slug: string;
  };
  user?: {
    id: string;
    email: string;
  };
  refund?: {
    id: string;
    amount: number;
    reason: string;
  } | null;
  created_at: string;
  updated_at: string;
}

interface PaymentStats {
  total_revenue: number;
  total_transactions: number;
  avg_transaction_value: number;
  refund_rate: number;
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { cursor: string | null; next_cursor: string | null; has_more: boolean; limit: number };
}

describe('Payments API v1', () => {
  let testProductId: string;
  let testTransactionId: string;

  beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create a test product
    const { data: product, error: productError } = await supabase
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
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .insert({
        customer_email: `customer-${randomStr}@example.com`,
        amount: 9900,
        currency: 'PLN',
        status: 'completed',
        stripe_payment_intent_id: `pi_test_${randomStr}`,
        product_id: testProductId,
        session_id: `cs_test_${randomStr}`,
        metadata: { test: true },
      })
      .select('id')
      .single();

    if (txError) throw txError;
    testTransactionId = transaction.id;
  });

  afterAll(async () => {
    // Cleanup
    if (testTransactionId) {
      await supabase.from('payment_transactions').delete().eq('id', testTransactionId);
    }
    if (testProductId) {
      await supabase.from('products').delete().eq('id', testProductId);
    }
    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests to list payments', async () => {
      const response = await fetch(`${API_URL}/api/v1/payments`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated requests to single payment', async () => {
      const response = await fetch(`${API_URL}/api/v1/payments/${testTransactionId}`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated refund requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/payments/${testTransactionId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/payments', () => {
    it('should return paginated list of payments', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('has_more');
      expect(data.pagination).toHaveProperty('next_cursor');
    });

    it('should include test transaction in list', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments');

      expect(status).toBe(200);
      const testTx = data.data!.find((p) => p.id === testTransactionId);
      expect(testTx).toBeDefined();
      expect(testTx!.amount).toBe(9900);
      expect(testTx!.currency).toBe('PLN');
      expect(testTx!.status).toBe('completed');
    });

    it('should support status filter', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments?status=completed');

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const p of data.data!) {
        expect(p.status).toBe('completed');
      }
    });

    it('should support product_id filter', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>(
        `/api/v1/payments?product_id=${testProductId}`
      );

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const p of data.data!) {
        expect(p.product.id).toBe(testProductId);
      }
    });

    it('should support email filter', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments?email=customer');

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const p of data.data!) {
        expect(p.customer_email.toLowerCase()).toContain('customer');
      }
    });

    it('should support limit parameter', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments?limit=5');

      expect(status).toBe(200);
      expect(data.data!.length).toBeLessThanOrEqual(5);
    });

    it('should support sorting', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments?sort=-amount');

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(1);
      for (let i = 0; i < data.data!.length - 1; i++) {
        expect(data.data![i].amount).toBeGreaterThanOrEqual(data.data![i + 1].amount);
      }
    });

    it('should reject invalid sort field', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments?sort=invalid');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should support date range filters', async () => {
      const today = new Date().toISOString().split('T')[0];
      const { status, data } = await get<ApiResponse<Payment[]>>(`/api/v1/payments?date_from=${today}`);

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const p of data.data!) {
        const txDate = new Date(p.created_at).toISOString().split('T')[0];
        expect(txDate >= today).toBe(true);
      }
    });
  });

  describe('GET /api/v1/payments/:id', () => {
    it('should return payment details', async () => {
      const { status, data } = await get<ApiResponse<Payment>>(`/api/v1/payments/${testTransactionId}`);

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data.data!.id).toBe(testTransactionId);
      expect(data.data!.amount).toBe(9900);
      expect(data.data!.currency).toBe('PLN');
      expect(data.data!.status).toBe('completed');
      expect(data.data!).toHaveProperty('product');
      expect(data.data!.product.id).toBe(testProductId);
      expect(data.data!).toHaveProperty('stripe_payment_intent_id');
      expect(data.data!).toHaveProperty('created_at');
      expect(data.data!).toHaveProperty('updated_at');
    });

    it('should return 404 for non-existent payment', async () => {
      const { status, data } = await get<ApiResponse<Payment>>(
        '/api/v1/payments/11111111-1111-4111-a111-111111111111'
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid payment ID format', async () => {
      const { status, data } = await get<ApiResponse<Payment>>('/api/v1/payments/invalid-id');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should include refund info if payment was refunded', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create a refunded transaction
      const { data: refundedTx, error: txError } = await supabase
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
          refund_reason: 'requested_by_customer',
        })
        .select('id')
        .single();

      if (txError) throw txError;

      try {
        const { status, data } = await get<ApiResponse<Payment>>(`/api/v1/payments/${refundedTx.id}`);

        expect(status).toBe(200);
        expect(data.data!.status).toBe('refunded');
        expect(data.data!.refund).not.toBeNull();
        expect(data.data!.refund!.id).toBe(`re_test_${randomStr}`);
        expect(data.data!.refund!.amount).toBe(5000);
        expect(data.data!.refund!.reason).toBe('requested_by_customer');
      } finally {
        await supabase.from('payment_transactions').delete().eq('id', refundedTx.id);
      }
    });
  });

  describe('GET /api/v1/payments/stats', () => {
    it('should return payment statistics', async () => {
      const { status, data } = await get<ApiResponse<PaymentStats>>('/api/v1/payments/stats');

      expect(status).toBe(200);
      expect(data.data).toBeDefined();
      expect(typeof data.data!.total_revenue).toBe('number');
      expect(typeof data.data!.total_transactions).toBe('number');
    });

    it('should support period filter', async () => {
      const { status, data } = await get<ApiResponse<PaymentStats>>('/api/v1/payments/stats?period=30d');

      expect(status).toBe(200);
      expect(data.data).toBeDefined();
    });
  });

  describe('POST /api/v1/payments/:id/refund', () => {
    it('should return 404 for non-existent payment', async () => {
      const { status, data } = await post<ApiResponse<Payment>>(
        '/api/v1/payments/11111111-1111-4111-a111-111111111111/refund',
        {}
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid payment ID format', async () => {
      const { status, data } = await post<ApiResponse<Payment>>('/api/v1/payments/invalid-id/refund', {});

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for invalid refund reason', async () => {
      const { status, data } = await post<ApiResponse<Payment>>(
        `/api/v1/payments/${testTransactionId}/refund`,
        { reason: 'invalid_reason' }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
      expect(data.error!.message.toLowerCase()).toContain('reason');
    });

    it('should return 400 for negative refund amount', async () => {
      const { status, data } = await post<ApiResponse<Payment>>(
        `/api/v1/payments/${testTransactionId}/refund`,
        { amount: -100 }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for refund amount exceeding available', async () => {
      const { status, data } = await post<ApiResponse<Payment>>(
        `/api/v1/payments/${testTransactionId}/refund`,
        { amount: 999999999 }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
      expect(data.error!.message.toLowerCase()).toContain('exceed');
    });
  });

  describe('POST /api/v1/payments/export', () => {
    it('initiates payment export', async () => {
      const { status, data } = await post<ApiResponse<{ export_id: string; status: string }>>(
        '/api/v1/payments/export',
        {
          date_from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          date_to: new Date().toISOString().split('T')[0],
          format: 'csv',
        }
      );

      if (status === 200 || status === 201) {
        // Export started successfully — response should be CSV or contain export data
        expect(data).toBeDefined();
      } else if (status === 400) {
        expect(data.error).toBeDefined();
      } else {
        expect.fail(`Expected status 200, 201, or 400 but got ${status}`);
      }
    });
  });

  describe('Cursor Pagination', () => {
    it('should support cursor-based pagination', async () => {
      const response1 = await get<ApiResponse<Payment[]>>('/api/v1/payments?limit=1');
      expect(response1.status).toBe(200);
      expect(response1.data.pagination?.has_more).toBe(true);
      expect(response1.data.pagination?.next_cursor).toBeTruthy();

      const response2 = await get<ApiResponse<Payment[]>>(
        `/api/v1/payments?limit=1&cursor=${response1.data.pagination!.next_cursor}`
      );
      expect(response2.status).toBe(200);
      expect(response2.data.data!.length).toBeGreaterThan(0);
      expect(response2.data.data![0].id).not.toBe(response1.data.data![0].id);
    });

    it('should return 400 for invalid cursor format', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments?cursor=invalid-cursor');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('Response Format', () => {
    it('should use standardized success response format', async () => {
      const { status, data } = await get<ApiResponse<Payment>>(`/api/v1/payments/${testTransactionId}`);

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('amount');
      expect(data.data).toHaveProperty('currency');
      expect(data.data).toHaveProperty('status');
      expect(data.data).toHaveProperty('created_at');
    });

    it('should use standardized error response format', async () => {
      const { status, data } = await get<ApiResponse<Payment>>('/api/v1/payments/invalid-id');

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code');
      expect(data.error).toHaveProperty('message');
      expect(typeof data.error!.code).toBe('string');
      expect(typeof data.error!.message).toBe('string');
    });

    it('should include pagination in list responses', async () => {
      const { status, data } = await get<ApiResponse<Payment[]>>('/api/v1/payments');

      expect(status).toBe(200);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('next_cursor');
      expect(data.pagination).toHaveProperty('has_more');
      expect(typeof data.pagination!.has_more).toBe('boolean');
    });
  });
});
