import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';

// NOTE: Run with --workers=1 because tests modify global DB state

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to create test products
async function createTestProduct(suffix: string, price: number = 49.99) {
  const timestamp = Date.now();
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: `Test Product ${suffix} ${timestamp}`,
      slug: `test-${suffix.toLowerCase()}-${timestamp}`,
      price,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Helper to create test transaction
async function createTestTransaction(productId: string, email: string) {
  const timestamp = Date.now();
  const { data, error } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      session_id: `cs_test_${timestamp}_${Math.random().toString(36).slice(2)}`,
      product_id: productId,
      customer_email: email,
      amount: 49.99,
      currency: 'USD',
      status: 'completed',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

test.describe('OTO (One-Time Offer) System', () => {
  // Store created resources for cleanup
  let sourceProductId: string;
  let otoProductId: string;
  let otoOfferId: string;
  let otoCouponCode: string;
  const testEmail = `oto-test-${Date.now()}@example.com`;

  // Clear rate limits before each test
  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
  });

  // Cleanup after all tests
  test.afterAll(async () => {
    // Delete OTO coupons
    if (otoCouponCode) {
      await supabaseAdmin.from('coupons').delete().eq('code', otoCouponCode);
    }
    // Delete OTO offer
    if (otoOfferId) {
      await supabaseAdmin.from('oto_offers').delete().eq('id', otoOfferId);
    }
    // Delete test products
    if (sourceProductId) {
      await supabaseAdmin.from('products').delete().eq('id', sourceProductId);
    }
    if (otoProductId) {
      await supabaseAdmin.from('products').delete().eq('id', otoProductId);
    }
  });

  test('should create OTO offer and generate coupon after purchase', async () => {
    const timestamp = Date.now();

    // 1. Create source product (what customer buys)
    const { data: sourceProduct, error: sourceError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `OTO Source Product ${timestamp}`,
        slug: `oto-source-${timestamp}`,
        price: 49.99,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    expect(sourceError).toBeNull();
    expect(sourceProduct).toBeDefined();
    sourceProductId = sourceProduct!.id;

    // 2. Create OTO product (discounted upsell)
    const { data: otoProduct, error: otoError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `OTO Upsell Product ${timestamp}`,
        slug: `oto-upsell-${timestamp}`,
        price: 99.99,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    expect(otoError).toBeNull();
    expect(otoProduct).toBeDefined();
    otoProductId = otoProduct!.id;

    // 3. Create OTO offer linking them (30% off for 15 minutes)
    const { data: otoOffer, error: offerError } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProductId,
        oto_product_id: otoProductId,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();

    expect(offerError).toBeNull();
    expect(otoOffer).toBeDefined();
    otoOfferId = otoOffer!.id;

    // 4. Create a payment transaction (simulating purchase completion)
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_oto_${timestamp}`,
        product_id: sourceProductId,
        customer_email: testEmail,
        amount: 49.99,
        currency: 'USD',
        status: 'completed',
      })
      .select()
      .single();

    expect(txError).toBeNull();
    expect(transaction).toBeDefined();

    // 5. Generate OTO coupon using the database function
    const { data: otoResult, error: otoGenError } = await supabaseAdmin.rpc(
      'generate_oto_coupon',
      {
        source_product_id_param: sourceProductId,
        customer_email_param: testEmail,
        transaction_id_param: transaction!.id,
      }
    );

    expect(otoGenError).toBeNull();
    expect(otoResult).toBeDefined();
    expect(otoResult.has_oto).toBe(true);
    expect(otoResult.coupon_code).toMatch(/^OTO-[A-Z0-9]+$/);
    expect(otoResult.discount_type).toBe('percentage');
    expect(otoResult.discount_value).toBe(30);
    expect(otoResult.oto_product_id).toBe(otoProductId);
    expect(otoResult.duration_minutes).toBe(15);

    otoCouponCode = otoResult.coupon_code;
  });

  test('should return valid OTO info via API', async ({ request }) => {
    // Fail fast if previous test did not generate a coupon
    expect(otoCouponCode, 'OTO coupon should have been generated by previous test').toBeTruthy();

    const response = await request.get(
      `/api/oto/info?code=${otoCouponCode}&email=${testEmail}`
    );

    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.valid).toBe(true);
    expect(data.code).toBe(otoCouponCode);
    expect(data.discount_type).toBe('percentage');
    expect(data.discount_value).toBe(30);
    expect(data.seconds_remaining).toBeGreaterThan(0);
    expect(data.product).toBeDefined();
    expect(data.product.id).toBe(otoProductId);
  });

  test('should reject OTO coupon for wrong email', async ({ request }) => {
    expect(otoCouponCode, 'OTO coupon should have been generated by previous test').toBeTruthy();

    const response = await request.get(
      `/api/oto/info?code=${otoCouponCode}&email=wrong@example.com`
    );

    const data = await response.json();
    expect(data.valid).toBe(false);
  });

  test('should reject invalid OTO coupon code', async ({ request }) => {
    const response = await request.get(
      `/api/oto/info?code=INVALID-CODE&email=${testEmail}`
    );

    const data = await response.json();
    expect(data.valid).toBe(false);
  });

  test('should display OTO banner on checkout page', async ({ page }) => {
    expect(otoCouponCode, 'OTO coupon should have been generated by previous test').toBeTruthy();
    expect(otoProductId, 'OTO product ID should have been set by previous test').toBeTruthy();

    // Get OTO product slug
    const { data: otoProduct } = await supabaseAdmin
      .from('products')
      .select('slug')
      .eq('id', otoProductId)
      .single();

    expect(otoProduct).toBeDefined();

    await acceptAllCookies(page);

    // Visit checkout with OTO params
    await page.goto(
      `/checkout/${otoProduct!.slug}?email=${encodeURIComponent(testEmail)}&coupon=${otoCouponCode}&oto=1`
    );

    // Wait for page to be ready (don't use networkidle - it's unreliable)
    await page.waitForLoadState('domcontentloaded');

    // Should see OTO countdown banner
    const otoBanner = page.locator('[data-testid="oto-countdown-banner"]');
    await expect(otoBanner).toBeVisible({ timeout: 15000 });

    // Should see discount info inside the banner
    await expect(otoBanner.getByText('30%')).toBeVisible({ timeout: 5000 });
  });

  test('should auto-apply OTO coupon in checkout', async ({ page }) => {
    expect(otoCouponCode, 'OTO coupon should have been generated by previous test').toBeTruthy();
    expect(otoProductId, 'OTO product ID should have been set by previous test').toBeTruthy();

    const { data: otoProduct } = await supabaseAdmin
      .from('products')
      .select('slug, price')
      .eq('id', otoProductId)
      .single();

    expect(otoProduct).toBeDefined();

    await acceptAllCookies(page);

    // Visit checkout with OTO coupon
    await page.goto(
      `/checkout/${otoProduct!.slug}?email=${encodeURIComponent(testEmail)}&coupon=${otoCouponCode}&oto=1`
    );

    await page.waitForLoadState('domcontentloaded');

    // Coupon should be auto-applied
    const couponInput = page.locator('input[placeholder="Enter code"]');
    await expect(couponInput).toHaveValue(otoCouponCode, { timeout: 15000 });

    // Should show discount applied message
    await expect(
      page.getByText(/discount applied/i)
    ).toBeVisible({ timeout: 15000 });
  });

  test('should return no OTO when product has no offer configured', async () => {
    const timestamp = Date.now();

    // Create product without OTO offer
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `No OTO Product ${timestamp}`,
        slug: `no-oto-${timestamp}`,
        price: 29.99,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    expect(productError).toBeNull();
    expect(product).toBeDefined();

    // Create transaction
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_no_oto_${timestamp}`,
        product_id: product!.id,
        customer_email: `no-oto-${timestamp}@example.com`,
        amount: 29.99,
        currency: 'USD',
        status: 'completed',
      })
      .select()
      .single();

    expect(txError).toBeNull();
    expect(transaction).toBeDefined();

    // Try to generate OTO coupon - should return has_oto: false
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: product!.id,
      customer_email_param: `no-oto-${timestamp}@example.com`,
      transaction_id_param: transaction!.id,
    });

    expect(otoResult.has_oto).toBe(false);

    // Cleanup
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction!.id);
    await supabaseAdmin.from('products').delete().eq('id', product!.id);
  });

  test('should cleanup expired OTO coupons', async () => {
    const timestamp = Date.now();

    // Create an expired OTO coupon directly
    const { data: expiredCoupon, error: expiredCouponError } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `OTO-EXPIRED-${timestamp}`,
        name: 'Expired OTO Coupon',
        discount_type: 'percentage',
        discount_value: 20,
        is_active: true,
        is_oto_coupon: true,
        expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        current_usage_count: 0,
      })
      .select()
      .single();

    expect(expiredCouponError).toBeNull();
    expect(expiredCoupon).toBeDefined();

    // Run cleanup function
    const { data: deletedCount, error: cleanupError } = await supabaseAdmin.rpc('cleanup_expired_oto_coupons');
    expect(cleanupError).toBeNull();

    // Should have deleted at least 1 coupon
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    // Verify coupon was deleted
    const { data: checkCoupon } = await supabaseAdmin
      .from('coupons')
      .select()
      .eq('code', `OTO-EXPIRED-${timestamp}`)
      .maybeSingle();

    expect(checkCoupon).toBeNull();
  });
});

