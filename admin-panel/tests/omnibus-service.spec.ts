import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Omnibus Service - Backend Functions', () => {
  // Enforce single worker for database consistency
  test.describe.configure({ mode: 'serial' });
  let testProductId: string;
  let testProductSlug: string;

  test.beforeAll(async () => {
    // Create a test product
    testProductSlug = `omnibus-test-${Date.now()}`;
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Omnibus Test Product',
        slug: testProductSlug,
        price: 100,
        currency: 'USD',
        description: 'Product for Omnibus testing',
        is_active: true,
        omnibus_exempt: false
      })
      .select()
      .single();

    if (error) throw error;
    testProductId = product.id;

    // Wait a moment for trigger to execute
    await new Promise(resolve => setTimeout(resolve, 500));
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

  test('should automatically create price history entry when product is created', async () => {
    const { data, error } = await supabaseAdmin
      .from('product_price_history')
      .select('*')
      .eq('product_id', testProductId)
      .order('effective_from', { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBe(1);
    expect(parseFloat(data![0].price)).toBe(100);
    expect(data![0].currency).toBe('USD');
    expect(data![0].effective_until).toBeNull(); // Current price
  });

  test('should update price history when product price changes', async () => {
    // Update product price
    const { error: updateError } = await supabaseAdmin
      .from('products')
      .update({ price: 80 })
      .eq('id', testProductId);

    expect(updateError).toBeNull();

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check price history
    const { data, error } = await supabaseAdmin
      .from('product_price_history')
      .select('*')
      .eq('product_id', testProductId)
      .order('effective_from', { ascending: false });

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBe(2); // Old + new price

    // Newest entry should have price 80
    expect(parseFloat(data![0].price)).toBe(80);
    expect(data![0].effective_until).toBeNull(); // Current

    // Old entry should have price 100 and be closed
    expect(parseFloat(data![1].price)).toBe(100);
    expect(data![1].effective_until).not.toBeNull(); // Closed
  });

  test('should retrieve lowest price from last 30 days via API', async ({ request }) => {
    // Add another price change to create more history and set sale_price to trigger Omnibus
    await supabaseAdmin
      .from('products')
      .update({
        price: 120, // Higher than previous
        sale_price: 90 // Active sale price to trigger Omnibus display
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Call API endpoint to get lowest price
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);

    expect(response.ok(), `API returned ${response.status()}`).toBeTruthy();

    const data = await response.json();
    expect(data.lowestPrice).toBe(80); // Should be 80, not 120 or 100
    expect(data.currency).toBe('USD');
  });

  test('should return null when Omnibus is globally disabled', async ({ request }) => {
    // Get shop_config id
    const { data: shopConfig } = await supabaseAdmin
      .from('shop_config')
      .select('id')
      .single();

    // Disable Omnibus globally
    const { error: updateError } = await supabaseAdmin
      .from('shop_config')
      .update({ omnibus_enabled: false })
      .eq('id', shopConfig!.id);

    expect(updateError).toBeNull();

    // Wait for database commit
    await new Promise(resolve => setTimeout(resolve, 500));

    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.lowestPrice).toBeNull();

    // Re-enable for other tests
    await supabaseAdmin
      .from('shop_config')
      .update({ omnibus_enabled: true })
      .eq('id', shopConfig!.id);

    await new Promise(resolve => setTimeout(resolve, 500));
  });

  test('should STILL collect price history data when Omnibus is globally disabled', async () => {
    // This ensures data is collected even when display is disabled
    // so admin can enable it later and have historical data

    // Disable Omnibus globally
    const { data: shopConfig } = await supabaseAdmin
      .from('shop_config')
      .select('id')
      .single();

    await supabaseAdmin
      .from('shop_config')
      .update({ omnibus_enabled: false })
      .eq('id', shopConfig!.id);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Count price history entries before
    const { data: beforeHistory } = await supabaseAdmin
      .from('product_price_history')
      .select('*')
      .eq('product_id', testProductId);

    const countBefore = beforeHistory?.length || 0;

    // Change price (this should STILL trigger price_history insert despite Omnibus disabled)
    const newPrice = 99.99;
    await supabaseAdmin
      .from('products')
      .update({ price: newPrice })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify price history was created despite Omnibus being disabled
    const { data: afterHistory } = await supabaseAdmin
      .from('product_price_history')
      .select('*')
      .eq('product_id', testProductId)
      .order('effective_from', { ascending: false });

    expect(afterHistory).toBeTruthy();
    expect(afterHistory!.length).toBe(countBefore + 1);
    expect(parseFloat(afterHistory![0].price)).toBe(newPrice);

    // Re-enable Omnibus for other tests
    await supabaseAdmin
      .from('shop_config')
      .update({ omnibus_enabled: true })
      .eq('id', shopConfig!.id);

    // Restore original price to not affect other tests
    await supabaseAdmin
      .from('products')
      .update({ price: 100 })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  test('should return null when product is exempt from Omnibus', async ({ request }) => {
    // Mark product as exempt
    await supabaseAdmin
      .from('products')
      .update({ omnibus_exempt: true })
      .eq('id', testProductId);

    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.lowestPrice).toBeNull();

    // Remove exemption for other tests
    await supabaseAdmin
      .from('products')
      .update({ omnibus_exempt: false })
      .eq('id', testProductId);
  });

  test('should not include prices older than 30 days', async ({ request }) => {
    // Create a manual price history entry from 31 days ago
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);

    await supabaseAdmin
      .from('product_price_history')
      .insert({
        product_id: testProductId,
        price: 50, // Lower than current lowest (80)
        currency: 'USD',
        effective_from: thirtyOneDaysAgo.toISOString(),
        effective_until: new Date().toISOString() // Already closed
      });

    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    // Should still be 80, not 50 (because 50 is >30 days old)
    expect(data.lowestPrice).toBe(80);
  });

  test('should handle product with no price history gracefully', async ({ request }) => {
    // Create a product without any price history
    const { data: emptyProduct } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Empty History Product',
        slug: `empty-${Date.now()}`,
        price: 100,
        currency: 'USD',
        description: 'Product with no history',
        is_active: true
      })
      .select()
      .single();

    // Manually delete its price history
    await supabaseAdmin
      .from('product_price_history')
      .delete()
      .eq('product_id', emptyProduct!.id);

    const response = await request.get(`/api/products/${emptyProduct!.id}/lowest-price`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.lowestPrice).toBeNull();

    // Cleanup
    await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', emptyProduct!.id);
  });
});
