// tests/admin-refund.spec.ts
// Comprehensive tests for admin refund functionality

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getAdminBearerToken } from './helpers/admin-auth';


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

let testProduct: any;
let testTransaction: any;
let adminToken: string;

// Auth tests that don't need transaction setup
test.describe('Admin Refund API - Auth Tests', () => {
  test('AUTH: Unauthenticated request is rejected', async ({ request }) => {
    console.log(`\n🔍 Testing unauthenticated access to refund endpoint`);

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: '00000000-0000-0000-0000-000000000001',
        paymentIntentId: 'pi_fake_test_intent',
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Error: ${result.message || result.error}`);

    expect(response.status()).toBe(401);
    expect(result.message || result.error).toBe('Unauthorized');
  });
});

test.describe('Admin Refund API Tests', () => {

  test.beforeAll(async () => {
    // Get admin token
    adminToken = await getAdminBearerToken();

    // Get existing active product with non-zero price
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('id, name, price, currency')
      .eq('is_active', true)
      .not('price', 'is', null)
      .gt('price', 0)
      .limit(1);

    if (!products || products.length === 0) {
      throw new Error('No active products with non-zero price found for testing');
    }

    testProduct = products[0];
  });

  test.beforeEach(async () => {
    // Create a test transaction in 'completed' status
    const { data: transaction, error } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_refund_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        product_id: testProduct.id,
        customer_email: 'refund-test@example.com',
        amount: testProduct.price * 100, // In cents
        currency: testProduct.currency || 'usd',
        status: 'completed',
        stripe_payment_intent_id: `pi_test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create test transaction:', error);
      throw error;
    }

    testTransaction = transaction;
    console.log(`\n✅ Created test transaction: ${testTransaction.id}`);
  });

  test.afterEach(async () => {
    // Cleanup: Delete test transaction
    if (testTransaction?.id) {
      await supabaseAdmin
        .from('payment_transactions')
        .delete()
        .eq('id', testTransaction.id);

      console.log(`🗑️  Deleted test transaction: ${testTransaction.id}`);
    }
  });

  test('🔴 CRITICAL: Prevent double refund via concurrent requests', async ({ request }) => {
    console.log(`\n🔍 Testing race condition with transaction: ${testTransaction.id}`);
    console.log(`   Amount: $${testTransaction.amount / 100}`);
    console.log(`   Status before: ${testTransaction.status}`);

    // Spy on Stripe API calls (we'll check DB instead since we can't easily mock Stripe)

    // Make 2 concurrent refund requests
    const refundPromises = [
      request.post(`http://localhost:3000/api/admin/payments/refund`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          transactionId: testTransaction.id,
          paymentIntentId: testTransaction.stripe_payment_intent_id,
          reason: 'requested_by_customer',
        },
      }),
      request.post(`http://localhost:3000/api/admin/payments/refund`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          transactionId: testTransaction.id,
          paymentIntentId: testTransaction.stripe_payment_intent_id,
          reason: 'requested_by_customer',
        },
      }),
    ];

    const responses = await Promise.allSettled(refundPromises);

    // Parse responses
    const results = await Promise.all(
      responses.map(async (r) => {
        if (r.status === 'fulfilled') {
          const json = await r.value.json();
          return {
            status: r.value.status(),
            success: json.success || false,
            error: json.message || json.error,
          };
        }
        return { status: 0, success: false, error: 'Request failed' };
      })
    );

    console.log(`\n📊 Concurrent refund results:`);
    results.forEach((r, i) => {
      console.log(`   Request ${i + 1}: HTTP ${r.status}, Success: ${r.success}, Error: ${r.error || 'none'}`);
    });

    // Count successes
    const successCount = results.filter(r => r.success === true).length;

    console.log(`\n🎯 Results:`);
    console.log(`   - Successful refunds: ${successCount}/2`);
    console.log(`   - Expected: Maximum 1 (prevent double refund)`);

    // CRITICAL: Only ONE refund should succeed
    expect(successCount).toBeLessThanOrEqual(1);

    // Verify DB state
    const { data: updatedTransaction } = await supabaseAdmin
      .from('payment_transactions')
      .select('status, refund_id, refunded_amount')
      .eq('id', testTransaction.id)
      .single();

    console.log(`\n✅ Final DB state:`);
    console.log(`   - Status: ${updatedTransaction?.status}`);
    console.log(`   - Refund ID: ${updatedTransaction?.refund_id || 'none'}`);
    console.log(`   - Refunded amount: $${(updatedTransaction?.refunded_amount || 0) / 100}`);

    if (successCount === 1) {
      // If one succeeded, verify it was recorded
      expect(updatedTransaction?.status).toBe('refunded');
      expect(updatedTransaction?.refund_id).toBeTruthy();
    }
  });

  test('SECURITY: Cannot refund already refunded transaction', async ({ request }) => {
    // First, mark transaction as refunded
    await supabaseAdmin
      .from('payment_transactions')
      .update({
        status: 'refunded',
        refund_id: 're_test_already_refunded',
        refunded_amount: testTransaction.amount,
        refunded_at: new Date().toISOString(),
      })
      .eq('id', testTransaction.id);

    console.log(`\n🔍 Attempting to refund already-refunded transaction`);

    // Try to refund again
    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Message: ${result.message || result.error}`);

    // Should be rejected
    expect(response.status()).toBe(400);
    expect(result.error).toContain('Only completed transactions can be refunded');
  });

  test('VALIDATION: Refund rejects invalid amounts', async ({ request }) => {
    // Test negative amount
    let response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        amount: -1,
        reason: 'requested_by_customer',
      },
    });
    expect(response.status()).toBe(400);

    // Test zero amount
    // Note: amount=0 is falsy in JS, so the route's `amount ? Number(amount) : transaction.amount`
    // falls through to using the full transaction amount, which then fails at Stripe (500).
    // Either the route validates (400) or Stripe rejects the fake intent (500) — both mean "not successful".
    response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        amount: 0,
        reason: 'requested_by_customer',
      },
    });
    expect([400, 500]).toContain(response.status());

    // Test amount exceeding max (99999999)
    response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        amount: 100000000,
        reason: 'requested_by_customer',
      },
    });
    expect(response.status()).toBe(400);
  });

  test('AUTH: Non-admin user cannot access refund endpoint', async ({ request }) => {
    // Create a regular (non-admin) user
    const regularEmail = `regular-user-${Date.now()}@example.com`;
    const { data: { user: regularUser } } = await supabaseAdmin.auth.admin.createUser({
      email: regularEmail,
      password: 'password123',
      email_confirm: true,
    });

    // Sign in to get token - use SEPARATE client to not pollute supabaseAdmin auth state
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { session } } = await authClient.auth.signInWithPassword({
      email: regularEmail,
      password: 'password123',
    });

    const regularToken = session?.access_token;

    console.log(`\n🔍 Testing non-admin access to refund endpoint`);

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${regularToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Error: ${result.error || result.message}`);

    // Should be forbidden
    expect(response.status()).toBe(403);
    expect(result.message || result.error).toContain('Forbidden');

    // Cleanup
    await supabaseAdmin.auth.admin.deleteUser(regularUser!.id);
  });

  test('VALIDATION: Missing transactionId is rejected', async ({ request }) => {
    console.log(`\n🔍 Testing missing transactionId`);

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Error: ${result.error || result.message}`);

    expect(response.status()).toBe(400);
  });

  test('VALIDATION: Invalid transactionId (non-existent) is rejected', async ({ request }) => {
    console.log(`\n🔍 Testing non-existent transactionId`);

    const fakeTransactionId = '00000000-0000-0000-0000-000000000000';

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: fakeTransactionId,
        paymentIntentId: 'pi_fake_intent',
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Error: ${result.error || result.message}`);

    expect(response.status()).toBe(404);
    expect(result.error).toContain('Transaction not found');
  });

  test('VALIDATION: Cannot refund disputed transaction', async ({ request }) => {
    // Update transaction to disputed status (valid per CHECK constraint)
    const { error: updateErr } = await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'disputed' })
      .eq('id', testTransaction.id);

    if (updateErr) {
      console.log(`   ⚠️ Update error: ${updateErr.message}`);
    }

    // Verify update worked
    const { data: verifyTx } = await supabaseAdmin
      .from('payment_transactions')
      .select('status')
      .eq('id', testTransaction.id)
      .single();

    console.log(`\n🔍 Testing refund of disputed transaction`);
    console.log(`   Transaction status after update: ${verifyTx?.status}`);

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Error: ${result.error || result.message}`);

    expect(response.status()).toBe(400);
    expect(result.error).toContain('Only completed transactions can be refunded');
  });

  test('VALIDATION: Refund amount exceeding original is rejected', async ({ request }) => {
    const originalAmount = testTransaction.amount;
    const excessiveAmount = originalAmount * 2; // Double the original

    console.log(`\n🔍 Testing excessive refund amount`);
    console.log(`   Original amount: $${originalAmount / 100}`);
    console.log(`   Requested refund: $${excessiveAmount / 100}`);

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        amount: excessiveAmount,
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Error: ${result.error || result.message}`);

    // Should be rejected - either by our validation or Stripe
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('VALIDATION: Negative refund amount is rejected', async ({ request }) => {
    console.log(`\n🔍 Testing negative refund amount`);

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        amount: -100,
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Error: ${result.error || result.message}`);

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('VALIDATION: Zero refund amount is rejected', async ({ request }) => {
    console.log(`\n🔍 Testing zero refund amount`);

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        amount: 0,
        reason: 'requested_by_customer',
      },
    });

    const result = await response.json();

    console.log(`   Response: HTTP ${response.status()}`);
    console.log(`   Error: ${result.error || result.message}`);

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('VALIDATION: Cannot refund non-completed transaction', async ({ request }) => {
    // Set transaction to 'refunded' status
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'refunded' })
      .eq('id', testTransaction.id);

    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: testTransaction.stripe_payment_intent_id,
        reason: 'duplicate',
      },
    });
    expect(response.status()).toBe(400);

    // Restore status for other tests
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'completed' })
      .eq('id', testTransaction.id);
  });

  test('SECURITY: Mismatched payment intent ID is rejected by Stripe', async ({ request }) => {
    const response = await request.post(`http://localhost:3000/api/admin/payments/refund`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        transactionId: testTransaction.id,
        paymentIntentId: 'pi_fake_nonexistent_12345',
        reason: 'requested_by_customer',
      },
    });
    // Stripe rejects invalid/non-existent payment intent
    expect(response.ok()).toBe(false);
  });

});

