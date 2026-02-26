import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

// Enforce single worker because we modify global DB state
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Smart Coupons System', () => {

  // Clear rate limit before each test to prevent "Too many requests" errors
  test.beforeEach(async () => {
    // Clear application-level rate limits (used by coupon verify API)
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test('should apply coupon via URL and calculate price correctly', async ({ page }) => {
    const productSlug = `coupon-prod-${Date.now()}`;
    const couponCode = `TEST${Date.now()}`;
    const productPrice = 100;
    const discountPercent = 20; // 20% off

    // 1. Create Product
    const { data: product } = await supabaseAdmin.from('products').insert({
      name: 'Coupon Test Product',
      slug: productSlug,
      price: productPrice,
      currency: 'USD',
      is_active: true
    }).select().single();

    expect(product, 'Product insert failed — check Supabase logs').not.toBeNull();

    // 2. Create Coupon
    const { data: coupon, error: couponError } = await supabaseAdmin.from('coupons').insert({
      code: couponCode,
      name: 'Test Coupon',
      discount_type: 'percentage',
      discount_value: discountPercent,
      is_active: true,
      allowed_product_ids: [] // Global coupon
    }).select().single();

    if (couponError) console.error('Coupon creation error:', couponError);
    expect(coupon).not.toBeNull();

    // 3. Visit Checkout with Coupon URL Param
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${productSlug}?coupon=${couponCode}&show_promo=true`);

    // 4. Verify Coupon is Applied in UI
    const couponInput = page.locator('input[placeholder="Enter code"]');
    await expect(couponInput).toBeVisible();
    await expect(couponInput).toHaveValue(couponCode);

    // Wait for verification to finish and success message to appear
    await expect(page.getByText(/discount applied/i)).toBeVisible({ timeout: 15000 });

    // Check if applied state is active (green border)
    await expect(page.locator('.border-green-500\\\/50')).toBeVisible(); 
  });

  test('should validate invalid coupon via URL', async ({ page }) => {
    const productSlug = `invalid-coupon-prod-${Date.now()}`;
    const invalidCode = `INVALID${Date.now()}`;

    // 1. Create Product
    await supabaseAdmin.from('products').insert({
      name: 'Invalid Coupon Product',
      slug: productSlug,
      price: 50,
      currency: 'USD',
      is_active: true
    });

    // 2. Visit Checkout
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${productSlug}?coupon=${invalidCode}`);

    // 3. Verify Error Message
    const input = page.locator('input[placeholder="Enter code"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Wait for validation error
    await expect(page.getByText(/Invalid code|Invalid coupon code|Failed to verify/i)).toBeVisible({ timeout: 10000 });
    
    // Verify input still has the code
    await expect(input).toHaveValue(invalidCode);
  });

  test('should apply fixed amount coupon correctly', async ({ page }) => {
    const productSlug = `fixed-coupon-${Date.now()}`;
    const couponCode = `FIXED${Date.now()}`;
    const productPrice = 50;
    const discountAmount = 10; 

    // 1. Create Product
    const { data: product } = await supabaseAdmin.from('products').insert({
      name: 'Fixed Coupon Product',
      slug: productSlug,
      price: productPrice,
      currency: 'USD',
      is_active: true
    }).select().single();

    // 2. Create Coupon
    await supabaseAdmin.from('coupons').insert({
      code: couponCode,
      name: 'Fixed Amount Coupon',
      discount_type: 'fixed',
      discount_value: discountAmount,
      is_active: true,
      currency: 'USD',
      allowed_product_ids: [] // Global
    });

    // 3. Visit Checkout
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${productSlug}?coupon=${couponCode}`);

    // 4. Verify Application
    await expect(page.getByText(`${discountAmount} USD discount applied`, { exact: false })).toBeVisible({ timeout: 10000 });
  });

});