// =====================================================
// ADDITIONAL OTO TEST COVERAGE
// =====================================================

test.describe('OTO Fixed Discount Type', () => {
  let sourceProduct: { id: string; slug: string };
  let otoProduct: { id: string; slug: string };
  let otoOffer: { id: string };
  let couponCode: string;
  const testEmail = `oto-fixed-${Date.now()}@example.com`;

  test.beforeAll(async () => {
    // Create products
    sourceProduct = await createTestProduct('FixedSource', 79.99);
    otoProduct = await createTestProduct('FixedOTO', 149.99);

    // Create OTO offer with FIXED discount ($50 off)
    const { data } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'fixed',
        discount_value: 50,
        duration_minutes: 10,
        is_active: true,
      })
      .select()
      .single();

    otoOffer = data!;
  });

  test.afterAll(async () => {
    if (couponCode) {
      await supabaseAdmin.from('coupons').delete().eq('code', couponCode);
    }
    if (otoOffer?.id) {
      await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer.id);
    }
    if (sourceProduct?.id) {
      await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    }
    if (otoProduct?.id) {
      await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
    }
  });

  test('should generate OTO coupon with fixed discount type', async () => {
    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    expect(otoResult.has_oto).toBe(true);
    expect(otoResult.discount_type).toBe('fixed');
    expect(otoResult.discount_value).toBe(50);
    expect(otoResult.duration_minutes).toBe(10);

    couponCode = otoResult.coupon_code;
  });

  test('should return fixed discount info via API', async ({ request }) => {
    expect(couponCode, 'Coupon code should have been generated by previous test').toBeTruthy();

    const response = await request.get(
      `/api/oto/info?code=${couponCode}&email=${testEmail}`
    );

    const data = await response.json();
    expect(data.valid).toBe(true);
    expect(data.discount_type).toBe('fixed');
    expect(data.discount_value).toBe(50);
  });
});

