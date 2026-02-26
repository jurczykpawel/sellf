/**
 * SECURITY TEST: Coupon Race Condition (TOCTOU)
 *
 * Verifies that the verify_coupon() function's FOR UPDATE lock prevents
 * concurrent requests from bypassing usage_limit_global.
 *
 * The test passes ONLY when the race condition fix is in place:
 * - Exactly 1 out of N concurrent requests must succeed
 * - The database must contain exactly 1 reservation
 *
 * If the FOR UPDATE lock is missing, multiple requests succeed simultaneously
 * and the test FAILS.
 */

import { test, expect } from '@playwright/test';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

test.describe('Coupon Race Condition - Simplified', () => {
  test.describe.configure({ mode: 'serial' });

  let productId: string;
  let couponId: string;
  let couponCode: string;
  let supabaseAdmin: SupabaseClient;

  test.beforeAll(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Create a unique product for this test
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);
    const slug = `race-test-product-${timestamp}-${randomSuffix}`;

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Race Condition Test Product',
        slug: slug,
        price: 100.00,
        currency: 'USD',
        is_active: true,
        enable_waitlist: false,
        vat_rate: 23,
        price_includes_vat: true,
        features: [{ title: 'Test', items: ['Race test'] }]
      })
      .select()
      .single();

    if (productError) throw productError;
    productId = product.id;

    // Create coupon with usage_limit_global = 1
    couponCode = ('RACE' + timestamp + '_' + randomSuffix).toUpperCase();

    const { data: coupon, error: couponError } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: couponCode,
        discount_type: 'percentage',
        discount_value: 50,
        usage_limit_global: 1,
        usage_limit_per_user: 1,
        current_usage_count: 0,
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (couponError) {
      console.error('Failed to create test coupon:', couponError);
      throw couponError;
    }
    couponId = coupon.id;

    // Clean up any stale reservations for this coupon
    await supabaseAdmin
      .from('coupon_reservations')
      .delete()
      .eq('coupon_id', couponId);

    // Small delay to ensure DB is ready
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  test.afterAll(async () => {
    if (couponId) {
      await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', couponId);
      await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', couponId);
      await supabaseAdmin.from('coupons').delete().eq('id', couponId);
    }
    if (productId) {
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }
  });

  test('concurrent verify requests respect usage_limit_global=1', async ({ request }) => {
    // Send 10 concurrent verify requests with different emails
    // With FOR UPDATE lock: exactly 1 succeeds, 9 fail with "usage limit reached"
    // Without lock (vulnerability): multiple succeed simultaneously

    const verifyPromises = Array(10).fill(null).map((_, i) =>
      request.post('http://localhost:3000/api/coupons/verify', {
        data: {
          code: couponCode,
          productId: productId,
          email: `raceuser${i}@example.com`,
        }
      })
    );

    const responses = await Promise.all(verifyPromises);
    const results = await Promise.all(responses.map(r => r.json()));
    const validCount = results.filter(r => r.valid === true).length;

    console.log(`\nRACE CONDITION TEST RESULTS:`);
    console.log(`   - Coupon usage limit: 1`);
    console.log(`   - Concurrent verify requests: 10`);
    console.log(`   - Requests that passed validation: ${validCount}`);

    // ASSERTION: Exactly 1 must succeed.
    // - If 0 succeed: test infrastructure issue (coupon verify broken entirely)
    // - If >1 succeed: race condition vulnerability (FOR UPDATE lock missing)
    // - If exactly 1: fix is working correctly
    expect(
      validCount,
      `Expected exactly 1 valid response but got ${validCount}. ` +
      (validCount === 0
        ? 'No requests succeeded — verify API may be broken or rate-limited.'
        : `${validCount} requests bypassed usage_limit_global=1 — FOR UPDATE lock may be missing.`)
    ).toBe(1);
  });

  test('database has exactly 1 reservation after concurrent race', async () => {
    // verify_coupon() creates reservations (not redemptions) on success.
    // Check coupon_reservations to confirm only 1 reservation was created.
    const { count: reservationCount } = await supabaseAdmin
      .from('coupon_reservations')
      .select('*', { count: 'exact' })
      .eq('coupon_id', couponId);

    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('current_usage_count')
      .eq('id', couponId)
      .single();

    console.log(`\nDATABASE STATE:`);
    console.log(`   - Coupon current_usage_count: ${coupon?.current_usage_count}`);
    console.log(`   - Active reservations in DB: ${reservationCount}`);
    console.log(`   - Expected reservations: 1`);

    // Exactly 1 reservation must exist — proves the FOR UPDATE lock works.
    // If 0: verify never succeeded (test infra issue)
    // If >1: race condition allowed multiple reservations past the global limit
    expect(
      reservationCount,
      `Expected exactly 1 reservation but found ${reservationCount}. ` +
      (reservationCount === 0
        ? 'No reservations created — first test may have failed.'
        : `${reservationCount} reservations bypassed usage_limit_global=1.`)
    ).toBe(1);
  });
});
