/**
 * SECURITY TEST: Coupon Race Condition (TOCTOU)
 *
 * Tests for Time-Of-Check to Time-Of-Use vulnerability in coupon verification.
 * Uses reservation system to prevent race conditions.
 */

import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Helper to create fresh Supabase admin client
function createFreshAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
  return createClient(supabaseUrl, serviceRoleKey);
}

test.describe('Coupon Race Condition Security', () => {
  let couponId: string;
  let couponCode: string;
  let productId: string;
  let supabaseAdmin: SupabaseClient;

  test.beforeAll(async () => {
    supabaseAdmin = createFreshAdminClient();

    // Get an existing active product from database
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('id, name')
      .eq('is_active', true)
      .limit(1);

    if (!products || products.length === 0) {
      throw new Error('No active products found. Run seed.sql first.');
    }

    productId = products[0].id;
    console.log(`Using product: ${products[0].name} (${productId})`);

    // Create a coupon with usage_limit_global = 1
    // Note: Add random suffix to avoid duplicate key errors with parallel workers
    couponCode = 'RACE_GLOBAL_' + Date.now() + '_' + Math.random().toString(36).substring(7).toUpperCase();
    const { data: coupon, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: couponCode,
        discount_type: 'percentage',
        discount_value: 50,
        usage_limit_global: 1, // CRITICAL: Only 1 use allowed
        usage_limit_per_user: 1,
        current_usage_count: 0,
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    couponId = coupon.id;
    console.log(`Created coupon: ${couponCode} (limit=1, id=${couponId})`);
  });

  test.afterAll(async () => {
    // Cleanup test data
    if (couponId) {
      await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', couponId);
      await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', couponId);
      await supabaseAdmin.from('coupons').delete().eq('id', couponId);
    }
  });

  test('SECURITY: Prevent race condition in coupon usage limit', async ({ request }) => {
    // This test demonstrates the TOCTOU vulnerability:
    // Two concurrent requests can both verify the coupon successfully
    // and both proceed to use it, exceeding the usage_limit_global

    const verifyAndUseCoupon = async (email: string) => {
      // Step 1: Verify coupon
      const verifyResponse = await request.post('/api/coupons/verify', {
        data: {
          code: couponCode,
          productId: productId,
          email: email,
        }
      });

      const verification = await verifyResponse.json();

      if (!verification.valid) {
        return { success: false, reason: verification.error || 'verification_failed' };
      }

      // RACE WINDOW: Between verification and redemption
      // Another request can verify the same coupon here!

      // Step 2: Create checkout with coupon
      const checkoutResponse = await request.post('/api/create-payment-intent', {
        data: {
          productId: productId,
          email: email,
          couponCode: couponCode,
        }
      });

      return checkoutResponse.ok
        ? { success: true }
        : { success: false, reason: await checkoutResponse.text() };
    };

    // Launch 10 concurrent requests with different emails
    // EXPECTED BEHAVIOR: Only 1 should succeed (usage_limit_global = 1)
    // With reservation system: Only 1 verify should succeed

    const results = await Promise.all([
      verifyAndUseCoupon('user1@example.com'),
      verifyAndUseCoupon('user2@example.com'),
      verifyAndUseCoupon('user3@example.com'),
      verifyAndUseCoupon('user4@example.com'),
      verifyAndUseCoupon('user5@example.com'),
      verifyAndUseCoupon('user6@example.com'),
      verifyAndUseCoupon('user7@example.com'),
      verifyAndUseCoupon('user8@example.com'),
      verifyAndUseCoupon('user9@example.com'),
      verifyAndUseCoupon('user10@example.com'),
    ]);

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`\n🔍 RACE CONDITION TEST (GLOBAL LIMIT):`);
    console.log(`   - Coupon usage limit: 1`);
    console.log(`   - Concurrent requests: 10`);
    console.log(`   - Successful checkouts: ${successCount}`);
    console.log(`   - Failed checkouts: ${failureCount}`);

    // CRITICAL: Should be at most 1 success
    // If > 1, race condition vulnerability exists
    expect(successCount).toBeLessThanOrEqual(1);

    // Verify remaining requests were properly rejected
    expect(failureCount).toBeGreaterThanOrEqual(9);
  });

  test('SECURITY: Per-user limit allows multiple verifications for same reservation', async ({ request }) => {
    // Create coupon with per-user limit = 1
    // The per-user limit is enforced at PAYMENT time, not verification time
    // Multiple verifications from same user should return same reservation
    const perUserCode = 'PERUSER_' + Date.now();
    const { data: perUserCoupon, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: perUserCode,
        discount_type: 'percentage',
        discount_value: 25,
        usage_limit_global: 100,
        usage_limit_per_user: 1,
        current_usage_count: 0,
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    const email = 'sameuser@example.com';

    // Same user verifies coupon 5 times concurrently
    // All should succeed because they get the SAME reservation
    const results = await Promise.all([
      request.post('/api/coupons/verify', {
        data: { code: perUserCode, productId, email }
      }),
      request.post('/api/coupons/verify', {
        data: { code: perUserCode, productId, email }
      }),
      request.post('/api/coupons/verify', {
        data: { code: perUserCode, productId, email }
      }),
      request.post('/api/coupons/verify', {
        data: { code: perUserCode, productId, email }
      }),
      request.post('/api/coupons/verify', {
        data: { code: perUserCode, productId, email }
      }),
    ]);

    const responses = await Promise.all(results.map(r => r.json()));
    const validCount = responses.filter(r => r.valid).length;
    const alreadyReservedCount = responses.filter(r => r.valid && r.already_reserved).length;

    console.log(`\n🔍 PER-USER VERIFICATION TEST:`);
    console.log(`   - Same user concurrent requests: 5`);
    console.log(`   - Valid verifications: ${validCount}`);
    console.log(`   - Already reserved (reuse): ${alreadyReservedCount}`);

    // All should be valid - same user can verify multiple times
    // At least some should be "already_reserved" (reusing same reservation)
    expect(validCount).toBe(5);
    expect(alreadyReservedCount).toBeGreaterThanOrEqual(4); // At least 4 reused existing

    console.log(`✅ CORRECT: Same user can verify multiple times (same reservation)`);

    // Cleanup
    await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', perUserCoupon.id);
    await supabaseAdmin.from('coupons').delete().eq('id', perUserCoupon.id);
  });

  test('SECURITY: Per-user limit blocks payment after first redemption', async ({ request }) => {
    // Create coupon with per-user limit = 1
    // Note: Code must be uppercase because verify_coupon uppercases the input
    const randomSuffix = Math.random().toString(36).substring(7).toUpperCase();
    const limitCode = 'LIMIT_' + Date.now() + '_' + randomSuffix;
    const { data: limitCoupon, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: limitCode,
        discount_type: 'percentage',
        discount_value: 25,
        usage_limit_global: 100,
        usage_limit_per_user: 1, // Only 1 use per user
        current_usage_count: 0,
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    const email = 'peruser-test@example.com';

    // Simulate first redemption by adding to coupon_redemptions
    const { error: insertError } = await supabaseAdmin.from('coupon_redemptions').insert({
      coupon_id: limitCoupon.id,
      customer_email: email,
      discount_amount: 25, // Required field - the discount amount that was applied
    });

    if (insertError) {
      console.log('Failed to insert redemption:', insertError);
      throw insertError;
    }

    // Verify redemption was inserted
    const { data: redemptions, count } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('*', { count: 'exact' })
      .eq('coupon_id', limitCoupon.id)
      .eq('customer_email', email);

    console.log(`\n🔍 PER-USER LIMIT ENFORCEMENT TEST:`);
    console.log(`   - Coupon code: ${limitCode}`);
    console.log(`   - Coupon ID: ${limitCoupon.id}`);
    console.log(`   - Redemptions in DB: ${count}`);
    console.log(`   - Per-user limit: ${limitCoupon.usage_limit_per_user}`);
    console.log(`   - Product ID: ${productId}`);

    // Now same user tries to verify again - should fail
    const verifyResponse = await request.post('/api/coupons/verify', {
      data: { code: limitCode, productId, email }
    });
    const result = await verifyResponse.json();

    console.log(`   - Verify result: ${JSON.stringify(result)}`);

    // Should be blocked - user already used their 1 allowed redemption
    expect(result.valid).toBe(false);
    expect(result.error).toContain('already used');

    console.log(`✅ CORRECT: Per-user limit blocks after first redemption`);

    // Cleanup
    await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', limitCoupon.id);
    await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', limitCoupon.id);
    await supabaseAdmin.from('coupons').delete().eq('id', limitCoupon.id);
  });

  test('SECURITY: Reservation expires after timeout', async ({ request }) => {
    // Create a fresh coupon for this test
    const expireCode = 'EXPIRE_' + Date.now();
    const { data: expireCoupon, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: expireCode,
        discount_type: 'percentage',
        discount_value: 10,
        usage_limit_global: 1,
        current_usage_count: 0,
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // First verification creates reservation
    const verify1 = await request.post('/api/coupons/verify', {
      data: { code: expireCode, productId, email: 'first@example.com' }
    });
    const result1 = await verify1.json();

    console.log(`\n🔍 RESERVATION EXPIRY TEST:`);
    console.log(`   - First verify: ${result1.valid ? 'Reserved' : 'Failed'}`);

    expect(result1.valid).toBe(true);

    // Second user tries immediately - should be blocked by reservation
    const verify2 = await request.post('/api/coupons/verify', {
      data: { code: expireCode, productId, email: 'second@example.com' }
    });
    const result2 = await verify2.json();

    console.log(`   - Second verify (immediate): ${result2.valid ? 'Reserved' : 'Blocked'}`);
    expect(result2.valid).toBe(false);

    // Manually expire the reservation (simulate timeout)
    await supabaseAdmin
      .from('coupon_reservations')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('coupon_id', expireCoupon.id);

    // Clean up expired reservations
    await supabaseAdmin.rpc('cleanup_expired_reservations');

    // Now second user should be able to verify
    const verify3 = await request.post('/api/coupons/verify', {
      data: { code: expireCode, productId, email: 'second@example.com' }
    });
    const result3 = await verify3.json();

    console.log(`   - Second verify (after expiry): ${result3.valid ? 'Reserved' : 'Blocked'}`);
    expect(result3.valid).toBe(true);

    console.log(`   ✅ Reservation expiry works correctly`);

    // Cleanup
    await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', expireCoupon.id);
    await supabaseAdmin.from('coupons').delete().eq('id', expireCoupon.id);
  });
});

test.describe('Coupon Race Condition - Edge Cases', () => {
  let productId: string;
  let supabaseAdmin: SupabaseClient;

  test.beforeAll(async () => {
    supabaseAdmin = createFreshAdminClient();

    const { data: products } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('is_active', true)
      .limit(1);
    productId = products?.[0]?.id;
  });

  test('SECURITY: Race condition with zero-remaining limit', async ({ request }) => {
    // Create coupon that's already exhausted
    const exhaustedCode = 'EXHAUSTED_' + Date.now();
    const { data: exhaustedCoupon, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: exhaustedCode,
        discount_type: 'percentage',
        discount_value: 50,
        usage_limit_global: 1,
        current_usage_count: 1, // Already used!
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Try to verify - should fail
    const results = await Promise.all([
      request.post('/api/coupons/verify', {
        data: { code: exhaustedCode, productId, email: 'user1@example.com' }
      }),
      request.post('/api/coupons/verify', {
        data: { code: exhaustedCode, productId, email: 'user2@example.com' }
      }),
    ]);

    const validCount = (await Promise.all(
      results.map(r => r.json())
    )).filter(r => r.valid).length;

    console.log(`\n🔍 EXHAUSTED COUPON TEST:`);
    console.log(`   - Already used: 1/1`);
    console.log(`   - Valid verifications: ${validCount}`);

    // All should fail - coupon is exhausted
    expect(validCount).toBe(0);
    console.log(`   ✅ Exhausted coupon correctly rejected`);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('id', exhaustedCoupon.id);
  });
});
