/**
 * Abandoned Cart Recovery - Unit Tests
 *
 * Tests for abandoned cart tracking and recovery RPC functions.
 * Covers:
 * - Pending payment creation
 * - Status transitions (pending → completed/abandoned)
 * - Expiration handling
 * - Statistics and queries
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

describe('Abandoned Cart Recovery', () => {
  let testProductId: string;
  let testAdminUserId: string;

  beforeAll(async () => {
    // Create test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Abandoned Cart Test Product ${Date.now()}`,
        slug: `abandoned-test-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true
      })
      .select()
      .single();

    if (productError) throw productError;
    testProductId = product.id;

    // Create admin user for RPC tests
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: `admin-abandoned-test-${Date.now()}@example.com`,
      password: 'test123456',
      email_confirm: true
    });

    if (authError) throw authError;
    testAdminUserId = authData.user.id;

    // Make user admin
    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: testAdminUserId });
  });

  afterAll(async () => {
    // Clean up
    if (testProductId) {
      await supabaseAdmin.from('products').delete().eq('id', testProductId);
    }
    if (testAdminUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testAdminUserId);
    }
  });

  describe('Pending Payment Creation', () => {
    it('should create pending payment transaction', async () => {
      const paymentIntentId = `pi_test_pending_${Date.now()}`;

      const { error } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: `test-pending-${Date.now()}@example.com`,
          amount: 10000,
          currency: 'PLN',
          status: 'pending',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

      expect(error).toBeNull();

      // Verify it was created
      const { data: payment } = await supabaseAdmin
        .from('payment_transactions')
        .select('*')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .single();

      expect(payment).toBeDefined();
      expect(payment.status).toBe('pending');
      expect(payment.expires_at).toBeDefined();
    });

    it('should allow pending status in payment_transactions', async () => {
      const paymentIntentId = `pi_test_status_${Date.now()}`;

      const { error } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: 'test-status@example.com',
          amount: 5000,
          currency: 'PLN',
          status: 'pending',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

      expect(error).toBeNull();
    });

    it('should reject invalid status', async () => {
      const paymentIntentId = `pi_test_invalid_${Date.now()}`;

      const { error } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: 'test-invalid@example.com',
          amount: 5000,
          currency: 'PLN',
          status: 'invalid_status' as any,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

      expect(error).not.toBeNull();
      expect(error?.message).toContain('status');
    });
  });

  describe('Status Transitions', () => {
    it('should transition pending → completed', async () => {
      const paymentIntentId = `pi_test_completed_${Date.now()}`;

      // Create pending
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: 'test-completed@example.com',
          amount: 10000,
          currency: 'PLN',
          status: 'pending',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

      // Update to completed
      const { error: updateError } = await supabaseAdmin
        .from('payment_transactions')
        .update({ status: 'completed' })
        .eq('stripe_payment_intent_id', paymentIntentId);

      expect(updateError).toBeNull();

      // Verify
      const { data: payment } = await supabaseAdmin
        .from('payment_transactions')
        .select('status')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .single();

      expect(payment?.status).toBe('completed');
    });

    it('should transition pending → abandoned', async () => {
      const paymentIntentId = `pi_test_abandoned_${Date.now()}`;

      // Create pending
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: 'test-abandoned@example.com',
          amount: 10000,
          currency: 'PLN',
          status: 'pending',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

      // Update to abandoned
      const { error: updateError } = await supabaseAdmin
        .from('payment_transactions')
        .update({
          status: 'abandoned',
          abandoned_at: new Date().toISOString()
        })
        .eq('stripe_payment_intent_id', paymentIntentId);

      expect(updateError).toBeNull();

      // Verify
      const { data: payment } = await supabaseAdmin
        .from('payment_transactions')
        .select('status, abandoned_at')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .single();

      expect(payment?.status).toBe('abandoned');
      expect(payment?.abandoned_at).toBeDefined();
    });
  });

  describe('mark_expired_pending_payments()', () => {
    it('should mark expired pending payments as abandoned', async () => {
      const paymentIntentId = `pi_test_expired_${Date.now()}`;

      // Create pending payment that already expired (1 hour ago)
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: 'test-expired@example.com',
          amount: 10000,
          currency: 'PLN',
          status: 'pending',
          expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
        });

      // Call RPC function to mark expired
      const { data: markedCount, error } = await supabaseAdmin.rpc('mark_expired_pending_payments');

      expect(error).toBeNull();
      expect(markedCount).toBeGreaterThanOrEqual(1);

      // Verify status changed
      const { data: payment } = await supabaseAdmin
        .from('payment_transactions')
        .select('status, abandoned_at')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .single();

      expect(payment?.status).toBe('abandoned');
      expect(payment?.abandoned_at).toBeDefined();
    });

    it('should not mark pending payments that have not expired yet', async () => {
      const paymentIntentId = `pi_test_not_expired_${Date.now()}`;

      // Create pending payment that expires in 1 hour
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: 'test-not-expired@example.com',
          amount: 10000,
          currency: 'PLN',
          status: 'pending',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour from now
        });

      // Call RPC
      await supabaseAdmin.rpc('mark_expired_pending_payments');

      // Verify still pending
      const { data: payment } = await supabaseAdmin
        .from('payment_transactions')
        .select('status')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .single();

      expect(payment?.status).toBe('pending');
    });

    it('should return count of marked payments', async () => {
      // Create multiple expired pending payments
      const paymentIds = [
        `pi_test_count_1_${Date.now()}`,
        `pi_test_count_2_${Date.now()}`,
        `pi_test_count_3_${Date.now()}`
      ];

      for (const paymentId of paymentIds) {
        await supabaseAdmin
          .from('payment_transactions')
          .insert({
            session_id: paymentId,
            stripe_payment_intent_id: paymentId,
            product_id: testProductId,
            customer_email: `test-count-${paymentId}@example.com`,
            amount: 10000,
            currency: 'PLN',
            status: 'pending',
            expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString()
          });
      }

      // Call RPC
      const { data: markedCount, error } = await supabaseAdmin.rpc('mark_expired_pending_payments');

      expect(error).toBeNull();
      expect(markedCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('get_abandoned_carts() - Admin RPC', () => {
    beforeEach(async () => {
      // Create test abandoned cart
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: `pi_test_admin_query_${Date.now()}`,
          stripe_payment_intent_id: `pi_test_admin_query_${Date.now()}`,
          product_id: testProductId,
          customer_email: 'test-admin-query@example.com',
          amount: 15000,
          currency: 'PLN',
          status: 'abandoned',
          abandoned_at: new Date().toISOString(),
          expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString()
        });
    });

    it('should return abandoned carts via service_role client', async () => {
      const { data, error } = await supabaseAdmin.rpc('get_abandoned_carts', {
        days_ago: 7,
        limit_count: 100
      });

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('customer_email');
      expect(data[0]).toHaveProperty('product_id');
      expect(data[0]).toHaveProperty('amount');
    });

    it('should filter by days_ago parameter', async () => {
      // Create abandoned cart from 10 days ago
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: `pi_test_old_cart_${Date.now()}`,
          stripe_payment_intent_id: `pi_test_old_cart_${Date.now()}`,
          product_id: testProductId,
          customer_email: 'test-old-cart@example.com',
          amount: 10000,
          currency: 'PLN',
          status: 'abandoned',
          abandoned_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
        });

      // Query last 7 days - should not include 10-day-old cart
      const { data, error } = await supabaseAdmin.rpc('get_abandoned_carts', {
        days_ago: 7,
        limit_count: 100
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      const oldCart = data.find((cart: any) => cart.customer_email === 'test-old-cart@example.com');
      expect(oldCart).toBeUndefined();
    });

    it('should respect limit_count parameter', async () => {
      // Create 5 abandoned carts
      for (let i = 0; i < 5; i++) {
        await supabaseAdmin
          .from('payment_transactions')
          .insert({
            session_id: `pi_test_limit_${i}_${Date.now()}`,
            stripe_payment_intent_id: `pi_test_limit_${i}_${Date.now()}`,
            product_id: testProductId,
            customer_email: `test-limit-${i}@example.com`,
            amount: 10000,
            currency: 'PLN',
            status: 'abandoned',
            abandoned_at: new Date().toISOString()
          });
      }

      // Query with limit 2
      const { data, error } = await supabaseAdmin.rpc('get_abandoned_carts', {
        days_ago: 7,
        limit_count: 2
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.length).toBeLessThanOrEqual(2);
    });
  });

  describe('get_abandoned_cart_stats() - Admin RPC', () => {
    beforeEach(async () => {
      // Clean up old test data
      await supabaseAdmin
        .from('payment_transactions')
        .delete()
        .like('customer_email', 'test-stats-%');

      // Create test data for statistics
      const testData = [
        { status: 'abandoned', amount: 10000 },
        { status: 'abandoned', amount: 20000 },
        { status: 'pending', amount: 15000 },
        { status: 'pending', amount: 25000 }
      ];

      for (let i = 0; i < testData.length; i++) {
        await supabaseAdmin
          .from('payment_transactions')
          .insert({
            session_id: `pi_test_stats_${i}_${Date.now()}`,
            stripe_payment_intent_id: `pi_test_stats_${i}_${Date.now()}`,
            product_id: testProductId,
            customer_email: `test-stats-${i}@example.com`,
            amount: testData[i].amount,
            currency: 'PLN',
            status: testData[i].status,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          });
      }

      // Wait a bit for DB to process
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    it('should return statistics for abandoned carts', async () => {
      const { data, error } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
        days_ago: 7
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data).toHaveProperty('total_abandoned');
      expect(data).toHaveProperty('total_pending');
      expect(data).toHaveProperty('total_value');
      expect(data).toHaveProperty('avg_cart_value');
      expect(data).toHaveProperty('period_days');

      expect(data.period_days).toBe(7);
      expect(typeof data.total_abandoned).toBe('number');
      expect(typeof data.total_pending).toBe('number');
      expect(typeof data.total_value).toBe('number');
      expect(typeof data.avg_cart_value).toBe('number');
    });

    it('should calculate correct totals', async () => {
      const { data, error } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
        days_ago: 7
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();

      // We created 2 abandoned and 2 pending in beforeEach
      expect(data.total_abandoned).toBeGreaterThanOrEqual(2);
      expect(data.total_pending).toBeGreaterThanOrEqual(2);

      // Total value should be sum of all (10000 + 20000 + 15000 + 25000 = 70000 minimum)
      expect(data.total_value).toBeGreaterThanOrEqual(70000);
    });

    it('should calculate average cart value as a positive number', async () => {
      const { data, error } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
        days_ago: 7
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.total_abandoned + data.total_pending).toBeGreaterThan(0);
      // Average should be positive and within a reasonable range
      expect(data.avg_cart_value).toBeGreaterThan(0);
      // Average cannot exceed total value
      expect(data.avg_cart_value).toBeLessThanOrEqual(data.total_value);
    });
  });

  describe('Integration: Pending → Completed Flow', () => {
    it('should handle full payment flow: pending → completed', async () => {
      const paymentIntentId = `pi_test_flow_${Date.now()}`;
      const customerEmail = `test-flow-${Date.now()}@example.com`;

      // Step 1: Create pending payment (simulates create-payment-intent)
      const { error: createError } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: customerEmail,
          amount: 10000,
          currency: 'PLN',
          status: 'pending',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          metadata: {
            test: 'flow'
          }
        });

      expect(createError).toBeNull();

      // Step 2: Verify pending status
      const { data: pendingPayment } = await supabaseAdmin
        .from('payment_transactions')
        .select('status')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .single();

      expect(pendingPayment?.status).toBe('pending');

      // Step 3: Update to completed (simulates webhook)
      const { error: updateError } = await supabaseAdmin
        .from('payment_transactions')
        .update({
          status: 'completed',
          metadata: { test: 'flow', converted_from_pending: true }
        })
        .eq('stripe_payment_intent_id', paymentIntentId);

      expect(updateError).toBeNull();

      // Step 4: Verify completed status
      const { data: completedPayment } = await supabaseAdmin
        .from('payment_transactions')
        .select('status, metadata')
        .eq('stripe_payment_intent_id', paymentIntentId)
        .single();

      expect(completedPayment?.status).toBe('completed');
      expect(completedPayment?.metadata).toHaveProperty('converted_from_pending', true);
    });

    it('should prevent duplicate transactions', async () => {
      const paymentIntentId = `pi_test_duplicate_${Date.now()}`;

      // Create first transaction
      const { error: firstError } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: paymentIntentId,
          stripe_payment_intent_id: paymentIntentId,
          product_id: testProductId,
          customer_email: 'test-duplicate@example.com',
          amount: 10000,
          currency: 'PLN',
          status: 'pending'
        });

      expect(firstError).toBeNull();

      // Try to create duplicate (should fail due to unique constraint)
      const { error: duplicateError } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: `${paymentIntentId}_different`, // Different session_id
          stripe_payment_intent_id: paymentIntentId,  // Same payment intent
          product_id: testProductId,
          customer_email: 'test-duplicate@example.com',
          amount: 10000,
          currency: 'PLN',
          status: 'pending'
        });

      expect(duplicateError).not.toBeNull();
      expect(duplicateError?.code).toBe('23505'); // Unique violation
    });
  });
});
