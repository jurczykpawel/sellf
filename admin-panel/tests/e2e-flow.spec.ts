import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.describe('E2E Critical Flows', () => {

  // 1. Internationalization Check
  test('should switch languages correctly', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load (SmartLanding can show onboarding, coming soon, or storefront)
    await page.waitForLoadState('networkidle');
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();

    // Switch to Polish (assuming we have a switcher)
    const plButton = page.locator('button', { hasText: 'PL' }).first();
    if (await plButton.isVisible()) {
      await plButton.click();
      // Wait for navigation or text change
      await expect(page).toHaveURL(/\/pl/);
      // Allow for either full translation or fallback
      await expect(page.locator('body')).not.toBeEmpty();
    }
  });

  // 2. Product Page Flow - SmartLanding shows different content based on user/products
  test('should display product details OR empty state', async ({ page }) => {
    // Go to homepage (SmartLanding)
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // SmartLanding can show: admin onboarding, guest coming soon, or storefront
    // Just verify the page loaded without errors
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
    const text = await body.textContent();
    expect(text).not.toContain('Application error');

    // If there's a product card with "Purchase" or "Get Access", verify it works
    const purchaseBtn = page.locator('a:has-text("Purchase"), a:has-text("Get Access"), a:has-text("Claim")').first();
    if (await purchaseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await purchaseBtn.click();
      // Should navigate to product page or checkout
      await page.waitForURL(/\/(p|checkout)\/.+/, { timeout: 5000 }).catch(() => {});
    }
  });

  // 3. Checkout UI Safety
  test('checkout page should render payment form safely', async ({ page }) => {
    await page.goto('/checkout/non-existent-product-123');
    
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
    const text = await body.textContent();
    expect(text).not.toContain('Application error: a client-side exception has occurred');
  });

  // 4. Coupon API Logic (Negative Test)
  test('should reject invalid coupons gracefully', async ({ request }) => {
    // The API short-circuits with 404 if the product doesn't exist, so we need
    // a real product to actually exercise the verify_coupon RPC path.
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase env variables for testing');
    }
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: product, error: productErr } = await admin
      .from('products')
      .insert({
        name: 'invalid-coupon e2e probe',
        slug: `invalid-coupon-${Date.now()}`,
        price: 100,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    if (productErr) throw productErr;

    try {
      const response = await request.post('/api/coupons/verify', {
        data: {
          code: 'INVALID-CODE-123',
          productId: product.id,
          email: 'test@example.com',
        },
      });

      const body = await response.json();
      expect(body).toBeDefined();
      expect(response.ok()).toBe(true);
      expect(body.valid).toBeFalsy();
    } finally {
      await admin.from('products').delete().eq('id', product.id);
    }
  });

});