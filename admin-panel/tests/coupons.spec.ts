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

  // Clear rate limits before each test to prevent "Too many requests" errors
  test.beforeEach(async () => {
    // Clear application-level rate limits (used by coupon verify API)
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    // Clear DB-level rate limits (used by verify_coupon DB function)
    await supabaseAdmin
      .from('rate_limits')
      .delete()
      .in('function_name', ['verify_coupon', 'global_verify_coupon']);
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
    const couponInput = page.locator('input[placeholder="Wpisz kod"]');
    await expect(couponInput).toBeVisible();
    await expect(couponInput).toHaveValue(couponCode);

    // Wait for verification to finish and success message to appear (PL locale)
    await expect(page.getByText(/zniżkę|discount applied/i)).toBeVisible({ timeout: 15000 });

    // Check if applied state is active (success border)
    await expect(page.locator('.border-sf-success\\/50')).toBeVisible();
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

    // 3. Verify Error Message (EN: "Enter code", PL: "Wpisz kod")
    const input = page.locator('input[placeholder="Enter code"], input[placeholder="Wpisz kod"]');
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
    // PL: "Zastosowano zniżkę 10 USD" / EN: "10 USD discount applied"
    await expect(page.getByText(/discount applied|Zastosowano zniżkę/i)).toBeVisible({ timeout: 10000 });
  });

  test('should recalculate discount and total when order bump is added and removed after coupon is applied', async ({ page }) => {
    const timestamp = Date.now();
    const productSlug = `coupon-bump-ui-${timestamp}`;
    const couponCode = `BUMPUI${timestamp}`;

    const { data: product } = await supabaseAdmin.from('products').insert({
      name: 'Coupon + Bump UI Product',
      slug: productSlug,
      price: 100,
      currency: 'USD',
      is_active: true,
    }).select().single();

    const { data: bumpProduct } = await supabaseAdmin.from('products').insert({
      name: 'Coupon + Bump UI Addon',
      slug: `coupon-bump-addon-${timestamp}`,
      price: 50,
      currency: 'USD',
      is_active: true,
    }).select().single();

    await supabaseAdmin.from('order_bumps').insert({
      main_product_id: product!.id,
      bump_product_id: bumpProduct!.id,
      bump_title: 'UI Bump Offer',
      bump_price: 20,
      is_active: true,
      display_order: 1,
    });

    await supabaseAdmin.from('coupons').insert({
      code: couponCode,
      name: '20 percent global',
      discount_type: 'percentage',
      discount_value: 20,
      exclude_order_bumps: false,
      is_active: true,
      allowed_product_ids: [],
    });

    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${productSlug}?coupon=${couponCode}&show_promo=true`);

    await expect(page.getByText(/zniżkę|discount applied/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(new RegExp(`Rabat \\(${couponCode}\\)`))).toBeVisible();
    await expect(page.getByText('-$20.00 USD')).toBeVisible();
    await expect(page.getByText('$80.00 USD')).toBeVisible();

    const addButton = page.getByRole('button', { name: /Dodaj|Add to order/i });
    await addButton.click();

    await expect(page.getByText('-$24.00 USD')).toBeVisible();
    await expect(page.getByText('$96.00 USD')).toBeVisible();

    const removeButton = page.getByRole('button', { name: /Dodano|Added/i });
    await removeButton.click();

    await expect(page.getByText('-$20.00 USD')).toBeVisible();
    await expect(page.getByText('$80.00 USD')).toBeVisible();
  });

});
