import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Coupon × Multi-Bump E2E Tests
 *
 * Comprehensive testing of coupon interactions with multiple order bumps:
 * - Percentage coupons with exclude_order_bumps=true/false
 * - Fixed amount coupons with exclude_order_bumps=true/false
 * - Multiple bumps with various coupon types
 * - Edge cases: coupon larger than base, zero-result floor (Stripe minimum)
 * - Product-specific coupons with multi-bump
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper: fetch Stripe PaymentIntent to verify amount
async function getStripePaymentIntent(paymentIntentId: string) {
  const res = await fetch(
    `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`,
    { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }
  );
  expect(res.ok, `Stripe API error: ${res.status}`).toBeTruthy();
  return res.json();
}

test.describe('Coupon × Multi-Bump', () => {
  const ts = Date.now();
  let mainProduct: any;
  let bumpProduct1: any;  // bump_price = $20
  let bumpProduct2: any;  // bump_price = $30
  let bumpProduct3: any;  // bump_price = $50
  let orderBump1: any;
  let orderBump2: any;
  let orderBump3: any;

  // Coupons
  let pctExclude: any;    // 25% off, exclude_order_bumps=true
  let pctInclude: any;    // 25% off, exclude_order_bumps=false
  let fixedExclude: any;  // $40 off, exclude_order_bumps=true
  let fixedInclude: any;  // $40 off, exclude_order_bumps=false
  let bigFixed: any;      // $900 off, exclude_order_bumps=false (tests Stripe minimum floor)
  let productSpecific: any; // 10% off, limited to mainProduct only

  test.beforeAll(async () => {
    // Main product: $100 USD
    const { data: main, error: mainErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `CMB Main ${ts}`,
        slug: `cmb-main-${ts}`,
        price: 100.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    if (mainErr) throw mainErr;
    mainProduct = main;

    // Bump product 1: regular $50, bump price $20
    const { data: bp1 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `CMB Bump1 ${ts}`,
        slug: `cmb-bump1-${ts}`,
        price: 50.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    bumpProduct1 = bp1;

    // Bump product 2: regular $80, bump price $30
    const { data: bp2 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `CMB Bump2 ${ts}`,
        slug: `cmb-bump2-${ts}`,
        price: 80.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    bumpProduct2 = bp2;

    // Bump product 3: regular $120, bump price $50
    const { data: bp3 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `CMB Bump3 ${ts}`,
        slug: `cmb-bump3-${ts}`,
        price: 120.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    bumpProduct3 = bp3;

    // Create order bumps
    const { data: ob1 } = await supabaseAdmin.from('order_bumps').insert({
      main_product_id: mainProduct.id,
      bump_product_id: bumpProduct1.id,
      bump_title: 'Bump 1',
      bump_price: 20.00,
      is_active: true,
      display_order: 1,
    }).select().single();
    orderBump1 = ob1;

    const { data: ob2 } = await supabaseAdmin.from('order_bumps').insert({
      main_product_id: mainProduct.id,
      bump_product_id: bumpProduct2.id,
      bump_title: 'Bump 2',
      bump_price: 30.00,
      is_active: true,
      display_order: 2,
    }).select().single();
    orderBump2 = ob2;

    const { data: ob3 } = await supabaseAdmin.from('order_bumps').insert({
      main_product_id: mainProduct.id,
      bump_product_id: bumpProduct3.id,
      bump_title: 'Bump 3',
      bump_price: 50.00,
      is_active: true,
      display_order: 3,
    }).select().single();
    orderBump3 = ob3;

    // Coupons
    const { data: c1 } = await supabaseAdmin.from('coupons').insert({
      code: `PCT-EXCL-${ts}`,
      name: '25% exclude bumps',
      discount_type: 'percentage',
      discount_value: 25,
      exclude_order_bumps: true,
      is_active: true,
      starts_at: new Date().toISOString(),
      usage_limit_global: null,
      usage_limit_per_user: 100,
    }).select().single();
    pctExclude = c1;

    const { data: c2 } = await supabaseAdmin.from('coupons').insert({
      code: `PCT-INCL-${ts}`,
      name: '25% include bumps',
      discount_type: 'percentage',
      discount_value: 25,
      exclude_order_bumps: false,
      is_active: true,
      starts_at: new Date().toISOString(),
      usage_limit_global: null,
      usage_limit_per_user: 100,
    }).select().single();
    pctInclude = c2;

    const { data: c3 } = await supabaseAdmin.from('coupons').insert({
      code: `FIX-EXCL-${ts}`,
      name: '$40 exclude bumps',
      discount_type: 'fixed',
      discount_value: 40,
      currency: 'USD',
      exclude_order_bumps: true,
      is_active: true,
      starts_at: new Date().toISOString(),
      usage_limit_global: null,
      usage_limit_per_user: 100,
    }).select().single();
    fixedExclude = c3;

    const { data: c4 } = await supabaseAdmin.from('coupons').insert({
      code: `FIX-INCL-${ts}`,
      name: '$40 include bumps',
      discount_type: 'fixed',
      discount_value: 40,
      currency: 'USD',
      exclude_order_bumps: false,
      is_active: true,
      starts_at: new Date().toISOString(),
      usage_limit_global: null,
      usage_limit_per_user: 100,
    }).select().single();
    fixedInclude = c4;

    const { data: c5 } = await supabaseAdmin.from('coupons').insert({
      code: `BIG-FIX-${ts}`,
      name: '$900 off (tests floor)',
      discount_type: 'fixed',
      discount_value: 900,
      currency: 'USD',
      exclude_order_bumps: false,
      is_active: true,
      starts_at: new Date().toISOString(),
      usage_limit_global: null,
      usage_limit_per_user: 100,
    }).select().single();
    bigFixed = c5;

    const { data: c6 } = await supabaseAdmin.from('coupons').insert({
      code: `PROD-SPEC-${ts}`,
      name: '10% product-specific',
      discount_type: 'percentage',
      discount_value: 10,
      exclude_order_bumps: false,
      allowed_product_ids: [mainProduct.id],
      is_active: true,
      starts_at: new Date().toISOString(),
      usage_limit_global: null,
      usage_limit_per_user: 100,
    }).select().single();
    productSpecific = c6;

    console.log('[coupon-multi-bump] Created test data:', {
      main: mainProduct.id,
      bumps: [bumpProduct1.id, bumpProduct2.id, bumpProduct3.id],
      coupons: [pctExclude.code, pctInclude.code, fixedExclude.code, fixedInclude.code, bigFixed.code, productSpecific.code],
    });
  });

  test.afterAll(async () => {
    console.log('[coupon-multi-bump] Cleaning up...');
    const couponIds = [pctExclude, pctInclude, fixedExclude, fixedInclude, bigFixed, productSpecific]
      .filter(Boolean).map(c => c.id);
    if (couponIds.length > 0) {
      await supabaseAdmin.from('coupon_reservations').delete().in('coupon_id', couponIds);
      await supabaseAdmin.from('coupons').delete().in('id', couponIds);
    }
    const obIds = [orderBump1, orderBump2, orderBump3].filter(Boolean).map(o => o.id);
    if (obIds.length > 0) {
      await supabaseAdmin.from('order_bumps').delete().in('id', obIds);
    }
    const prodIds = [bumpProduct1, bumpProduct2, bumpProduct3, mainProduct].filter(Boolean).map(p => p.id);
    if (prodIds.length > 0) {
      await supabaseAdmin.from('products').delete().in('id', prodIds);
    }
  });

  // =====================================================================
  // Percentage Coupon Tests
  // =====================================================================

  test('25% coupon, exclude_bumps=true, 1 bump: discount on main only', async ({ request }) => {
    // Main $100, Bump1 $20 → subtotal $120
    // Discount: 25% of $100 (main only) = $25
    // Total: $120 - $25 = $95 = 9500 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id],
        couponCode: pctExclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(9500);
  });

  test('25% coupon, exclude_bumps=false, 1 bump: discount on entire order', async ({ request }) => {
    // Main $100, Bump1 $20 → subtotal $120
    // Discount: 25% of $120 = $30
    // Total: $120 - $30 = $90 = 9000 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id],
        couponCode: pctInclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(9000);
  });

  test('25% coupon, exclude_bumps=true, 3 bumps: discount on main only, bumps full price', async ({ request }) => {
    // Main $100, Bump1 $20, Bump2 $30, Bump3 $50 → subtotal $200
    // Discount: 25% of $100 (main only) = $25
    // Total: $200 - $25 = $175 = 17500 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id, bumpProduct3.id],
        couponCode: pctExclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(17500);
  });

  test('25% coupon, exclude_bumps=false, 3 bumps: discount on everything', async ({ request }) => {
    // Main $100, Bump1 $20, Bump2 $30, Bump3 $50 → subtotal $200
    // Discount: 25% of $200 = $50
    // Total: $200 - $50 = $150 = 15000 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id, bumpProduct3.id],
        couponCode: pctInclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(15000);
  });

  test('25% coupon, exclude_bumps=false, 2 of 3 bumps selected', async ({ request }) => {
    // Main $100, Bump1 $20, Bump2 $30 → subtotal $150
    // Discount: 25% of $150 = $37.50
    // Total: $150 - $37.50 = $112.50 = 11250 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id],
        couponCode: pctInclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(11250);
  });

  // =====================================================================
  // Fixed Amount Coupon Tests
  // =====================================================================

  test('$40 fixed coupon, exclude_bumps=true, 1 bump: discount on main only', async ({ request }) => {
    // Main $100, Bump1 $20 → subtotal $120
    // Discount: min($40, $100) = $40 off main
    // Total: $120 - $40 = $80 = 8000 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id],
        couponCode: fixedExclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(8000);
  });

  test('$40 fixed coupon, exclude_bumps=false, 1 bump: discount on total', async ({ request }) => {
    // Main $100, Bump1 $20 → subtotal $120
    // Discount: min($40, $120) = $40
    // Total: $120 - $40 = $80 = 8000 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id],
        couponCode: fixedInclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(8000);
  });

  test('$40 fixed coupon, exclude_bumps=true, 3 bumps: discount on main, bumps untouched', async ({ request }) => {
    // Main $100, Bump1 $20, Bump2 $30, Bump3 $50 → subtotal $200
    // Discount: min($40, $100) = $40 off main
    // Total: $200 - $40 = $160 = 16000 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id, bumpProduct3.id],
        couponCode: fixedExclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(16000);
  });

  test('$40 fixed coupon, exclude_bumps=false, 3 bumps: discount on total', async ({ request }) => {
    // Main $100, Bump1 $20, Bump2 $30, Bump3 $50 → subtotal $200
    // Discount: min($40, $200) = $40
    // Total: $200 - $40 = $160 = 16000 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id, bumpProduct3.id],
        couponCode: fixedInclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(16000);
  });

  // =====================================================================
  // Edge Cases
  // =====================================================================

  test('massive fixed coupon: 100% off requires login (free access flow)', async ({ request }) => {
    // Main $100, Bump1 $20 → subtotal $120
    // Discount: min($900, $120) = $120 → total = $0 → isFreeWithCoupon = true
    // Since BLOK 11: when coupon reduces total to $0, API skips Stripe entirely
    // and grants access directly — but only for authenticated users.
    // Guest (no session cookie) gets 401 requiring login first.

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id],
        couponCode: bigFixed.code,
      }
    });

    // Unauthenticated request → 401 (must log in to use free coupon)
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('log in');
  });

  test('no bumps selected + percentage coupon: discount on main only', async ({ request }) => {
    // Main $100, no bumps
    // Discount: 25% of $100 = $25
    // Total: $75 = 7500 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        couponCode: pctInclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(7500);
  });

  test('product-specific coupon + multi-bump: works when product matches', async ({ request }) => {
    // Main $100, Bump1 $20, Bump3 $50 → subtotal $170
    // Coupon: 10% off, allowed_product_ids=[mainProduct]
    // Discount: 10% of $170 = $17
    // Total: $170 - $17 = $153 = 15300 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct3.id],
        couponCode: productSpecific.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(15300);
  });

  // =====================================================================
  // Metadata Verification
  // =====================================================================

  test('metadata includes coupon info and all bump IDs', async ({ request }) => {
    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id],
        couponCode: pctInclude.code,
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    // Verify coupon metadata
    expect(pi.metadata.coupon_code).toBe(pctInclude.code);
    expect(pi.metadata.coupon_id).toBe(pctInclude.id);

    // Verify bump metadata
    const bumpIds = pi.metadata.bump_product_ids.split(',');
    expect(bumpIds).toContain(bumpProduct1.id);
    expect(bumpIds).toContain(bumpProduct2.id);

    // Backward compat: bump_product_id should be first bump
    expect(pi.metadata.bump_product_id).toBeTruthy();
  });

  test('no coupon + 3 bumps: full price, correct amount', async ({ request }) => {
    // Main $100, Bump1 $20, Bump2 $30, Bump3 $50 → $200 = 20000 cents

    const res = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'cmb-test@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id, bumpProduct3.id],
      }
    });

    expect(res.status()).toBe(200);
    const { paymentIntentId } = await res.json();
    const pi = await getStripePaymentIntent(paymentIntentId);

    expect(pi.amount).toBe(20000);
  });
});
