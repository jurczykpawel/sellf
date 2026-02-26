/**
 * Abandoned Cart Recovery - E2E Tests
 *
 * Tests the full abandoned cart flow from user perspective:
 * - User starts checkout (pending payment created)
 * - User leaves without paying (abandoned)
 * - User completes payment (pending → completed)
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Abandoned Cart Recovery - E2E', () => {
  // Enforce single worker to avoid race conditions
  test.describe.configure({ mode: 'serial' });
  let testProduct: any;

  test.beforeAll(async () => {
    // Create test product
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: `E2E Abandoned Cart Test ${Date.now()}`,
        slug: `e2e-abandoned-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        description: 'Test product for abandoned cart E2E',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true
      })
      .select()
      .single();

    if (error) throw error;
    testProduct = data;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', testProduct.id);
    }
  });

  test('should create pending payment when user reaches checkout', async ({ page }) => {
    const testEmail = `e2e-pending-${Date.now()}@example.com`;
    const paymentIntentId = `pi_test_e2e_pending_${Date.now()}`;

    // Verify checkout page loads with product info
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toContainText(testProduct.name, { timeout: 15000 });

    // Simulate pending payment creation (what the checkout API would do)
    const { error } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: paymentIntentId,
        stripe_payment_intent_id: paymentIntentId,
        product_id: testProduct.id,
        customer_email: testEmail,
        amount: 10000,
        currency: 'PLN',
        status: 'pending',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

    expect(error).toBeNull();

    // Verify the pending payment record has correct product association and expiry
    const { data: pendingPayment } = await supabaseAdmin
      .from('payment_transactions')
      .select('status, product_id, amount, currency, expires_at, created_at')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single();

    expect(pendingPayment).not.toBeNull();
    expect(pendingPayment!.status).toBe('pending');
    expect(pendingPayment!.product_id).toBe(testProduct.id);
    expect(pendingPayment!.amount).toBe(10000);
    expect(pendingPayment!.currency).toBe('PLN');
    // Verify expires_at was persisted and is in the future (not a tautological echo-back:
    // this confirms DB default/trigger behavior didn't override the value)
    expect(new Date(pendingPayment!.expires_at).getTime()).toBeGreaterThan(Date.now());
    // Verify created_at was auto-populated by the database
    expect(pendingPayment!.created_at).toBeTruthy();
  });

  test('should track abandoned cart when user leaves without paying', async ({ page }) => {
    const testEmail = `e2e-abandoned-${Date.now()}@example.com`;
    const paymentIntentId = `pi_test_e2e_abandoned_${Date.now()}`;

    // Create a pending payment with a past expiration (simulating expired checkout)
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: paymentIntentId,
        stripe_payment_intent_id: paymentIntentId,
        product_id: testProduct.id,
        customer_email: testEmail,
        amount: 10000,
        currency: 'PLN',
        status: 'pending',
        expires_at: expiredAt
      });

    // Simulate user leaving - navigate away
    await page.goto('/');

    // Use the real RPC function that the cron job uses to mark expired payments
    const { data: markedCount, error: markError } = await supabaseAdmin.rpc('mark_expired_pending_payments');
    expect(markError).toBeNull();
    expect(markedCount).toBeGreaterThanOrEqual(1);

    // Verify the abandoned cart appears in the get_abandoned_carts RPC query
    const { data: abandonedCarts, error: queryError } = await supabaseAdmin.rpc('get_abandoned_carts', {
      days_ago: 1,
      limit_count: 100
    });

    expect(queryError).toBeNull();
    const ourCart = abandonedCarts?.find((cart: any) => cart.customer_email === testEmail);
    expect(ourCart).toBeDefined();
    expect(ourCart.product_id).toBe(testProduct.id);
    expect(ourCart.amount).toBe(10000);
  });

  test('should convert pending to completed when payment succeeds', async ({ page }) => {
    const testEmail = `e2e-completed-${Date.now()}@example.com`;
    const paymentIntentId = `pi_test_e2e_completed_${Date.now()}`;

    // Create pending payment
    await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: paymentIntentId,
        stripe_payment_intent_id: paymentIntentId,
        product_id: testProduct.id,
        customer_email: testEmail,
        amount: 10000,
        currency: 'PLN',
        status: 'pending',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

    // Simulate payment success via the real RPC function (same as Stripe webhook handler)
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: paymentIntentId,
        product_id_param: testProduct.id,
        customer_email_param: testEmail,
        amount_total: 10000,
        currency_param: 'PLN',
        stripe_payment_intent_id: paymentIntentId,
        user_id_param: null,
        bump_product_id_param: null,
        coupon_id_param: null
      }
    );

    expect(error).toBeNull();
    expect(result?.success).toBe(true);

    // Verify the payment was converted (not just status, but the conversion metadata)
    const { data: completedPayment } = await supabaseAdmin
      .from('payment_transactions')
      .select('status, metadata, amount, currency, product_id')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single();

    expect(completedPayment?.status).toBe('completed');
    expect(completedPayment?.metadata).toHaveProperty('converted_from_pending', true);
    // Verify the original data was preserved during conversion
    expect(completedPayment?.amount).toBe(10000);
    expect(completedPayment?.currency).toBe('PLN');
    expect(completedPayment?.product_id).toBe(testProduct.id);

    // Verify guest_purchases was created for the email (business side-effect of payment completion)
    const { data: guestPurchase } = await supabaseAdmin
      .from('guest_purchases')
      .select('product_id, customer_email')
      .eq('customer_email', testEmail)
      .eq('product_id', testProduct.id)
      .maybeSingle();

    // Guest purchase should exist since no user_id was provided
    expect(guestPurchase).not.toBeNull();
    expect(guestPurchase?.customer_email).toBe(testEmail);
  });

  test('should show abandoned cart in admin panel query', async ({ page }) => {
    const testEmail = `e2e-admin-query-${Date.now()}@example.com`;
    const paymentIntentId = `pi_test_admin_${Date.now()}`;

    // Create abandoned cart
    await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: paymentIntentId,
        stripe_payment_intent_id: paymentIntentId,
        product_id: testProduct.id,
        customer_email: testEmail,
        amount: 15000,
        currency: 'PLN',
        status: 'abandoned',
        abandoned_at: new Date().toISOString(),
        metadata: {
          first_name: 'Admin',
          last_name: 'Query Test'
        }
      });

    // Query abandoned carts via RPC
    const { data: abandonedCarts, error } = await supabaseAdmin.rpc('get_abandoned_carts', {
      days_ago: 7,
      limit_count: 100
    });

    expect(error).toBeNull();
    expect(Array.isArray(abandonedCarts)).toBe(true);

    // Find our test cart
    const testCart = abandonedCarts?.find((cart: any) => cart.customer_email === testEmail);
    expect(testCart).toBeDefined();
    expect(testCart.amount).toBe(15000);
    expect(testCart.product_id).toBe(testProduct.id);
  });

  test('should calculate statistics for abandoned carts', async ({ page }) => {
    // Capture baseline stats before inserting test data
    const { data: baselineStats } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 7
    });
    const baselineAbandoned = baselineStats?.total_abandoned ?? 0;
    const baselinePending = baselineStats?.total_pending ?? 0;
    const baselineValue = baselineStats?.total_value ?? 0;

    // Create multiple abandoned and pending carts
    const timestamp = Date.now();
    const testData = [
      { email: `stats-1-${timestamp}@example.com`, status: 'abandoned', amount: 10000 },
      { email: `stats-2-${timestamp}@example.com`, status: 'abandoned', amount: 20000 },
      { email: `stats-3-${timestamp}@example.com`, status: 'pending', amount: 15000 }
    ];

    for (let i = 0; i < testData.length; i++) {
      const item = testData[i];
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          session_id: `pi_stats_${i}_${timestamp}`,
          stripe_payment_intent_id: `pi_stats_${i}_${timestamp}`,
          product_id: testProduct.id,
          customer_email: item.email,
          amount: item.amount,
          currency: 'PLN',
          status: item.status,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });
    }

    // Get statistics after inserting test data
    const { data: stats, error } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 7
    });

    expect(error).toBeNull();
    expect(stats).toBeDefined();
    // Verify exact delta from baseline (not just "greater than" which could pass vacuously)
    expect(stats.total_abandoned).toBe(baselineAbandoned + 2);
    expect(stats.total_pending).toBe(baselinePending + 1);
    expect(stats.total_value).toBe(baselineValue + 45000); // 10k + 20k + 15k
    expect(stats.avg_cart_value).toBeGreaterThan(0);
  });

  test('should handle expired pending payments', async ({ page }) => {
    const testEmail = `e2e-expired-${Date.now()}@example.com`;
    const paymentIntentId = `pi_test_expired_${Date.now()}`;

    // Create pending payment that expired 1 hour ago
    await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: paymentIntentId,
        stripe_payment_intent_id: paymentIntentId,
        product_id: testProduct.id,
        customer_email: testEmail,
        amount: 10000,
        currency: 'PLN',
        status: 'pending',
        expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
      });

    // Mark expired payments as abandoned (cron job would do this)
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
    expect(payment?.abandoned_at).toBeTruthy();
  });

  test('should prevent duplicate transactions with same payment intent', async ({ page }) => {
    const testEmail = `e2e-duplicate-${Date.now()}@example.com`;
    const paymentIntentId = `pi_test_duplicate_${Date.now()}`;

    // Create first transaction
    const { error: firstError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: paymentIntentId,
        stripe_payment_intent_id: paymentIntentId,
        product_id: testProduct.id,
        customer_email: testEmail,
        amount: 10000,
        currency: 'PLN',
        status: 'pending'
      });

    expect(firstError).toBeNull();

    // Try to create duplicate (should fail)
    const { error: duplicateError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `${paymentIntentId}_different`,
        stripe_payment_intent_id: paymentIntentId, // Same payment intent
        product_id: testProduct.id,
        customer_email: testEmail,
        amount: 10000,
        currency: 'PLN',
        status: 'pending'
      });

    expect(duplicateError).not.toBeNull();
    expect(duplicateError?.code).toBe('23505'); // Unique constraint violation
  });

  test('should update existing pending instead of creating duplicate on payment', async ({ page }) => {
    const testEmail = `e2e-update-${Date.now()}@example.com`;
    const paymentIntentId = `pi_test_update_${Date.now()}`;

    // Step 1: Create pending payment
    await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: paymentIntentId,
        stripe_payment_intent_id: paymentIntentId,
        product_id: testProduct.id,
        customer_email: testEmail,
        amount: 10000,
        currency: 'PLN',
        status: 'pending',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

    // Step 2: Count pending transactions
    const { count: beforeCount } = await supabaseAdmin
      .from('payment_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('stripe_payment_intent_id', paymentIntentId);

    expect(beforeCount).toBe(1);

    // Step 3: Process payment (webhook simulation)
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: paymentIntentId,
        product_id_param: testProduct.id,
        customer_email_param: testEmail,
        amount_total: 10000,
        currency_param: 'PLN',
        stripe_payment_intent_id: paymentIntentId,
        user_id_param: null
      }
    );

    expect(error).toBeNull();
    expect(result?.success).toBe(true);

    // Step 4: Verify still only 1 transaction (updated, not duplicated)
    const { count: afterCount } = await supabaseAdmin
      .from('payment_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('stripe_payment_intent_id', paymentIntentId);

    expect(afterCount).toBe(1);

    // Step 5: Verify status is completed
    const { data: payment } = await supabaseAdmin
      .from('payment_transactions')
      .select('status, metadata')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single();

    expect(payment?.status).toBe('completed');
    expect(payment?.metadata).toHaveProperty('converted_from_pending', true);
  });
});
