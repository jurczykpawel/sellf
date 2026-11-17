/**
 * SECURITY TEST: Coupon Race Condition (TOCTOU)
 *
 * Verifies that the verify_coupon() function's FOR UPDATE lock prevents concurrent
 * payment-start reservations from bypassing usage_limit_global, and that storefront checks
 * (/api/coupons/verify) hold no slot.
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

  test('storefront checks hold no slot: concurrent checks all answer valid and reserve nothing @J124', async ({ request }) => {
    const responses = await Promise.all(Array(5).fill(null).map((_, i) =>
      request.post('/api/coupons/verify', { data: { code: couponCode, productId, email: `previewuser${i}@example.com` } })));
    const results = await Promise.all(responses.map(r => r.json()));
    expect(results.filter(r => r.valid === true)).toHaveLength(5);
    const { count } = await supabaseAdmin.from('coupon_reservations').select('*', { count: 'exact', head: true }).eq('coupon_id', couponId);
    expect(count).toBe(0);
  });

  test('concurrent payment-start reservations respect usage_limit_global=1 @J124', async () => {
    // The server reserves a slot when it creates the payment session (verify_coupon with the
    // default reserve flag). With the coupon row lock exactly one of N concurrent buyers gets it.
    const results = await Promise.all(Array(10).fill(null).map((_, i) =>
      supabaseAdmin.rpc('verify_coupon', { code_param: couponCode, product_id_param: productId, customer_email_param: `raceuser${i}@example.com`, currency_param: 'USD' })));
    const validCount = results.filter(r => r.data?.valid === true).length;
    expect(validCount, `Expected exactly 1 reservation to succeed but got ${validCount}.`).toBe(1);
  });

  test('database has exactly 1 reservation after concurrent race @J124', async () => {
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
