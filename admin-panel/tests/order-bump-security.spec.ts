import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Order Bump Security Tests
 *
 * These tests verify that order bump pricing and validation work correctly:
 * - bump_price from order_bumps is used (not products.price)
 * - Only bumps configured for the main product are accepted
 * - Currency mismatches are rejected
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Order Bump Pricing Security', () => {
  let mainProduct: any;
  let bumpProduct: any;
  let orderBump: any;

  test.beforeAll(async () => {
    // Create main product ($50)
    const { data: main, error: mainErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Bump Test Main ${Date.now()}`,
        slug: `bump-test-main-${Date.now()}`,
        price: 50.00,
        currency: 'USD',
        description: 'Main product for bump pricing test',
        is_active: true,
      })
      .select()
      .single();

    if (mainErr) throw mainErr;
    mainProduct = main;

    // Create bump product with REGULAR price $30
    const { data: bump, error: bumpErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Bump Test Addon ${Date.now()}`,
        slug: `bump-test-addon-${Date.now()}`,
        price: 30.00,  // Regular price - should NOT be used
        currency: 'USD',
        description: 'Bump product - regular price $30',
        is_active: true,
      })
      .select()
      .single();

    if (bumpErr) throw bumpErr;
    bumpProduct = bump;

    // Create order bump with DISCOUNTED price $10 (not $30!)
    const { data: ob, error: obErr } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: bumpProduct.id,
        bump_title: 'Special Discount!',
        bump_description: 'Get addon for only $10 (normally $30)',
        bump_price: 10.00,  // Discounted bump price - THIS should be used
        is_active: true,
      })
      .select()
      .single();

    if (obErr) throw obErr;
    orderBump = ob;

    console.log('Created bump test fixtures:', {
      mainProduct: mainProduct.id,
      bumpProduct: bumpProduct.id,
      orderBump: orderBump.id,
      mainPrice: mainProduct.price,
      bumpProductPrice: bumpProduct.price,
      bumpPrice: orderBump.bump_price,
    });
  });

  test.afterAll(async () => {
    if (orderBump) {
      await supabaseAdmin.from('order_bumps').delete().eq('id', orderBump.id);
    }
    if (bumpProduct) {
      await supabaseAdmin.from('products').delete().eq('id', bumpProduct.id);
    }
    if (mainProduct) {
      await supabaseAdmin.from('products').delete().eq('id', mainProduct.id);
    }
  });

  test('SECURITY: Payment with bump should use bump_price ($10), not product.price ($30)', async ({ request }) => {
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'bump-test@example.com',
        bumpProductId: bumpProduct.id,
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify in Stripe
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );

    expect(stripeResponse.ok, `Stripe API returned ${stripeResponse.status}`).toBeTruthy();

    const pi = await stripeResponse.json();

    // Expected: $50 (main) + $10 (bump) = $60 = 6000 cents
    // Bug would cause: $50 (main) + $30 (product.price) = $80 = 8000 cents
    expect(pi.amount).toBe(6000);
    expect(pi.metadata.bump_product_id).toBe(bumpProduct.id);
  });

  test('SECURITY: Reject invalid bump product (not configured for main product)', async ({ request }) => {
    // Create a random product not configured as bump
    const { data: randomProduct, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Not A Bump ${Date.now()}`,
        slug: `not-a-bump-${Date.now()}`,
        price: 5.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    try {
      const response = await request.post('/api/create-payment-intent', {
        data: {
          productId: mainProduct.id,
          email: 'attacker@example.com',
          bumpProductId: randomProduct.id,  // This is NOT a valid bump for mainProduct
        }
      });

      expect(response.status()).toBe(200);
      const data = await response.json();

      // Verify in Stripe - should NOT include any bump
      const stripeResponse = await fetch(
        `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
        { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY!}` } }
      );

      expect(stripeResponse.ok, `Stripe API returned ${stripeResponse.status}`).toBeTruthy();

      const pi = await stripeResponse.json();

      // Expected: $50 only (bump should be ignored since it's not valid)
      expect(pi.amount).toBe(5000);
      expect(pi.metadata.bump_product_id).toBe('');  // No bump applied
    } finally {
      await supabaseAdmin.from('products').delete().eq('id', randomProduct.id);
    }
  });

  test('SECURITY: Reject bump with different currency than main product', async ({ request }) => {
    // Create a EUR bump product (different currency than main product USD)
    const { data: eurProduct, error: eurErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `EUR Bump ${Date.now()}`,
        slug: `eur-bump-${Date.now()}`,
        price: 10.00,
        currency: 'EUR',  // Different from mainProduct.currency (USD)
        is_active: true,
      })
      .select()
      .single();

    if (eurErr) throw eurErr;

    // Create order bump - the bump_currency comes from product.currency via RPC
    const { data: eurBump, error: obErr } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: eurProduct.id,
        bump_title: 'Currency Mismatch',
        bump_price: 10.00,
        is_active: true,
      })
      .select()
      .single();

    if (obErr) throw obErr;

    try {
      const response = await request.post('/api/create-payment-intent', {
        data: {
          productId: mainProduct.id,
          email: 'attacker@example.com',
          bumpProductId: eurProduct.id,
        }
      });

      expect(response.status()).toBe(200);
      const data = await response.json();

      // Verify - bump with different currency should be ignored
      const stripeResponse = await fetch(
        `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
        { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY!}` } }
      );

      expect(stripeResponse.ok, `Stripe API returned ${stripeResponse.status}`).toBeTruthy();

      const pi = await stripeResponse.json();
      expect(pi.amount).toBe(5000);  // Only main product, no bump
      expect(pi.metadata.bump_product_id).toBe('');
    } finally {
      await supabaseAdmin.from('order_bumps').delete().eq('id', eurBump.id);
      await supabaseAdmin.from('products').delete().eq('id', eurProduct.id);
    }
  });

  test('SECURITY: Ignore inactive order bump (is_active: false)', async ({ request }) => {
    // Deactivate the order bump
    await supabaseAdmin
      .from('order_bumps')
      .update({ is_active: false })
      .eq('id', orderBump.id);

    try {
      const response = await request.post('/api/create-payment-intent', {
        data: {
          productId: mainProduct.id,
          email: 'test@example.com',
          bumpProductId: bumpProduct.id,
        }
      });

      expect(response.status()).toBe(200);
      const data = await response.json();

      const stripeResponse = await fetch(
        `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
        { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY!}` } }
      );

      expect(stripeResponse.ok, `Stripe API returned ${stripeResponse.status}`).toBeTruthy();

      const pi = await stripeResponse.json();

      // Inactive bump should be ignored - only main product price
      expect(pi.amount).toBe(5000);
      expect(pi.metadata.bump_product_id).toBe('');
    } finally {
      // Restore for other tests
      await supabaseAdmin
        .from('order_bumps')
        .update({ is_active: true })
        .eq('id', orderBump.id);
    }
  });

  test('SECURITY: Ignore bump when bump product is inactive', async ({ request }) => {
    // Deactivate the bump product itself
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .eq('id', bumpProduct.id);

    try {
      const response = await request.post('/api/create-payment-intent', {
        data: {
          productId: mainProduct.id,
          email: 'test@example.com',
          bumpProductId: bumpProduct.id,
        }
      });

      expect(response.status()).toBe(200);
      const data = await response.json();

      const stripeResponse = await fetch(
        `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
        { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY!}` } }
      );

      expect(stripeResponse.ok, `Stripe API returned ${stripeResponse.status}`).toBeTruthy();

      const pi = await stripeResponse.json();

      // Inactive product should not be applied as bump
      expect(pi.amount).toBe(5000);
      expect(pi.metadata.bump_product_id).toBe('');
    } finally {
      // Restore for other tests
      await supabaseAdmin
        .from('products')
        .update({ is_active: true })
        .eq('id', bumpProduct.id);
    }
  });
});

// ============================================================================
// ORDER BUMP WITH COUPON TESTS
// Verify coupon exclude_order_bumps flag works correctly
// ============================================================================

test.describe('Order Bump with Coupon', () => {
  let mainProduct: any;
  let bumpProduct: any;
  let orderBump: any;
  let couponExcludeBumps: any;
  let couponIncludeBumps: any;

  test.beforeAll(async () => {
    // Create main product ($100)
    const { data: main } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Coupon Bump Main ${Date.now()}`,
        slug: `coupon-bump-main-${Date.now()}`,
        price: 100.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    mainProduct = main;

    // Create bump product ($20 regular, $15 bump price)
    const { data: bump } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Coupon Bump Addon ${Date.now()}`,
        slug: `coupon-bump-addon-${Date.now()}`,
        price: 20.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    bumpProduct = bump;

    // Create order bump
    const { data: ob } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: bumpProduct.id,
        bump_title: 'Add bonus!',
        bump_price: 15.00,
        is_active: true,
      })
      .select()
      .single();
    orderBump = ob;

    // Create coupon that EXCLUDES order bumps (20% off main only)
    const { data: coupon1 } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `EXCLUDE-BUMP-${Date.now()}`,
        name: 'Exclude Bumps Coupon',
        discount_type: 'percentage',
        discount_value: 20,
        exclude_order_bumps: true,  // Only applies to main product
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();
    couponExcludeBumps = coupon1;

    // Create coupon that INCLUDES order bumps (20% off everything)
    const { data: coupon2 } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `INCLUDE-BUMP-${Date.now()}`,
        name: 'Include Bumps Coupon',
        discount_type: 'percentage',
        discount_value: 20,
        exclude_order_bumps: false,  // Applies to total including bump
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();
    couponIncludeBumps = coupon2;

    console.log('Created coupon bump test fixtures:', {
      mainProduct: mainProduct.id,
      bumpProduct: bumpProduct.id,
      couponExcludeBumps: couponExcludeBumps.code,
      couponIncludeBumps: couponIncludeBumps.code,
    });
  });

  test.afterAll(async () => {
    if (couponExcludeBumps) {
      await supabaseAdmin.from('coupons').delete().eq('id', couponExcludeBumps.id);
    }
    if (couponIncludeBumps) {
      await supabaseAdmin.from('coupons').delete().eq('id', couponIncludeBumps.id);
    }
    if (orderBump) {
      await supabaseAdmin.from('order_bumps').delete().eq('id', orderBump.id);
    }
    if (bumpProduct) {
      await supabaseAdmin.from('products').delete().eq('id', bumpProduct.id);
    }
    if (mainProduct) {
      await supabaseAdmin.from('products').delete().eq('id', mainProduct.id);
    }
  });

  test('Coupon with exclude_order_bumps=true applies only to main product', async ({ request }) => {
    // Main: $100, Bump: $15
    // Coupon: 20% off main only
    // Expected: $100 - 20% = $80 + $15 bump = $95 = 9500 cents

    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'coupon-test@example.com',
        bumpProductId: bumpProduct.id,
        couponCode: couponExcludeBumps.code,
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY!}` } }
    );

    expect(stripeResponse.ok, `Stripe API returned ${stripeResponse.status}`).toBeTruthy();

    const pi = await stripeResponse.json();

    // $80 (main after 20% discount) + $15 (bump, no discount) = $95
    expect(pi.amount).toBe(9500);
    expect(pi.metadata.bump_product_id).toBe(bumpProduct.id);
    expect(pi.metadata.coupon_code).toBe(couponExcludeBumps.code);
  });

  test('Coupon with exclude_order_bumps=false applies to total including bump', async ({ request }) => {
    // Main: $100, Bump: $15
    // Coupon: 20% off everything
    // Expected: ($100 + $15) - 20% = $115 - $23 = $92 = 9200 cents

    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'coupon-test@example.com',
        bumpProductId: bumpProduct.id,
        couponCode: couponIncludeBumps.code,
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY!}` } }
    );

    expect(stripeResponse.ok, `Stripe API returned ${stripeResponse.status}`).toBeTruthy();

    const pi = await stripeResponse.json();

    // ($100 + $15) * 0.8 = $92
    expect(pi.amount).toBe(9200);
    expect(pi.metadata.bump_product_id).toBe(bumpProduct.id);
    expect(pi.metadata.coupon_code).toBe(couponIncludeBumps.code);
  });
});
