import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Enforce single worker for database consistency
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Sale Quantity Limit', () => {
  let testProductId: string;
  let testProductSlug: string;

  test.beforeAll(async () => {
    // Create a test product with sale price and quantity limit
    testProductSlug = `sale-qty-limit-test-${Date.now()}`;
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Sale Quantity Limit Test',
        slug: testProductSlug,
        price: 100,
        sale_price: 60,
        sale_price_until: null,
        sale_quantity_limit: 5, // Only 5 units at sale price
        sale_quantity_sold: 0,
        currency: 'USD',
        description: 'Product for sale quantity limit testing',
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;
    testProductId = product.id;
  });

  test.afterAll(async () => {
    // Cleanup
    if (testProductId) {
      await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', testProductId);
    }
  });

  test('sale should be active when quantity is below limit', async ({ request }) => {
    // Reset state
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 2,
        sale_quantity_limit: 5,
        sale_price: 60
      })
      .eq('id', testProductId);

    // Check via API - sale should be active
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(true);
  });

  test('sale should be inactive when quantity limit is reached', async ({ request }) => {
    // Set sold = limit
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 5,
        sale_quantity_limit: 5,
        sale_price: 60
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check via API - sale should NOT be active
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(false);
  });

  test('sale should be inactive when quantity exceeds limit', async ({ request }) => {
    // Set sold > limit
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 10,
        sale_quantity_limit: 5,
        sale_price: 60
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check via API - sale should NOT be active
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(false);
  });

  test('sale should work with no quantity limit (null)', async ({ request }) => {
    // Set no quantity limit
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 1000,
        sale_quantity_limit: null,
        sale_price: 60
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check via API - sale should be active (no limit)
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(true);
  });

  test('only time limit set - expired', async ({ request }) => {
    // Set past expiration, no quantity limit
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 0,
        sale_quantity_limit: null, // no quantity limit
        sale_price: 60,
        sale_price_until: pastDate
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check via API - sale should NOT be active (time expired)
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(false);
  });

  test('only time limit set - still active', async ({ request }) => {
    // Set future expiration, no quantity limit
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 1000, // high count but no limit
        sale_quantity_limit: null, // no quantity limit
        sale_price: 60,
        sale_price_until: futureDate
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check via API - sale should be active (time not expired, no qty limit)
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(true);
  });

  test('time limit takes precedence when reached first', async ({ request }) => {
    // Set past expiration but quantity still available
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 0,
        sale_quantity_limit: 100, // plenty available
        sale_price: 60,
        sale_price_until: pastDate
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check via API - sale should NOT be active (time expired)
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(false);
  });

  test('quantity limit takes precedence when reached first', async ({ request }) => {
    // Set future expiration but quantity exhausted
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 10,
        sale_quantity_limit: 10, // exhausted
        sale_price: 60,
        sale_price_until: futureDate
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check via API - sale should NOT be active (quantity exhausted)
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(false);
  });

  test('both limits active - sale is active', async ({ request }) => {
    // Both limits set but not reached
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 3,
        sale_quantity_limit: 10,
        sale_price: 60,
        sale_price_until: futureDate
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Check via API - sale should be active
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.showOmnibus).toBe(true);
  });

  test('increment_sale_quantity_sold function works correctly', async () => {
    // Reset state
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 3,
        sale_quantity_limit: 5,
        sale_price: 60,
        sale_price_until: null
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Call the increment function
    const { data, error } = await supabaseAdmin
      .rpc('increment_sale_quantity_sold', { p_product_id: testProductId });

    expect(error).toBeNull();
    expect(data).toBe(true); // Should return true (incremented)

    // Verify the count increased
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', testProductId)
      .single();

    expect(productError).toBeNull();
    expect(product).not.toBeNull();
    expect(product!.sale_quantity_sold).toBe(4);
  });

  test('increment_sale_quantity_sold does not increment when limit reached', async () => {
    // Set sold = limit
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 5,
        sale_quantity_limit: 5,
        sale_price: 60,
        sale_price_until: null
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Call the increment function
    const { data, error } = await supabaseAdmin
      .rpc('increment_sale_quantity_sold', { p_product_id: testProductId });

    expect(error).toBeNull();
    expect(data).toBe(false); // Should return false (not incremented)

    // Verify the count did NOT increase
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', testProductId)
      .single();

    expect(productError).toBeNull();
    expect(product).not.toBeNull();
    expect(product!.sale_quantity_sold).toBe(5); // Still 5
  });

  test('is_sale_price_active database function works correctly', async () => {
    // Test the database function directly
    // Active sale
    const { data: activeResult, error: activeError } = await supabaseAdmin
      .rpc('is_sale_price_active', {
        p_sale_price: 60,
        p_sale_price_until: null,
        p_sale_quantity_limit: 10,
        p_sale_quantity_sold: 5
      });
    expect(activeError).toBeNull();
    expect(activeResult).toBe(true);

    // Inactive - quantity reached
    const { data: quantityReached, error: qtyError } = await supabaseAdmin
      .rpc('is_sale_price_active', {
        p_sale_price: 60,
        p_sale_price_until: null,
        p_sale_quantity_limit: 5,
        p_sale_quantity_sold: 5
      });
    expect(qtyError).toBeNull();
    expect(quantityReached).toBe(false);

    // Inactive - time expired
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: timeExpired, error: timeError } = await supabaseAdmin
      .rpc('is_sale_price_active', {
        p_sale_price: 60,
        p_sale_price_until: pastDate,
        p_sale_quantity_limit: 10,
        p_sale_quantity_sold: 2
      });
    expect(timeError).toBeNull();
    expect(timeExpired).toBe(false);

    // Inactive - no sale price
    const { data: noSalePrice, error: nspError } = await supabaseAdmin
      .rpc('is_sale_price_active', {
        p_sale_price: null,
        p_sale_price_until: null,
        p_sale_quantity_limit: 10,
        p_sale_quantity_sold: 0
      });
    expect(nspError).toBeNull();
    expect(noSalePrice).toBe(false);

    // Active - no quantity limit
    const { data: noLimit, error: nlError } = await supabaseAdmin
      .rpc('is_sale_price_active', {
        p_sale_price: 60,
        p_sale_price_until: null,
        p_sale_quantity_limit: null,
        p_sale_quantity_sold: 1000
      });
    expect(nlError).toBeNull();
    expect(noLimit).toBe(true);
  });

  test('checkout page shows remaining quantity', async ({ page }) => {
    // Reset state with quantity limit
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 3,
        sale_quantity_limit: 5,
        sale_price: 60,
        sale_price_until: null
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Navigate to checkout page
    await page.goto(`/en/checkout/${testProductSlug}`);
    await page.waitForTimeout(3000); // Wait for page to load

    // Check for remaining quantity display
    const remainingText = page.locator('[data-testid="sale-quantity-remaining"]');
    await expect(remainingText).toBeVisible({ timeout: 10000 });
    await expect(remainingText).toContainText('2'); // 5 - 3 = 2 remaining
  });

  test('checkout page does not show remaining quantity when limit not set', async ({ page }) => {
    // No quantity limit
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 100,
        sale_quantity_limit: null,
        sale_price: 60,
        sale_price_until: null
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Navigate to checkout page
    await page.goto(`/en/checkout/${testProductSlug}`);
    await page.waitForTimeout(3000); // Wait for page to load

    // Remaining quantity should NOT be visible
    const remainingText = page.locator('[data-testid="sale-quantity-remaining"]');
    await expect(remainingText).not.toBeVisible();
  });

  test('checkout page shows regular price when quantity limit exhausted', async ({ page }) => {
    // Exhaust quantity limit
    await supabaseAdmin
      .from('products')
      .update({
        sale_quantity_sold: 5,
        sale_quantity_limit: 5,
        sale_price: 60,
        sale_price_until: null
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Navigate to checkout page
    await page.goto(`/en/checkout/${testProductSlug}`);
    await page.waitForTimeout(3000); // Wait for page to load

    // Should show regular price (100), not sale price (60)
    // Check the main price display (the biggest one)
    const priceDisplay = page.locator('.text-5xl').first();
    await expect(priceDisplay).toContainText('100');

    // Sale price strikethrough should not be visible
    const strikethrough = page.locator('.line-through');
    await expect(strikethrough).not.toBeVisible();
  });
});
