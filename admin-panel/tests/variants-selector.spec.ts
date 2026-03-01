import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

/**
 * Variant Selector Page Tests (M:N Schema)
 *
 * Tests the public /v/[groupId] page that displays product variants
 * and allows customers to select and proceed to checkout.
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Variant Selector Page', () => {
  let testProducts: any[] = [];
  let variantGroup: any;

  test.beforeAll(async () => {
    // Create test products with different prices and features
    const productConfigs = [
      { name: 'Basic Plan', price: 49, variant_name: 'Basic', description: 'Perfect for beginners', is_active: true, is_featured: true },
      { name: 'Pro Plan', price: 99, variant_name: 'Professional', description: 'For growing businesses', is_active: true, is_featured: false },
      { name: 'Enterprise Plan', price: 299, variant_name: 'Enterprise', description: 'Full-featured solution', is_active: true, is_featured: false },
      { name: 'Legacy Plan', price: 29, variant_name: 'Legacy', description: 'Discontinued', is_active: false, is_featured: false },
    ];

    for (let i = 0; i < productConfigs.length; i++) {
      const config = productConfigs[i];
      const { data: product, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: config.name,
          slug: `variant-selector-${Date.now()}-${i}`,
          price: config.price,
          currency: 'PLN',
          description: config.description,
          is_active: config.is_active,
          icon: '📦',
        })
        .select()
        .single();

      if (error) throw error;
      testProducts.push({ ...product, ...config });
    }

    // Create variant group
    const { data: group, error: groupError } = await supabaseAdmin
      .from('variant_groups')
      .insert({
        name: 'Selector Test Plans',
        slug: `selector-test-${Date.now()}`
      })
      .select()
      .single();

    if (groupError) throw groupError;
    variantGroup = group;

    // Link products to variant group
    for (let i = 0; i < testProducts.length; i++) {
      const product = testProducts[i];
      await supabaseAdmin
        .from('product_variant_groups')
        .insert({
          group_id: variantGroup.id,
          product_id: product.id,
          variant_name: product.variant_name,
          display_order: i,
          is_featured: product.is_featured
        });
    }
  });

  test.afterAll(async () => {
    // Cleanup
    if (variantGroup) {
      await supabaseAdmin.from('variant_groups').delete().eq('id', variantGroup.id);
    }
    for (const product of testProducts) {
      await supabaseAdmin.from('products').delete().eq('id', product.id);
    }
  });

  test.beforeEach(async ({ page }) => {
    await acceptAllCookies(page);
  });

  test('should display variant selector page with all active variants', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Should show page title
    await expect(page.getByRole('heading', { name: /Wybierz opcję|Choose Your Option/i })).toBeVisible();

    // Should display only active variants (3 out of 4)
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Professional' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enterprise' })).toBeVisible();
  });

  test('should display "Most Popular" badge on featured variant', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Featured variant should have the "Most Popular" badge
    const popularBadge = page.locator('span').filter({ hasText: /Najpopularniejsze|Most Popular/i });
    await expect(popularBadge).toBeVisible();
  });

  test('should display prices correctly', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Check that prices are displayed with currency (PLN uses comma or dot as decimal separator)
    await expect(page.getByText(/zł49[.,]00/)).toBeVisible();
    await expect(page.getByText(/zł99[.,]00/)).toBeVisible();
    await expect(page.getByText(/zł299[.,]00/)).toBeVisible();
  });

  test('should display descriptions', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Perfect for beginners')).toBeVisible();
    await expect(page.getByText('For growing businesses')).toBeVisible();
    await expect(page.getByText('Full-featured solution')).toBeVisible();
  });

  test('should NOT display inactive variants', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Legacy plan is inactive, should not be visible
    await expect(page.getByRole('heading', { name: 'Legacy' })).not.toBeVisible();
    await expect(page.getByText('Discontinued')).not.toBeVisible();
  });

  test('should redirect to checkout when clicking a variant', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Click on the Basic variant
    const basicVariant = page.locator('[class*="cursor-pointer"]').filter({ hasText: 'Basic' }).first();
    await basicVariant.click();

    // Should redirect to checkout page
    await page.waitForURL(/\/checkout\//);
    expect(page.url()).toContain('/checkout/');
    expect(page.url()).toContain(testProducts[0].slug);
  });

  test('should show Select button on variants', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    const selectButtons = page.getByRole('button', { name: /Wybierz|Select/i });
    await expect(selectButtons).toHaveCount(3); // Only active variants
  });

  test('should show error page for non-existent group', async ({ page }) => {
    const fakeGroupId = crypto.randomUUID();
    await page.goto(`/pl/v/${fakeGroupId}`);
    await page.waitForLoadState('networkidle');

    // Should show error message
    await expect(page.locator('.text-6xl').filter({ hasText: '😕' })).toBeVisible();
  });

  test('should show secure payment footer', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/Bezpieczna płatność|Secure payment/i)).toBeVisible();
  });

  test('should work in English locale', async ({ page }) => {
    await page.goto(`/en/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Check English translations
    await expect(page.getByText('Choose Your Option')).toBeVisible();
    await expect(page.getByText('Most Popular')).toBeVisible();
  });

  test('should work with slug instead of UUID', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.slug}`);
    await page.waitForLoadState('networkidle');

    // Should show the same content
    await expect(page.getByRole('heading', { name: 'Basic' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Professional' })).toBeVisible();
  });

  test('should have correct styling for featured variant', async ({ page }) => {
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Featured variant should have accent border (sf-accent tokens)
    const basicVariant = page.locator('[class*="cursor-pointer"]').filter({ hasText: 'Basic' }).first();
    await expect(basicVariant).toHaveClass(/border-sf-accent|ring-sf-accent/);
  });

  test('should show loading spinner initially', async ({ page }) => {
    // Block the RPC call to see loading state
    await page.route('**/rest/v1/rpc/get_variant_group**', async route => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.continue();
    });

    await page.goto(`/pl/v/${variantGroup.id}`);

    // Should show loading spinner
    const spinner = page.locator('.animate-spin');
    await expect(spinner).toBeVisible();
  });
});