test.describe('OTO Coupon Restrictions', () => {
  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test('OTO coupon should be single-use (usage_limit = 1)', async () => {
    const sourceProduct = await createTestProduct('SingleUseSource');
    const otoProduct = await createTestProduct('SingleUseOTO');
    const testEmail = `single-use-${Date.now()}@example.com`;

    // Create OTO offer
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 25,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();

    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Generate OTO coupon
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    // Verify coupon has usage_limit_global = 1
    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('usage_limit_global, usage_limit_per_user')
      .eq('code', otoResult.coupon_code)
      .single();

    expect(coupon?.usage_limit_global).toBe(1);
    expect(coupon?.usage_limit_per_user).toBe(1);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', otoResult.coupon_code);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });

  test('OTO coupon should be restricted to OTO product only', async () => {
    const sourceProduct = await createTestProduct('RestrictedSource');
    const otoProduct = await createTestProduct('RestrictedOTO');
    const otherProduct = await createTestProduct('OtherProduct');
    const testEmail = `restricted-${Date.now()}@example.com`;

    // Create OTO offer
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 20,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();

    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Generate OTO coupon
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    // Verify coupon is restricted to OTO product
    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('allowed_product_ids')
      .eq('code', otoResult.coupon_code)
      .single();

    expect(coupon?.allowed_product_ids).toContain(otoProduct.id);
    expect(coupon?.allowed_product_ids).not.toContain(otherProduct.id);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', otoResult.coupon_code);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otherProduct.id);
  });

  test('OTO coupon should be email-bound', async () => {
    const sourceProduct = await createTestProduct('EmailBoundSource');
    const otoProduct = await createTestProduct('EmailBoundOTO');
    const testEmail = `email-bound-${Date.now()}@example.com`;

    // Create OTO offer
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 15,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();

    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Generate OTO coupon
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    // Verify coupon is email-restricted
    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('allowed_emails')
      .eq('code', otoResult.coupon_code)
      .single();

    expect(coupon?.allowed_emails).toContain(testEmail);
    expect(coupon?.allowed_emails).toHaveLength(1);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', otoResult.coupon_code);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });
});

test.describe('OTO API Edge Cases', () => {
  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test('should return error for expired OTO coupon via API', async ({ request }) => {
    const timestamp = Date.now();

    // Create expired coupon directly
    const { error: insertError } = await supabaseAdmin.from('coupons').insert({
      code: `OTO-API-EXPIRED-${timestamp}`,
      name: 'Expired API Test',
      discount_type: 'percentage',
      discount_value: 20,
      is_active: true,
      is_oto_coupon: true,
      allowed_emails: [`expired-test-${timestamp}@example.com`],
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // 1 minute ago
    });
    expect(insertError).toBeNull();

    const response = await request.get(
      `/api/oto/info?code=OTO-API-EXPIRED-${timestamp}&email=expired-test-${timestamp}@example.com`
    );

    const data = await response.json();
    expect(data.valid).toBe(false);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', `OTO-API-EXPIRED-${timestamp}`);
  });

  test('should return error for missing parameters', async ({ request }) => {
    // Missing email
    let response = await request.get('/api/oto/info?code=SOME-CODE');
    expect(response.status()).toBe(400);

    // Missing code
    response = await request.get('/api/oto/info?email=test@example.com');
    expect(response.status()).toBe(400);

    // Empty parameters
    response = await request.get('/api/oto/info');
    expect(response.status()).toBe(400);
  });

  test('should handle non-OTO coupon gracefully', async ({ request }) => {
    const timestamp = Date.now();

    // Create regular (non-OTO) coupon
    const { error: insertError } = await supabaseAdmin.from('coupons').insert({
      code: `REGULAR-${timestamp}`,
      name: 'Regular Coupon',
      discount_type: 'percentage',
      discount_value: 10,
      is_active: true,
      is_oto_coupon: false,
    });
    expect(insertError).toBeNull();

    const response = await request.get(
      `/api/oto/info?code=REGULAR-${timestamp}&email=test@example.com`
    );

    const data = await response.json();
    expect(data.valid).toBe(false);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', `REGULAR-${timestamp}`);
  });
});

test.describe('OTO Duration Settings', () => {
  test('should respect custom duration (5 minutes)', async () => {
    const sourceProduct = await createTestProduct('Duration5Source');
    const otoProduct = await createTestProduct('Duration5OTO');
    const testEmail = `duration5-${Date.now()}@example.com`;

    // Create OTO offer with 5 minute duration
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 40,
        duration_minutes: 5,
        is_active: true,
      })
      .select()
      .single();

    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Generate OTO coupon
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    expect(otoResult.duration_minutes).toBe(5);

    // Verify expiry time is approximately 5 minutes from now
    const expiresAt = new Date(otoResult.expires_at).getTime();
    const now = Date.now();
    const diffMinutes = (expiresAt - now) / 1000 / 60;

    expect(diffMinutes).toBeGreaterThan(4);
    expect(diffMinutes).toBeLessThanOrEqual(5);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', otoResult.coupon_code);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });

  test('should respect custom duration (30 minutes)', async () => {
    const sourceProduct = await createTestProduct('Duration30Source');
    const otoProduct = await createTestProduct('Duration30OTO');
    const testEmail = `duration30-${Date.now()}@example.com`;

    // Create OTO offer with 30 minute duration
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'fixed',
        discount_value: 100,
        duration_minutes: 30,
        is_active: true,
      })
      .select()
      .single();

    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Generate OTO coupon
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    expect(otoResult.duration_minutes).toBe(30);

    // Verify expiry time is approximately 30 minutes from now
    const expiresAt = new Date(otoResult.expires_at).getTime();
    const now = Date.now();
    const diffMinutes = (expiresAt - now) / 1000 / 60;

    expect(diffMinutes).toBeGreaterThan(29);
    expect(diffMinutes).toBeLessThanOrEqual(30);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', otoResult.coupon_code);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });
});

test.describe('OTO Skip - User Already Owns Product', () => {
  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test('should NOT generate OTO coupon when logged-in user already owns OTO product', async () => {
    const timestamp = Date.now();
    const testEmail = `owns-oto-${timestamp}@example.com`;

    // Create products
    const sourceProduct = await createTestProduct('OwnsOTOSource', 49.99);
    const otoProduct = await createTestProduct('OwnsOTOProduct', 99.99);

    // Create OTO offer
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();

    // Create a test user in auth.users
    const { data: authData } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      email_confirm: true,
    });
    const testUserId = authData.user!.id;

    // Give user access to OTO product (they already own it!)
    const { error: accessError } = await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: testUserId,
        product_id: otoProduct.id,
        access_granted_at: new Date().toISOString(),
      });
    expect(accessError).toBeNull();

    // Create transaction for buying source product
    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Try to generate OTO coupon - should return has_oto: false
    const { data: otoResult, error: rpcError } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });
    expect(rpcError).toBeNull();

    // Verify OTO was skipped
    expect(otoResult.has_oto).toBe(false);
    expect(otoResult.reason).toBe('already_owns_oto_product');
    expect(otoResult.skipped_oto_product_id).toBe(otoProduct.id);
    expect(otoResult.skipped_oto_product_slug).toBe(otoProduct.slug);

    // Cleanup
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUserId);
    await supabaseAdmin.auth.admin.deleteUser(testUserId);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });

  test('should NOT generate OTO coupon when guest already owns OTO product', async () => {
    const timestamp = Date.now();
    const testEmail = `guest-owns-oto-${timestamp}@example.com`;

    // Create products
    const sourceProduct = await createTestProduct('GuestOwnsSource', 49.99);
    const otoProduct = await createTestProduct('GuestOwnsOTO', 99.99);

    // Create OTO offer
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 25,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();

    // Create guest_purchase record for OTO product (guest already bought it!)
    const { error: guestPurchaseError } = await supabaseAdmin
      .from('guest_purchases')
      .insert({
        customer_email: testEmail,
        product_id: otoProduct.id,
        transaction_amount: 99.99,
        session_id: `cs_guest_previous_${timestamp}`,
      });
    expect(guestPurchaseError).toBeNull();

    // Now guest buys source product
    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Try to generate OTO coupon - should return has_oto: false
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    // Verify OTO was skipped
    expect(otoResult.has_oto).toBe(false);
    expect(otoResult.reason).toBe('already_owns_oto_product');
    expect(otoResult.skipped_oto_product_id).toBe(otoProduct.id);
    expect(otoResult.skipped_oto_product_slug).toBe(otoProduct.slug);

    // Cleanup
    await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', testEmail);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });

  test('should NOT skip OTO if user has expired access to OTO product', async () => {
    const timestamp = Date.now();
    const testEmail = `expired-access-${timestamp}@example.com`;

    // Create products
    const sourceProduct = await createTestProduct('ExpiredAccessSource', 49.99);
    const otoProduct = await createTestProduct('ExpiredAccessOTO', 99.99);

    // Create OTO offer
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 20,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();

    // Create a test user
    const { data: authData } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      email_confirm: true,
    });
    const testUserId = authData.user!.id;

    // Give user EXPIRED access to OTO product
    const { error: accessError } = await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: testUserId,
        product_id: otoProduct.id,
        access_granted_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
        access_expires_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // expired 1 day ago
      });
    expect(accessError).toBeNull();

    // Create transaction
    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Generate OTO coupon - should work because access is expired!
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    // Should generate OTO because expired access doesn't count
    expect(otoResult.has_oto).toBe(true);
    expect(otoResult.coupon_code).toMatch(/^OTO-[A-Z0-9]+$/);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', otoResult.coupon_code);
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUserId);
    await supabaseAdmin.auth.admin.deleteUser(testUserId);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });
});

