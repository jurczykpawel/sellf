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

test.describe('Sale Price & Enhanced Omnibus', () => {
  let testProductId: string;
  let testProductSlug: string;

  test.beforeAll(async () => {
    // Enable Omnibus globally
    const { data: shopConfig } = await supabaseAdmin
      .from('shop_config')
      .select('id')
      .single();

    await supabaseAdmin
      .from('shop_config')
      .update({ omnibus_enabled: true })
      .eq('id', shopConfig!.id);

    // Create a test product with sale price
    testProductSlug = `sale-price-test-${Date.now()}`;
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Sale Price Test Product',
        slug: testProductSlug,
        price: 100,
        sale_price: 60,
        sale_price_until: null, // Indefinite sale
        currency: 'USD',
        description: 'Product for sale price testing',
        is_active: true,
        omnibus_exempt: false
      })
      .select()
      .single();

    if (error) throw error;
    testProductId = product.id;

    // Wait for trigger to execute
    await new Promise(resolve => setTimeout(resolve, 1000));
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

  test('should track sale_price in price history', async () => {
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
    expect(parseFloat(data![0].sale_price)).toBe(60);
    expect(data![0].currency).toBe('USD');
  });

  test('should update price history when sale_price changes', async () => {
    // Update sale price
    const { error: updateError } = await supabaseAdmin
      .from('products')
      .update({ sale_price: 50 })
      .eq('id', testProductId);

    expect(updateError).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check price history
    const { data, error } = await supabaseAdmin
      .from('product_price_history')
      .select('*')
      .eq('product_id', testProductId)
      .order('effective_from', { ascending: false });

    expect(error).toBeNull();
    expect(data!.length).toBe(2);

    // Newest entry should have sale_price 50
    expect(parseFloat(data![0].sale_price)).toBe(50);
    expect(data![0].effective_until).toBeNull();

    // Old entry should be closed
    expect(parseFloat(data![1].sale_price)).toBe(60);
    expect(data![1].effective_until).not.toBeNull();
  });

  test('should show Omnibus ONLY when sale_price is active', async ({ request }) => {
    // Set sale price
    await supabaseAdmin
      .from('products')
      .update({ sale_price: 70 })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Should show Omnibus
    let response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    let data = await response.json();
    expect(data.showOmnibus).toBe(true);
    expect(typeof data.lowestPrice).toBe('number');
    expect(data.lowestPrice).toBeGreaterThan(0);
    expect(data.lowestPrice).toBeLessThanOrEqual(70);

    // Remove sale price
    await supabaseAdmin
      .from('products')
      .update({ sale_price: null })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Should NOT show Omnibus
    response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();
    data = await response.json();
    expect(data.showOmnibus).toBe(false);
    expect(data.lowestPrice).toBeNull();
  });

  test('should calculate lowest price from last 30 days (including sale_price)', async ({ request }) => {
    // Create price history: 100 -> 90 -> sale:60 -> sale:50
    await supabaseAdmin
      .from('products')
      .update({ price: 90, sale_price: null })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 1000));

    await supabaseAdmin
      .from('products')
      .update({ sale_price: 60 })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 1000));

    await supabaseAdmin
      .from('products')
      .update({ sale_price: 50 })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Lowest should be 50 (from sale_price)
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.lowestPrice).toBe(50);
  });

  test('should handle sale_price expiration correctly', async ({ request }) => {
    // Set sale price with expiration in the past
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Yesterday
    await supabaseAdmin
      .from('products')
      .update({
        sale_price: 55,
        sale_price_until: pastDate
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Omnibus should NOT show (expired sale)
    const response = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.showOmnibus).toBe(false);

    // Set sale price with future expiration
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Tomorrow
    await supabaseAdmin
      .from('products')
      .update({
        sale_price: 65,
        sale_price_until: futureDate
      })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Omnibus SHOULD show (active sale)
    const response2 = await request.get(`/api/products/${testProductId}/lowest-price`);
    expect(response2.ok()).toBeTruthy();

    const data2 = await response2.json();
    expect(data2.showOmnibus).toBe(true);
    expect(typeof data2.lowestPrice).toBe('number');
    expect(data2.lowestPrice).toBeGreaterThan(0);
    expect(data2.lowestPrice).toBeLessThanOrEqual(65);
  });

  test('should auto-cleanup price history older than 30 days', async () => {
    // Create an old price history entry manually (31 days ago)
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabaseAdmin
      .from('product_price_history')
      .insert({
        product_id: testProductId,
        price: 200,
        sale_price: null,
        currency: 'USD',
        effective_from: thirtyOneDaysAgo,
        effective_until: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      });

    expect(insertError).toBeNull();

    // Trigger cleanup by inserting a new price change
    await supabaseAdmin
      .from('products')
      .update({ price: 95 })
      .eq('id', testProductId);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check that old entry was deleted
    const { data, error } = await supabaseAdmin
      .from('product_price_history')
      .select('*')
      .eq('product_id', testProductId)
      .lt('effective_from', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    expect(error).toBeNull();
    // Should be empty (old entries cleaned up)
    expect(data!.length).toBe(0);
  });
});