test.describe('Variant Selector - Edge Cases', () => {
  let singleProduct: any;
  let singleGroup: any;

  test.beforeAll(async () => {
    // Create a single product in a variant group (edge case)
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Single Variant Product',
        slug: `single-variant-${Date.now()}`,
        price: 100,
        currency: 'USD',
        description: 'Only one variant',
        is_active: true,
        icon: '🎁',
      })
      .select()
      .single();

    if (productError) throw productError;
    singleProduct = product;

    const { data: group, error: groupError } = await supabaseAdmin
      .from('variant_groups')
      .insert({
        name: 'Single Variant Group',
        slug: `single-group-${Date.now()}`
      })
      .select()
      .single();

    if (groupError) throw groupError;
    singleGroup = group;

    await supabaseAdmin
      .from('product_variant_groups')
      .insert({
        group_id: singleGroup.id,
        product_id: singleProduct.id,
        variant_name: 'Only Option',
        display_order: 0,
        is_featured: true
      });
  });

  test.afterAll(async () => {
    if (singleGroup) {
      await supabaseAdmin.from('variant_groups').delete().eq('id', singleGroup.id);
    }
    if (singleProduct) {
      await supabaseAdmin.from('products').delete().eq('id', singleProduct.id);
    }
  });

  test('should display single variant correctly', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/en/v/${singleGroup.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Only Option' })).toBeVisible();
    await expect(page.getByText('$100.00')).toBeVisible();
  });
});

