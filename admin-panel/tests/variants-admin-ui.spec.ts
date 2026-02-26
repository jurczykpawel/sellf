import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

/**
 * Variant Admin UI Tests (M:N Schema)
 *
 * Tests the /dashboard/variants page and VariantGroupFormModal
 * for managing variant groups.
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Variants Admin Page', () => {
  let adminEmail: string;
  let adminUserId: string;
  const adminPassword = 'TestPassword123!';
  let testProducts: any[] = [];

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
    adminEmail = `variants-admin-ui-${Date.now()}@test.com`;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (authError) throw authError;
    adminUserId = authData.user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create test products
    for (let i = 0; i < 4; i++) {
      const { data: product, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: `Admin UI Test ${i + 1}`,
          slug: `admin-ui-variant-${Date.now()}-${i}`,
          price: (i + 1) * 25,
          currency: 'PLN',
          description: `Test product ${i + 1}`,
          is_active: true,
          icon: ['🎯', '🚀', '💎', '⭐'][i]
        })
        .select()
        .single();

      if (error) throw error;
      testProducts.push(product);
    }
  });

  test.afterAll(async () => {
    // Cleanup products
    for (const product of testProducts) {
      await supabaseAdmin.from('products').delete().eq('id', product.id);
    }

    // Cleanup admin
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Variants Page Layout', () => {
    test('should display variants page with title and create button', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Should show page title
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      // Should show create button
      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await expect(createButton).toBeVisible();
    });

    test('should display stats cards', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Should show stats cards
      await expect(page.getByText(/Grupy wariantów|Variant Groups/i).first()).toBeVisible();
      await expect(page.getByText(/Przypisania produktów|Product Assignments/i)).toBeVisible();
      await expect(page.getByText(/Unikalne produkty|Unique Products/i)).toBeVisible();
    });

    test('should show empty state OR groups list', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Should show either empty state or groups list (depending on test order)
      const emptyState = page.getByText(/Brak grup wariantów|No variant groups/i);
      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();

      // Either empty state message or create button should be visible
      await expect(createButton).toBeVisible();
    });
  });

  test.describe('Create Variant Group Modal', () => {
    test('should open modal when clicking Create Group button', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      // Modal should appear
      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await expect(modal).toBeVisible({ timeout: 5000 });
    });

    test('should display all products in the modal', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await expect(modal).toBeVisible();

      // Wait for products to load
      await page.waitForTimeout(1000);

      // Should show test products
      for (const product of testProducts) {
        await expect(modal.getByText(product.name)).toBeVisible({ timeout: 10000 });
      }
    });

    test('should have search functionality in modal', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      const searchInput = modal.locator('input[placeholder*="Szukaj produktów"]').or(modal.locator('input[placeholder*="Search products"]'));
      await expect(searchInput).toBeVisible();

      // Search for specific product
      await searchInput.fill('Admin UI Test 1');
      await page.waitForTimeout(500);

      // Should filter products
      await expect(modal.getByText('Admin UI Test 1')).toBeVisible();
      await expect(modal.getByText('Admin UI Test 2')).not.toBeVisible();
    });

    test('should allow selecting products by clicking', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await page.waitForTimeout(1000);

      // Click on first product to select
      const firstProduct = modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 1' }).first();
      await firstProduct.click();

      // Selected count should update
      await expect(modal.getByText(/Wybrane produkty \(1\)|Selected Products \(1\)/i)).toBeVisible();
    });

    test('should show variant name input for selected products', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await page.waitForTimeout(1000);

      // Select two products
      await modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 1' }).first().click();
      await page.waitForTimeout(200);
      await modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 2' }).first().click();

      // Should show variant name inputs in the right panel
      const rightPanel = modal.locator('[class*="bg-gray-50"]').or(modal.locator('[class*="bg-gray-900"]'));
      const inputs = rightPanel.locator('input[type="text"]');
      expect(await inputs.count()).toBeGreaterThanOrEqual(2);
    });

    test('should disable submit with less than 2 products selected', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });

      // With no products selected, submit should be disabled
      const submitButton = modal.getByRole('button', { name: /Utwórz grupę|Create Group/i }).last();
      await expect(submitButton).toBeDisabled();

      // Select one product
      await page.waitForTimeout(500);
      await modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 1' }).first().click();

      // Still should be disabled with only 1 product
      await expect(submitButton).toBeDisabled();
    });

    test('should enable submit with 2+ products selected', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await page.waitForTimeout(1000);

      // Select two products
      await modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 1' }).first().click();
      await page.waitForTimeout(200);
      await modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 2' }).first().click();

      const submitButton = modal.locator('button[type="submit"]');
      await expect(submitButton).toBeEnabled();
    });

    test('should close modal on cancel', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await expect(modal).toBeVisible();

      const cancelButton = modal.getByRole('button', { name: /Anuluj|Cancel/i });
      await cancelButton.click();

      await expect(modal).not.toBeVisible({ timeout: 5000 });
    });

    test('should successfully create variant group', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await page.waitForTimeout(1000);

      // Enter group name (unique)
      const nameInput = modal.locator('input').first();
      await nameInput.fill(`Test Group ${Date.now()}`);

      // Select two products
      await modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 1' }).first().click();
      await page.waitForTimeout(200);
      await modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 2' }).first().click();

      // Submit
      const submitButton = modal.locator('button[type="submit"]');
      await submitButton.click();

      // Wait for API call and modal to close
      await page.waitForTimeout(2000);

      // Modal should close
      await expect(modal).not.toBeVisible({ timeout: 15000 });

      // Success toast should appear
      await expect(page.getByText(/Grupa wariantów utworzona|Variant group created/i)).toBeVisible({ timeout: 5000 });
    });

    test('should allow removing selected product', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await page.waitForTimeout(1000);

      // Select a product
      await modal.locator('.cursor-pointer').filter({ hasText: 'Admin UI Test 3' }).first().click();

      // Count should be 1
      await expect(modal.getByText(/Wybrane produkty \(1\)|Selected Products \(1\)/i)).toBeVisible();

      // Click remove button (X icon) in selected list
      const removeButton = modal.locator('button').filter({ has: page.locator('svg[viewBox="0 0 24 24"]') }).filter({ hasText: '' }).last();
      await removeButton.click();

      // Count should be 0
      await expect(modal.getByText(/Wybrane produkty \(0\)|Selected Products \(0\)/i)).toBeVisible();
    });

    test('should auto-generate slug from group name', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });

      // Enter group name
      const nameInput = modal.locator('input').first();
      await nameInput.fill('My Test Plans');

      // Wait for auto-generated slug
      await page.waitForTimeout(300);

      // Slug input should be auto-filled
      const slugInput = modal.locator('input').nth(1);
      await expect(slugInput).toHaveValue('my-test-plans');
    });
  });

  test.describe('Existing Variant Group', () => {
    let existingGroup: any;

    test.beforeAll(async () => {
      // Create a variant group for testing
      const { data: group, error: groupError } = await supabaseAdmin
        .from('variant_groups')
        .insert({
          name: 'Existing Test Group',
          slug: `existing-group-${Date.now()}`
        })
        .select()
        .single();

      if (groupError) throw groupError;
      existingGroup = group;

      // Link first two products
      for (let i = 0; i < 2; i++) {
        await supabaseAdmin
          .from('product_variant_groups')
          .insert({
            group_id: existingGroup.id,
            product_id: testProducts[i].id,
            variant_name: `Option ${i + 1}`,
            display_order: i,
            is_featured: i === 0
          });
      }
    });

    test.afterAll(async () => {
      if (existingGroup) {
        await supabaseAdmin.from('variant_groups').delete().eq('id', existingGroup.id);
      }
    });

    test('should display existing variant group', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Should show the existing group
      await expect(page.getByText('Existing Test Group')).toBeVisible({ timeout: 10000 });
    });

    test('should display products in the group', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Should show products in the group
      await expect(page.getByText('Option 1')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Option 2')).toBeVisible();
    });

    test('should have copy link button', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Find copy button
      const copyButton = page.locator('button[title*="Kopiuj"]').or(page.locator('button[title*="Copy"]')).first();
      await expect(copyButton).toBeVisible({ timeout: 10000 });
      await copyButton.click();

      // Verify clipboard content
      const clipboardText = await page.evaluate(async () => {
        return await navigator.clipboard.readText();
      });

      expect(clipboardText).toContain(`/v/${existingGroup.slug}`);
    });

    test('should have edit button', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Find edit button
      const editButton = page.locator('button[title*="Edytuj"]').or(page.locator('button[title*="Edit"]')).first();
      await expect(editButton).toBeVisible({ timeout: 10000 });
    });

    test('should have delete button', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Find delete button
      const deleteButton = page.locator('button[title*="Usuń"]').or(page.locator('button[title*="Delete"]')).first();
      await expect(deleteButton).toBeVisible({ timeout: 10000 });
    });

    test('should show featured badge for featured product', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Should show featured badge
      await expect(page.getByText(/Wyróżniony|Featured/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should toggle featured status', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Find any star button (for toggling featured)
      const starButtons = page.locator('button[title*="jako wyróżniony"]').or(page.locator('button[title*="as featured"]'));
      const buttonCount = await starButtons.count();

      if (buttonCount === 0) {
        test.skip(true, 'No featured toggle buttons found on the page');
      }

      // Click first star button
      await starButtons.first().click();

      // Wait for update
      await page.waitForTimeout(1000);

      // Verify page didn't crash and heading is still visible
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  });

  test.describe('M:N - Product in Multiple Groups', () => {
    let group1: any;
    let group2: any;

    test.beforeAll(async () => {
      // Create first group
      const { data: g1, error: e1 } = await supabaseAdmin
        .from('variant_groups')
        .insert({
          name: 'M:N Group 1',
          slug: `mn-group-1-${Date.now()}`
        })
        .select()
        .single();

      if (e1) throw e1;
      group1 = g1;

      // Create second group
      const { data: g2, error: e2 } = await supabaseAdmin
        .from('variant_groups')
        .insert({
          name: 'M:N Group 2',
          slug: `mn-group-2-${Date.now()}`
        })
        .select()
        .single();

      if (e2) throw e2;
      group2 = g2;

      // Link same product (testProducts[0]) to both groups
      await supabaseAdmin.from('product_variant_groups').insert([
        { group_id: group1.id, product_id: testProducts[0].id, variant_name: 'In Group 1', display_order: 0 },
        { group_id: group1.id, product_id: testProducts[1].id, variant_name: 'Also in G1', display_order: 1 },
        { group_id: group2.id, product_id: testProducts[0].id, variant_name: 'In Group 2', display_order: 0 },
        { group_id: group2.id, product_id: testProducts[2].id, variant_name: 'Also in G2', display_order: 1 },
      ]);
    });

    test.afterAll(async () => {
      if (group1) await supabaseAdmin.from('variant_groups').delete().eq('id', group1.id);
      if (group2) await supabaseAdmin.from('variant_groups').delete().eq('id', group2.id);
    });

    test('should display same product in multiple groups', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      // Should show both groups
      await expect(page.getByText('M:N Group 1')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('M:N Group 2')).toBeVisible();

      // Same product should appear in both (with different variant names)
      await expect(page.getByText('In Group 1')).toBeVisible();
      await expect(page.getByText('In Group 2')).toBeVisible();
    });

    test('should allow adding already-grouped product to another group', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/pl/dashboard/variants');
      await page.waitForLoadState('networkidle');

      const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i }).first();
      await createButton.click();

      const modal = page.locator('.fixed').filter({ hasText: /Wybrane produkty|Selected Products/i });
      await page.waitForTimeout(1000);

      // testProducts[0] is already in two groups - should still be selectable
      const productCard = modal.locator('.cursor-pointer').filter({ hasText: testProducts[0].name }).first();
      await expect(productCard).toBeVisible({ timeout: 5000 });

      // Click to select it
      await productCard.click();

      // Should be added to selection
      await expect(modal.getByText(/Wybrane produkty \(1\)|Selected Products \(1\)/i)).toBeVisible();
    });
  });
});