test.describe('OTO Race Condition Protection', () => {
  test('should not create duplicate coupons when called concurrently', async () => {
    const timestamp = Date.now();
    const testEmail = `race-condition-${timestamp}@example.com`;

    // Create products
    const sourceProduct = await createTestProduct('RaceSource', 49.99);
    const otoProduct = await createTestProduct('RaceOTO', 99.99);

    // Create OTO offer
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();

    // Create transaction
    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Call generate_oto_coupon 5 times concurrently (simulating race condition)
    const promises = Array(5).fill(null).map(() =>
      supabaseAdmin.rpc('generate_oto_coupon', {
        source_product_id_param: sourceProduct.id,
        customer_email_param: testEmail,
        transaction_id_param: transaction.id,
      })
    );

    const results = await Promise.all(promises);

    // All should return has_oto: true
    for (const { data } of results) {
      expect(data.has_oto).toBe(true);
      expect(data.coupon_code).toMatch(/^OTO-[A-Z0-9]+$/);
    }

    // All should return the SAME coupon code (no duplicates)
    const couponCodes = results.map(r => r.data.coupon_code);
    const uniqueCodes = [...new Set(couponCodes)];
    expect(uniqueCodes).toHaveLength(1);

    // Verify only ONE coupon exists in database for this transaction
    const { data: coupons } = await supabaseAdmin
      .from('coupons')
      .select('code')
      .eq('source_transaction_id', transaction.id)
      .eq('is_oto_coupon', true);

    expect(coupons).toHaveLength(1);

    // Cleanup
    await supabaseAdmin.from('coupons').delete().eq('code', uniqueCodes[0]);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });
});