test.describe('Variant Selector - All Inactive Variants', () => {
  let inactiveProducts: any[] = [];
  let inactiveGroup: any;

  test.beforeAll(async () => {
    // Create products that are all inactive
    for (let i = 0; i < 2; i++) {
      const { data, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Inactive Product ${i + 1}`,
          slug: `inactive-variant-${Date.now()}-${i}`,
          price: 50,
          currency: 'PLN',
          description: 'Inactive',
          is_active: false,
          icon: '⏸️',
        })
        .select()
        .single();

      if (error) throw error;
      inactiveProducts.push(data);
    }

    const { data: group, error: groupError } = await supabaseAdmin
      .from('variant_groups')
      .insert({
        name: 'All Inactive Group',
        slug: `inactive-group-${Date.now()}`
      })
      .select()
      .single();

    if (groupError) throw groupError;
    inactiveGroup = group;

    for (let i = 0; i < inactiveProducts.length; i++) {
      await supabaseAdmin
        .from('product_variant_groups')
        .insert({
          group_id: inactiveGroup.id,
          product_id: inactiveProducts[i].id,
          variant_name: `Inactive ${i + 1}`,
          display_order: i,
          is_featured: false
        });
    }
  });

  test.afterAll(async () => {
    if (inactiveGroup) {
      await supabaseAdmin.from('variant_groups').delete().eq('id', inactiveGroup.id);
    }
    for (const product of inactiveProducts) {
      await supabaseAdmin.from('products').delete().eq('id', product.id);
    }
  });

  test('should show error when all variants are inactive', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/pl/v/${inactiveGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Should show not found/error since no active variants
    await expect(page.locator('.text-6xl').filter({ hasText: '😕' })).toBeVisible();
  });
});

test.describe('Variant Selector - Locale Handling', () => {
  let testProducts: any[] = [];
  let variantGroup: any;

  test.beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const { data, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Locale Test ${i + 1}`,
          slug: `locale-variant-${Date.now()}-${i}`,
          price: 50 * (i + 1),
          currency: 'EUR',
          description: `Locale test ${i + 1}`,
          is_active: true,
          icon: '🌍',
        })
        .select()
        .single();

      if (error) throw error;
      testProducts.push(data);
    }

    const { data: group, error: groupError } = await supabaseAdmin
      .from('variant_groups')
      .insert({
        name: 'Locale Test Group',
        slug: `locale-group-${Date.now()}`
      })
      .select()
      .single();

    if (groupError) throw groupError;
    variantGroup = group;

    for (let i = 0; i < testProducts.length; i++) {
      await supabaseAdmin
        .from('product_variant_groups')
        .insert({
          group_id: variantGroup.id,
          product_id: testProducts[i].id,
          variant_name: `Option ${i + 1}`,
          display_order: i,
          is_featured: i === 0
        });
    }
  });

  test.afterAll(async () => {
    if (variantGroup) {
      await supabaseAdmin.from('variant_groups').delete().eq('id', variantGroup.id);
    }
    for (const product of testProducts) {
      await supabaseAdmin.from('products').delete().eq('id', product.id);
    }
  });

  test('should work in Polish locale', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Wybierz opcję' })).toBeVisible();
    await expect(page.getByText('Najpopularniejsze')).toBeVisible();
  });

  test('should work in English locale', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/en/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Choose Your Option')).toBeVisible();
    await expect(page.getByText('Most Popular')).toBeVisible();
  });

  test('should preserve Polish locale when selecting variant', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    const variant = page.locator('[class*="cursor-pointer"]').first();
    await variant.click();

    await page.waitForURL(/\/pl\/checkout\//);
    expect(page.url()).toContain('/pl/checkout/');
  });

  test('should redirect to default locale checkout from English', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/en/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    const variant = page.locator('[class*="cursor-pointer"]').first();
    await variant.click();

    // Default locale doesn't include prefix with 'as-needed' strategy
    await page.waitForURL(/\/checkout\//);
    expect(page.url()).toContain('/checkout/');
  });
});
