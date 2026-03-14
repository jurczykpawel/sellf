import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * Stripe Webhook Tests
 *
 * These tests verify the Stripe webhook endpoint security and functionality.
 *
 * IMPORTANT: These tests require:
 * - STRIPE_WEBHOOK_SECRET in .env.local (for signature generation)
 * - STRIPE_SECRET_KEY in .env.local (for Stripe API)
 * - Running Supabase instance
 */

test.describe('Stripe Webhook Security', () => {
  const WEBHOOK_URL = '/api/webhooks/stripe';

  // Get secrets from env
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // Skip tests if webhook secret not configured
  test.beforeAll(async () => {
    if (!WEBHOOK_SECRET) {
      console.log('⚠️  STRIPE_WEBHOOK_SECRET not set. Webhook tests will be skipped.');
    }
  });

  test.beforeEach(async () => {
    if (!WEBHOOK_SECRET) {
      test.skip();
    }
  });

  /**
   * Generate valid Stripe webhook signature
   */
  function generateWebhookSignature(payload: string, secret: string): string {
    const stripe = new Stripe(STRIPE_SECRET_KEY || 'sk_test_fake', {
      apiVersion: '2025-12-15.clover',
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;

    // Use crypto to generate HMAC
    const crypto = require('crypto');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    return `t=${timestamp},v1=${signature}`;
  }

  /**
   * Create a mock Stripe event payload
   */
  function createMockEvent(
    type: string,
    data: Record<string, any>,
    id?: string
  ): { payload: string; event: any } {
    const event = {
      id: id || `evt_test_${Date.now()}`,
      object: 'event',
      api_version: '2025-12-15.clover',
      created: Math.floor(Date.now() / 1000),
      type,
      data: {
        object: data,
      },
    };
    return {
      payload: JSON.stringify(event),
      event,
    };
  }

  // ============================================
  // SIGNATURE VERIFICATION TESTS
  // ============================================

  test.describe('Signature Verification', () => {
    test('should reject requests without signature header', async ({ request }) => {
      const { payload } = createMockEvent('checkout.session.completed', {
        id: 'cs_test_123',
        payment_status: 'paid',
      });

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          // No stripe-signature header
        },
      });

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Missing signature');
    });

    test('should reject requests with invalid signature', async ({ request }) => {
      const { payload } = createMockEvent('checkout.session.completed', {
        id: 'cs_test_123',
        payment_status: 'paid',
      });

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=12345,v1=invalid_signature_here',
        },
      });

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Invalid signature');
    });

    test('should reject requests with expired signature', async ({ request }) => {
      const { payload } = createMockEvent('checkout.session.completed', {
        id: 'cs_test_123',
        payment_status: 'paid',
      });

      // Generate signature with old timestamp (> 5 minutes ago)
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const signedPayload = `${oldTimestamp}.${payload}`;
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(signedPayload)
        .digest('hex');

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': `t=${oldTimestamp},v1=${signature}`,
        },
      });

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Invalid signature');
    });

    test('should reject requests with tampered payload', async ({ request }) => {
      const { payload } = createMockEvent('checkout.session.completed', {
        id: 'cs_test_123',
        payment_status: 'paid',
      });

      // Generate valid signature for original payload
      const validSignature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      // Tamper with the payload
      const tamperedPayload = payload.replace('cs_test_123', 'cs_test_hacked');

      const response = await request.post(WEBHOOK_URL, {
        data: tamperedPayload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': validSignature,
        },
      });

      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Invalid signature');
    });

    test('should accept requests with valid signature', async ({ request }) => {
      const { payload, event } = createMockEvent('ping', {});
      const validSignature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': validSignature,
        },
      });

      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.received).toBe(true);
      // Security-hardened response: no event details leaked
    });
  });

  // ============================================
  // EVENT HANDLING TESTS
  // ============================================

  test.describe('Event Handling', () => {
    test('should acknowledge unhandled event types', async ({ request }) => {
      const { payload, event } = createMockEvent('customer.created', {
        id: 'cus_test_123',
      });
      const signature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature,
        },
      });

      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.received).toBe(true);
      // Security-hardened response: internal processing details not exposed
    });

    test('should skip checkout.session.completed if payment not paid', async ({ request }) => {
      const { payload, event } = createMockEvent('checkout.session.completed', {
        id: 'cs_test_unpaid',
        payment_status: 'unpaid',
        metadata: {
          product_id: '00000000-0000-0000-0000-000000000001',
        },
      });
      const signature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature,
        },
      });

      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.received).toBe(true);
      // Security-hardened response: skip reason not exposed
    });

    test('should handle checkout.session.completed with missing metadata', async ({ request }) => {
      const { payload } = createMockEvent('checkout.session.completed', {
        id: 'cs_test_no_meta',
        payment_status: 'paid',
        // No metadata - missing product_id
        customer_details: {
          email: 'test@example.com',
        },
      });
      const signature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature,
        },
      });

      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.received).toBe(true);
      // Security-hardened response: error details not exposed
    });

    test('should handle payment_intent.succeeded with missing metadata', async ({ request }) => {
      const { payload } = createMockEvent('payment_intent.succeeded', {
        id: 'pi_test_no_meta',
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
        // No metadata
      });
      const signature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature,
        },
      });

      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.received).toBe(true);
      // Security-hardened response: error details not exposed
    });
  });

  // ============================================
  // IDEMPOTENCY TESTS
  // ============================================

  test.describe('Idempotency', () => {
    let supabaseAdmin: ReturnType<typeof createClient>;
    let testProductId: string;
    let testProductPrice: number;
    let testProductCurrency: string;
    let testSessionId: string;

    test.beforeAll(async () => {
      if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        return;
      }

      supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

      // Create test product with price > 0
      const suffix = Date.now().toString();
      const { data: product, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Idempotency Test ${suffix}`,
          slug: `idempotency-test-${suffix}`,
          price: 49.99,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to create test product:', error);
        return;
      }

      testProductId = product.id;
      testProductPrice = Math.round(product.price * 100); // Convert to cents
      testProductCurrency = product.currency?.toLowerCase() || 'usd';

      testSessionId = `cs_test_idempotency_${Date.now()}`;
      console.log(`Created idempotency test product: ${product.name} ($${product.price})`);
    });

    test.afterAll(async () => {
      if (supabaseAdmin && testProductId) {
        await supabaseAdmin.from('payment_transactions').delete().eq('product_id', testProductId);
        await supabaseAdmin.from('products').delete().eq('id', testProductId);
      }
    });

    test('should process same event only once (idempotency)', async ({ request }) => {
      if (!testProductId) {
        test.skip();
        return;
      }

      const eventId = `evt_test_idempotency_${Date.now()}`;
      const { payload } = createMockEvent(
        'checkout.session.completed',
        {
          id: testSessionId,
          payment_status: 'paid',
          amount_total: testProductPrice,
          currency: testProductCurrency,
          metadata: {
            product_id: testProductId,
          },
          customer_details: {
            email: `webhook-test-${Date.now()}@example.com`,
          },
        },
        eventId
      );
      const signature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      // First request
      const response1 = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature,
        },
      });

      expect(response1.status()).toBe(200);
      const json1 = await response1.json();
      expect(json1.received).toBe(true);

      // Second request with same session_id (simulate Stripe retry)
      // Need to generate new signature because timestamp changed
      const signature2 = generateWebhookSignature(payload, WEBHOOK_SECRET);

      const response2 = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature2,
        },
      });

      expect(response2.status()).toBe(200);
      const json2 = await response2.json();
      expect(json2.received).toBe(true);

      // Security-hardened response doesn't expose processing details.
      // Verify idempotency by checking DB: only 1 transaction for this session_id
      const { data: transactions } = await supabaseAdmin
        .from('payment_transactions')
        .select('id')
        .eq('session_id', testSessionId);
      expect(transactions?.length).toBeLessThanOrEqual(1);
    });
  });

  // ============================================
  // REFUND HANDLING TESTS
  // ============================================

  test.describe('Refund Handling', () => {
    test('should handle charge.refunded for non-existent transaction', async ({ request }) => {
      const { payload } = createMockEvent('charge.refunded', {
        id: 'ch_test_nonexistent',
        payment_intent: 'pi_test_nonexistent_12345',
        amount_refunded: 1000,
        refunds: {
          data: [{ id: 'ref_test_123' }],
        },
      });
      const signature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature,
        },
      });

      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.received).toBe(true);
      // Security-hardened response: refund processing details not exposed
    });
  });

  // ============================================
  // DISPUTE HANDLING TESTS
  // ============================================

  test.describe('Dispute Handling', () => {
    test('should handle charge.dispute.created for non-existent charge', async ({ request }) => {
      // This test will fail to find the transaction but should not error
      const { payload } = createMockEvent('charge.dispute.created', {
        id: 'dp_test_123',
        charge: 'ch_test_nonexistent_dispute',
        reason: 'fraudulent',
        status: 'needs_response',
        created: Math.floor(Date.now() / 1000),
      });
      const signature = generateWebhookSignature(payload, WEBHOOK_SECRET);

      const response = await request.post(WEBHOOK_URL, {
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signature,
        },
      });

      // Should return 200 (webhook acknowledged) even if processing fails
      expect(response.status()).toBe(200);
      const json = await response.json();
      expect(json.received).toBe(true);
    });
  });

  // ============================================
  // HTTP METHOD TESTS
  // ============================================

  test.describe('HTTP Methods', () => {
    test('should reject GET requests', async ({ request }) => {
      const response = await request.get(WEBHOOK_URL);
      expect(response.status()).toBe(405);
    });
  });
});

// ============================================
// INTEGRATION TESTS (with real Stripe)
// ============================================

test.describe('Stripe Webhook Integration', () => {
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  test.beforeEach(async () => {
    if (!WEBHOOK_SECRET) {
      test.skip();
    }
  });

  test('webhook endpoint should be accessible', async ({ request }) => {
    // Simple connectivity test
    const response = await request.get('/api/webhooks/stripe');
    // Should get 405 (method not allowed) not 404
    expect(response.status()).toBe(405);
  });
});