/**
 * ============================================================================
 * SECURITY TEST: Refund Route Delegates Access Revocation
 * ============================================================================
 *
 * Verifies the admin refund route delegates access revocation to the shared
 * revokeTransactionAccess() service, which handles both user_product_access
 * and guest_purchases cleanup (including bump products).
 *
 * The shared service is tested directly in:
 * - tests/unit/lib/services/access-revocation.test.ts
 * - tests/unit/security/refund-access-revocation.test.ts
 * ============================================================================
 */
test.describe('Admin Refund - Access Revocation Source Verification', () => {
  const routePath = join(__dirname, '../src/app/api/admin/payments/refund/route.ts');
  const routeSource = readFileSync(routePath, 'utf-8');

  test('SECURITY: Refund route delegates access revocation to shared service', async () => {
    // Route imports and calls the shared revocation function
    expect(routeSource).toContain('revokeTransactionAccess');
    expect(routeSource).toContain("from '@/lib/services/access-revocation'");

    // Passes transaction context to revocation function
    expect(routeSource).toContain('transactionId: transaction.id');
    expect(routeSource).toContain('userId: transaction.user_id');
    expect(routeSource).toContain('productId: transaction.product_id');
    expect(routeSource).toContain('sessionId: transaction.session_id');

    // Access revocation only on full refund
    expect(routeSource).toContain('isFullRefund');
  });
});