test.describe('OTO Inactive Offer', () => {
  test('should not generate coupon for inactive OTO offer', async () => {
    const sourceProduct = await createTestProduct('InactiveSource');
    const otoProduct = await createTestProduct('InactiveOTO');
    const testEmail = `inactive-${Date.now()}@example.com`;

    // Create INACTIVE OTO offer
    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: 50,
        duration_minutes: 15,
        is_active: false, // INACTIVE
      })
      .select()
      .single();

    const transaction = await createTestTransaction(sourceProduct.id, testEmail);

    // Try to generate OTO coupon
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction.id,
    });

    // Should return has_oto: false for inactive offers
    expect(otoResult.has_oto).toBe(false);

    // Cleanup
    await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer!.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('id', transaction.id);
    await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });
});

test.describe('OTO Checkout Page E2E', () => {
  let sourceProduct: any;
  let otoProduct: any;
  let otoOffer: any;
  let couponCode: string;
  const testEmail = `oto-checkout-e2e-${Date.now()}@example.com`;

  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test.beforeAll(async () => {
    const timestamp = Date.now();

    // Create source product
    const { data: src, error: srcError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `E2E Source ${timestamp}`,
        slug: `e2e-source-${timestamp}`,
        price: 49.99,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    if (srcError) throw srcError;
    sourceProduct = src;

    // Create OTO product
    const { data: oto, error: otoError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `E2E OTO Product ${timestamp}`,
        slug: `e2e-oto-${timestamp}`,
        price: 99.99,
        currency: 'USD',
        is_active: true,
        icon: '🛠️',
      })
      .select()
      .single();
    if (otoError) throw otoError;
    otoProduct = oto;

    // Create OTO offer with fixed $20 discount
    const { data: offer, error: offerError } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'fixed',
        discount_value: 20,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();
    if (offerError) throw offerError;
    otoOffer = offer;

    // Create transaction and generate OTO coupon
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_e2e_checkout_${timestamp}`,
        product_id: sourceProduct.id,
        customer_email: testEmail,
        amount: 49.99,
        currency: 'USD',
        status: 'completed',
      })
      .select()
      .single();
    if (txError) throw txError;

    const { data: otoResult, error: rpcError } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: transaction!.id,
    });
    if (rpcError) throw rpcError;

    couponCode = otoResult.coupon_code;
  });

  test.afterAll(async () => {
    if (couponCode) {
      await supabaseAdmin.from('coupons').delete().eq('code', couponCode);
    }
    if (otoOffer?.id) {
      await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer.id);
    }
    if (sourceProduct?.id) {
      await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    }
    if (otoProduct?.id) {
      await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
    }
  });

  test('should prefill email and auto-apply OTO coupon with discount on checkout', async ({ page }) => {
    expect(couponCode, 'OTO coupon should have been generated in beforeAll').toBeTruthy();
    expect(otoProduct, 'OTO product should have been created in beforeAll').toBeTruthy();

    await acceptAllCookies(page);

    // Navigate to checkout with OTO params (email, coupon, oto=1)
    await page.goto(
      `/checkout/${otoProduct.slug}?email=${encodeURIComponent(testEmail)}&coupon=${couponCode}&oto=1`
    );

    // Wait for page DOM to load (don't use networkidle — Stripe makes continuous requests)
    await page.waitForLoadState('domcontentloaded');

    // 1. Email is passed to Stripe's LinkAuthenticationElement (iframe)
    // Verify our code passes the correct email via data-test-email attribute
    const emailWrapper = page.locator('[data-test-email]');
    await expect(emailWrapper).toHaveAttribute('data-test-email', testEmail, { timeout: 20000 });

    // 2. Coupon code should be visible in coupon input
    const couponInput = page.locator('input[placeholder*="code"], input[placeholder*="kod"]');
    await expect(couponInput).toHaveValue(couponCode, { timeout: 15000 });

    // 3. Discount applied message should be visible (in EN or PL)
    await expect(
      page.getByText(/discount applied|zastosowano zniżkę/i)
    ).toBeVisible({ timeout: 15000 });

    // 4. Should show the discount amount ($20 or 20 USD) - use first() as it may appear multiple times
    await expect(
      page.getByText(/20\s*(USD|\$)/i).first()
    ).toBeVisible({ timeout: 10000 });

    // 5. Coupon should show verified state (green checkmark icon or success state)
    const verifiedIndicator = page.locator('[data-testid="coupon-verified"], .text-sf-success');
    await expect(verifiedIndicator.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show OTO countdown banner on checkout page', async ({ page }) => {
    expect(couponCode, 'OTO coupon should have been generated in beforeAll').toBeTruthy();
    expect(otoProduct, 'OTO product should have been created in beforeAll').toBeTruthy();

    await acceptAllCookies(page);

    await page.goto(
      `/checkout/${otoProduct.slug}?email=${encodeURIComponent(testEmail)}&coupon=${couponCode}&oto=1`
    );

    // Wait for page DOM to load (don't use networkidle — Stripe makes continuous requests)
    await page.waitForLoadState('domcontentloaded');

    // OTO countdown banner should be visible
    const otoBanner = page.locator('[data-testid="oto-countdown-banner"]');
    await expect(otoBanner).toBeVisible({ timeout: 20000 });

    // Banner should show countdown timer or time remaining
    await expect(otoBanner.getByText(/\d+:\d+|\d+\s*(min|minut)/i)).toBeVisible({ timeout: 10000 });
  });

});

// =====================================================
// BUG REGRESSION: OTO coupon not passed to payment processing
// https://github.com/jurczykpawel/sellf/issues/oto-amount-mismatch
// =====================================================
// Root cause: verify-payment.ts reads coupon_id from paymentIntent.metadata.coupon_id,
// but create-payment-intent API does not store coupon_id in Stripe metadata when a coupon
// is applied. As a result, process_stripe_payment_completion_with_bump is called with
// coupon_id_param: null even when a coupon was used, which causes the DB function to
// validate the exact (pre-discount) price → "Amount mismatch" error → access NOT granted.
//
// Fix required: store coupon_id in PaymentIntent metadata when creating the payment intent.
// =====================================================

test.describe('OTO Payment Completion with Coupon (bug regression)', () => {
  let sourceProduct: { id: string; slug: string; price: number };
  let otoProduct: { id: string; slug: string; price: number };
  let otoOffer: { id: string };
  let couponCode: string;
  let couponId: string;
  const OTO_FIXED_DISCOUNT = 50; // $50 off
  const testEmail = `oto-payment-bug-${Date.now()}@example.com`;

  test.beforeAll(async () => {
    // OTO product price mirrors the demo scenario: $199.99 - $50 coupon = $149.99 paid
    sourceProduct = await createTestProduct('BugSource', 49.99);
    otoProduct = await createTestProduct('BugOTO', 199.99);

    const { data: offer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: sourceProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'fixed',
        discount_value: OTO_FIXED_DISCOUNT,
        duration_minutes: 30,
        is_active: true,
      })
      .select()
      .single();

    otoOffer = offer!;

    // Complete a source product purchase to generate the OTO coupon
    const tx = await createTestTransaction(sourceProduct.id, testEmail);
    const { data: otoResult } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: sourceProduct.id,
      customer_email_param: testEmail,
      transaction_id_param: tx.id,
    });

    couponCode = otoResult.coupon_code;

    // Fetch the coupon UUID needed to pass as coupon_id_param
    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .eq('code', couponCode)
      .single();

    couponId = coupon!.id;

    // Clean up the source product transaction (not needed beyond coupon generation)
    await supabaseAdmin.from('payment_transactions').delete().eq('id', tx.id);
  });

  test.afterAll(async () => {
    if (couponCode) await supabaseAdmin.from('coupons').delete().eq('code', couponCode);
    if (otoOffer?.id) await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer.id);
    if (sourceProduct?.id) await supabaseAdmin.from('products').delete().eq('id', sourceProduct.id);
    if (otoProduct?.id) await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
  });

  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test('[SECURITY] DB correctly rejects discounted amount when coupon_id is not provided', async () => {
    // Documents the DB security property that prevents price manipulation:
    // Without coupon_id_param, the DB validates the exact product price.
    // This is the failure mode that occurred in production when create-payment-intent
    // did not store coupon_id in Stripe PaymentIntent metadata.
    //
    // Fix applied: create-payment-intent now stores coupon_id in metadata so that
    // verify-payment.ts can pass it as coupon_id_param to the DB function.

    const piId = `pi_test_security_null_coupon_${Date.now()}`;
    const discountedCents = Math.round((199.99 - OTO_FIXED_DISCOUNT) * 100); // 14999

    const { error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: piId,
        product_id_param: otoProduct.id,
        customer_email_param: testEmail,
        amount_total: discountedCents,
        currency_param: 'usd',
        stripe_payment_intent_id: piId,
        user_id_param: null,
        bump_product_ids_param: null,
        coupon_id_param: null,
      }
    );

    // Cleanup any partial state created before the exception
    await supabaseAdmin
      .from('payment_transactions')
      .delete()
      .eq('stripe_payment_intent_id', piId);

    // DB MUST reject discounted amount when no coupon_id is supplied.
    // This is a security invariant — without coupon_id, exact price must match.
    expect(error, 'DB should reject discounted amount without coupon_id (price manipulation guard)').not.toBeNull();
    expect(error?.message).toContain('Amount mismatch');
  });

  test('[CONTROL] DB function correctly grants access when coupon_id is properly passed', async () => {
    // This test verifies that the DB function itself handles discounted OTO payments correctly
    // when coupon_id_param is provided. This is what SHOULD happen after the fix.

    const piId = `pi_test_correct_coupon_${Date.now()}`;
    const discountedCents = Math.round((199.99 - OTO_FIXED_DISCOUNT) * 100); // 14999

    // The DB security system requires a pre-existing reservation before a coupon can be consumed.
    // In production this is created by verify_coupon; here we insert it directly.
    await supabaseAdmin.from('coupon_reservations').insert({
      coupon_id: couponId,
      customer_email: testEmail,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: piId,
        product_id_param: otoProduct.id,
        customer_email_param: testEmail,
        amount_total: discountedCents,
        currency_param: 'usd',
        stripe_payment_intent_id: piId,
        user_id_param: null,
        bump_product_ids_param: null,
        coupon_id_param: couponId, // CORRECT: coupon_id passed as it should be
      }
    );

    // Cleanup (reservation is consumed by the DB function on success)
    await supabaseAdmin
      .from('payment_transactions')
      .delete()
      .eq('stripe_payment_intent_id', piId);
    await supabaseAdmin
      .from('guest_purchases')
      .delete()
      .eq('customer_email', testEmail)
      .eq('product_id', otoProduct.id);
    // Guard: clean up reservation if test fails before DB function consumes it
    await supabaseAdmin
      .from('coupon_reservations')
      .delete()
      .eq('coupon_id', couponId)
      .eq('customer_email', testEmail);

    // For guest checkout (user_id_param: null) the function intentionally returns
    // access_granted: false — the user must claim access via magic link.
    // What matters here is that the function succeeds and records the guest purchase.
    expect(error).toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.is_guest_purchase).toBe(true);
  });
});

// =====================================================
// BUG REGRESSION: OTO skipped for free ($0) products
// Root cause: grant-access/route.ts never calls generate_oto_coupon — it only
// grants user_product_access and returns { success: true }. The frontend
// therefore has no OTO redirect URL and goes directly to payment-status,
// bypassing the OTO intermediate checkout screen.
//
// Fix required:
// 1. generate_oto_coupon must accept transaction_id_param = NULL (free products
//    have no payment transaction).
// 2. grant-access route must call generate_oto_coupon after granting access
//    and return otoRedirectUrl in the response.
// 3. FreeProductForm (and PaidProductForm PWYW-free path) must redirect to
//    otoRedirectUrl when present.
// =====================================================

test.describe('OTO for Free Products (bug regression)', () => {
  let freeProduct: { id: string; slug: string; price: number };
  let otoProduct: { id: string; slug: string; price: number };
  let otoOffer: { id: string };
  let testUser: { id: string; email: string };
  const TEST_PASSWORD = 'FreeOTO123!';
  const OTO_DISCOUNT_PCT = 20;
  const testEmail = `oto-free-product-${Date.now()}@example.com`;

  test.beforeAll(async () => {
    const timestamp = Date.now();

    freeProduct = await createTestProduct(`FreeSrc-${timestamp}`, 0);
    otoProduct = await createTestProduct(`FreeOTO-${timestamp}`, 99.99);

    const { data: offer, error: offerError } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: freeProduct.id,
        oto_product_id: otoProduct.id,
        discount_type: 'percentage',
        discount_value: OTO_DISCOUNT_PCT,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();
    if (offerError) throw offerError;
    otoOffer = offer!;

    const { data: userResult, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (userError) throw userError;
    testUser = { id: userResult.user!.id, email: testEmail };
  });

  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    // Revoke access so each test starts clean
    if (testUser?.id && freeProduct?.id) {
      await supabaseAdmin
        .from('user_product_access')
        .delete()
        .eq('user_id', testUser.id)
        .eq('product_id', freeProduct.id);
    }
  });

  test.afterAll(async () => {
    await supabaseAdmin
      .from('coupons')
      .delete()
      .filter('allowed_emails', 'cs', JSON.stringify([testEmail]));
    if (otoOffer?.id) await supabaseAdmin.from('oto_offers').delete().eq('id', otoOffer.id);
    if (freeProduct?.id) await supabaseAdmin.from('products').delete().eq('id', freeProduct.id);
    if (otoProduct?.id) await supabaseAdmin.from('products').delete().eq('id', otoProduct.id);
    if (testUser?.id) await supabaseAdmin.auth.admin.deleteUser(testUser.id);
  });

  test('[BUG] grant-access returns no OTO redirect URL for free product with OTO configured', async ({ page }) => {
    // Navigate first so relative URLs work in page.evaluate
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Authenticate the test user in the browser context
    await setAuthSession(page, testEmail, TEST_PASSWORD);

    // Call the grant-access API endpoint directly (same call as FreeProductForm.handleFreeAccess)
    const response = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/public/products/${slug}/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      return res.json();
    }, freeProduct.slug);

    // Basic access grant should succeed
    expect(response.success, 'Grant-access should succeed for authenticated user').toBe(true);

    // BUG: grant-access never calls generate_oto_coupon → no otoInfo in response
    // After the fix, grant-access should detect the OTO offer and return coupon info
    // so that FreeProductForm can redirect to the OTO checkout screen.
    expect(
      response.otoInfo,
      'Grant-access must return otoInfo when the free product has an active OTO offer'
    ).toBeTruthy();

    // After the fix: otoInfo must contain all fields needed to build the OTO redirect URL
    if (response.otoInfo) {
      expect(response.otoInfo.has_oto).toBe(true);
      expect(response.otoInfo.oto_product_slug).toBe(otoProduct.slug);
      expect(response.otoInfo.coupon_code).toMatch(/^OTO-/);
    }
  });
});
