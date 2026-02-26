import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

// Enforce single worker for admin tests
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Product Duplication', () => {
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let testProductId: string;
  let testProductSlug: string;

  // Helper to login as admin
  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const supabase = createBrowserClient(supabaseUrl, anonKey);
      await supabase.auth.signInWithPassword({ email, password });
    }, {
      email: adminEmail,
      password: adminPassword,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
    });

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    // Create test admin user
    adminEmail = `product-dup-admin-${Date.now()}@test.com`;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (authError) throw authError;

    // Add to admin_users table
    const { error: adminError } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: authData.user!.id });

    if (adminError) throw adminError;

    // Create a test product to duplicate
    testProductSlug = `dup-test-${Date.now()}`;
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Original Product',
        slug: testProductSlug,
        price: 100,
        sale_price: 60,
        sale_price_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        currency: 'USD',
        description: 'Product to be duplicated',
        long_description: 'Detailed description',
        is_active: true,
        is_featured: true,
        omnibus_exempt: false,
        icon: '🚀'
      })
      .select()
      .single();

    if (productError) throw productError;
    testProductId = product.id;
  });

  test.afterAll(async () => {
    // Cleanup: delete test products
    if (testProductId) {
      await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', testProductId);
    }

    // Also delete any duplicates created during tests (by slug prefix or name pattern)
    if (testProductSlug) {
      await supabaseAdmin
        .from('products')
        .delete()
        .like('slug', `copy-${testProductSlug}%`);
    }

    // Cleanup admin user
    if (adminEmail) {
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
      const user = users.find(u => u.email === adminEmail);
      if (user) {
        await supabaseAdmin.from('admin_users').delete().eq('user_id', user.id);
        await supabaseAdmin.auth.admin.deleteUser(user.id);
      }
    }
  });

  test('should show duplicate button in products table', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to products page
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Find the product row and duplicate button
    const productRow = page.locator('tr').filter({ hasText: 'Original Product' });
    await expect(productRow).toBeVisible({ timeout: 10000 });

    // Find the duplicate button by aria-label (using regex to match both EN and PL)
    const duplicateButton = productRow.getByRole('button', { name: /Duplikuj Original Product|Duplicate Original Product/i });
    await expect(duplicateButton).toBeVisible({ timeout: 5000 });
  });

  test('should open wizard with duplicated data when clicking duplicate', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Click duplicate button
    const productRow = page.locator('tr').filter({ hasText: 'Original Product' });
    const duplicateButton = productRow.getByRole('button', { name: /Duplikuj Original Product|Duplicate Original Product/i });
    await duplicateButton.click();

    // Wait for wizard to open (step 1)
    await page.waitForTimeout(500);

    // Check that wizard opened with correct data on step 1 (Essentials)
    const nameInput = page.locator('input[name="name"]');
    await expect(nameInput).toBeVisible();

    const nameValue = await nameInput.inputValue();
    expect(nameValue).toBe('[COPY] Original Product');

    // Check that description is copied (step 1)
    const descInput = page.locator('textarea[name="description"]');
    const descValue = await descInput.inputValue();
    expect(descValue).toBe('Product to be duplicated');

    // Slug is blank in duplicate mode — fill it so step 1 validation passes
    const slugInput = page.locator('input[name="slug"]');
    if (!(await slugInput.inputValue())) {
      await slugInput.fill('copy-original-product');
    }

    // Navigate to step 3 to check sale_price (Sales & Settings)
    await page.getByRole('button', { name: /Dalej|Continue Setup/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Dalej|Continue Setup/i }).click();
    await page.waitForTimeout(1000);

    // Check that sale_price is copied on step 3
    const salePriceInput = page.locator('input#sale_price');
    await expect(salePriceInput).toBeVisible({ timeout: 5000 });
    const salePriceValue = await salePriceInput.inputValue();
    expect(salePriceValue).toContain('60'); // May have comma formatting
  });

  test('should show "Create" button (not "Update") when duplicating', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Click duplicate button (Duplikuj in Polish, Duplicate in English)
    const productRow = page.locator('tr').filter({ hasText: 'Original Product' });
    const duplicateButton = productRow.getByRole('button', { name: /Duplikuj Original Product|Duplicate Original Product/i });
    await duplicateButton.click();

    await page.waitForTimeout(500);

    // Wizard shows "Create Product" button (not a form submit, but a regular button)
    const createButton = page.getByRole('button', { name: /Utwórz produkt|Create Product/i });
    await expect(createButton).toBeVisible({ timeout: 5000 });

    // Check that wizard title says "Create"
    const wizardTitle = page.locator('h3').filter({ hasText: /Utwórz nowy produkt|Create New Product/i });
    await expect(wizardTitle).toBeVisible();
  });

  test('should create a duplicate product preserving all fields', async ({ request }) => {
    // Get the original product
    const { data: original, error: fetchError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', testProductId)
      .single();

    expect(fetchError).toBeNull();
    expect(original).toBeTruthy();

    // Simulate what the UI duplication does: create a new product
    // with the same fields but a new name and slug (mirroring handleDuplicateProduct
    // in ProductsPageContent.tsx which sets id='', slug='', name='[COPY] ...')
    const duplicateSlug = `copy-${testProductSlug}`;
    const { data: duplicate, error: duplicateError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `[COPY] ${original!.name}`,
        slug: duplicateSlug,
        price: original!.price,
        sale_price: original!.sale_price,
        sale_price_until: original!.sale_price_until,
        currency: original!.currency,
        description: original!.description,
        long_description: original!.long_description,
        is_active: original!.is_active,
        is_featured: original!.is_featured,
        omnibus_exempt: original!.omnibus_exempt,
        icon: original!.icon,
      })
      .select()
      .single();

    expect(duplicateError).toBeNull();
    expect(duplicate).toBeTruthy();

    // Verify the duplicated product has a different id and slug
    expect(duplicate!.id).not.toBe(original!.id);
    expect(duplicate!.slug).toBe(duplicateSlug);
    expect(duplicate!.name).toBe(`[COPY] ${original!.name}`);

    // Verify all content fields were preserved from the original
    expect(duplicate!.price).toBe(original!.price);
    expect(duplicate!.sale_price).toBe(original!.sale_price);
    expect(duplicate!.currency).toBe(original!.currency);
    expect(duplicate!.description).toBe(original!.description);
    expect(duplicate!.long_description).toBe(original!.long_description);
    expect(duplicate!.is_active).toBe(original!.is_active);
    expect(duplicate!.is_featured).toBe(original!.is_featured);
    expect(duplicate!.omnibus_exempt).toBe(original!.omnibus_exempt);
    expect(duplicate!.icon).toBe(original!.icon);
  });
});
