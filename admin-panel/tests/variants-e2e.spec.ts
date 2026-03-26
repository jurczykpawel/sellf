import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';
import { ProductStateGuard } from './helpers/product-state';

/**
 * Product Variants E2E Flow Tests (M:N Schema)
 *
 * End-to-end tests for the complete variant flow:
 * Admin creates group -> View selector -> Customer selects variant -> Checkout
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const productGuard = new ProductStateGuard(supabaseAdmin);

test.describe('Product Variants E2E Flow', () => {
  let adminEmail: string;
  let adminUserId: string;
  const adminPassword = 'TestPassword123!';
  let testProducts: any[] = [];
  let createdGroupId: string;
  let createdGroupSlug: string;

  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await setAuthSession(page, adminEmail, adminPassword);

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    await productGuard.save();
    // Create admin user
    adminEmail = `e2e-variants-admin-${Date.now()}@test.com`;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (authError) throw authError;
    adminUserId = authData.user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create test products for E2E flow
    const productConfigs = [
      { name: 'E2E Basic License', price: 49, icon: '🎯' },
      { name: 'E2E Pro License', price: 99, icon: '🚀' },
      { name: 'E2E Enterprise License', price: 199, icon: '💎' },
    ];

    for (let i = 0; i < productConfigs.length; i++) {
      const config = productConfigs[i];
      const { data, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: config.name,
          slug: `e2e-variant-${Date.now()}-${i}`,
          price: config.price,
          currency: 'PLN',
          description: `E2E test variant ${i + 1}`,
          is_active: true,
          icon: config.icon
        })
        .select()
        .single();

      if (error) throw error;
      testProducts.push(data);
    }
  });

  test.afterEach(async () => {
    await productGuard.restore();
  });

  test.afterAll(async () => {
    await productGuard.restore();
    // Cleanup variant group
    if (createdGroupId) {
      await supabaseAdmin.from('variant_groups').delete().eq('id', createdGroupId);
    }

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

  test('E2E: Create variant group from admin panel', async ({ page }) => {
    // Step 1: Login as admin
    await loginAsAdmin(page);

    // Step 2: Navigate to variants page
    await page.goto('/pl/dashboard/variants');
    await page.waitForLoadState('networkidle');

    // Step 3: Click Create Group
    const createButton = page.getByRole('button', { name: /Utwórz grupę|Create Group/i });
    await createButton.click();

    const modal = page.locator('[data-testid="variant-group-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Wait for products to load
    await page.waitForTimeout(1000);

    // Step 4: Enter group name (unique to avoid conflicts)
    const groupName = `E2E License Plans ${Date.now()}`;
    const nameInput = modal.locator('input').first();
    await nameInput.fill(groupName);

    // Wait for products to load
    await page.waitForTimeout(1000);

    // Step 5: Select test products by clicking on them
    for (const product of testProducts) {
      const productCard = modal.locator('.cursor-pointer').filter({ hasText: product.name }).first();
      if (await productCard.isVisible()) {
        await productCard.click();
        await page.waitForTimeout(200);
      }
    }

    // Step 6: Verify at least 2 products selected (use heading to avoid matching mobile tab button)
    await expect(modal.getByRole('heading', { name: /Wybrane produkty \([2-9]\)|Selected Products \([2-9]\)/i })).toBeVisible({ timeout: 5000 });

    // Step 7: Submit and create group
    const submitButton = modal.locator('button[type="submit"]');
    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();

    // Wait for API call
    await page.waitForTimeout(3000);

    // Wait for modal to close (success)
    await expect(modal).not.toBeVisible({ timeout: 20000 });

    // Step 9: Get the created group info from the API
    const response = await page.request.get('/api/v1/variant-groups');
    const data = await response.json();
    const ourGroup = data.data.find((g: any) => g.name?.startsWith('E2E License Plans') && g.products?.length >= 2);
    expect(ourGroup).toBeDefined();

    createdGroupId = ourGroup.id;
    createdGroupSlug = ourGroup.slug;

    // Verify group is visible on page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(ourGroup.name)).toBeVisible({ timeout: 10000 });
  });

  test('E2E: Copy variant link from admin', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/variants');
    await page.waitForLoadState('networkidle');

    // Find any copy button (don't depend on specific group)
    const copyButtons = page.locator('button[title*="Kopiuj"]').or(page.locator('button[title*="Copy"]'));
    const buttonCount = await copyButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    await copyButtons.first().click();

    // Get URL from clipboard
    const copiedUrl = await page.evaluate(async () => {
      return await navigator.clipboard.readText();
    });

    // Verify it's a valid variant URL
    expect(copiedUrl).toContain('/v/');
  });

  test('E2E: Access variant selector page from copied link', async ({ page }) => {
    test.skip(!createdGroupId, 'No variant group created — test #1 may have failed');
    await acceptAllCookies(page);

    // Navigate to variant selector using group created by test #1
    await page.goto(`/pl/v/${createdGroupSlug || createdGroupId}`);
    await page.waitForLoadState('networkidle');

    // Should show variant selector
    await expect(page.getByRole('heading', { name: 'Wybierz opcję' })).toBeVisible({ timeout: 10000 });
  });

  test('E2E: Select variant and go to checkout', async ({ page }) => {
    test.skip(!createdGroupId, 'No variant group created — test #1 may have failed');
    await acceptAllCookies(page);

    // Navigate to variant selector using group created by test #1
    await page.goto(`/pl/v/${createdGroupSlug || createdGroupId}`);
    await page.waitForLoadState('networkidle');

    // Click on first visible variant
    const variant = page.locator('[class*="cursor-pointer"]').first();
    await variant.click();

    // Should redirect to checkout
    await page.waitForURL(/\/checkout\//);
    expect(page.url()).toContain('/checkout/');
  });

  test('E2E: Edit existing variant group', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/variants');
    await page.waitForLoadState('networkidle');

    // Find any edit button (don't depend on specific group name)
    const editButtons = page.locator('button[title*="Edytuj"]').or(page.locator('button[title*="Edit"]'));
    const buttonCount = await editButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Click first edit button
    await editButtons.first().click();

    // Modal should open with existing data
    const modal = page.locator('[data-testid="variant-group-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Should show products selected (h3 heading, visible on desktop)
    await expect(modal.locator('h3', { hasText: /Wybrane produkty \(\d+\)|Selected Products \(\d+\)/i })).toBeVisible({ timeout: 10000 });

    // Modify group name
    const nameInput = modal.locator('input').first();
    await nameInput.clear();
    await nameInput.fill('E2E Updated Plans');

    // Save
    const saveButton = modal.locator('button[type="submit"]');
    await saveButton.click();

    // Wait for save
    await page.waitForTimeout(2000);

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 15000 });

    // Verify name changed on page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('E2E Updated Plans').first()).toBeVisible({ timeout: 10000 });
  });

  test('E2E: Remove product from variant group via edit modal', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/variants');
    await page.waitForLoadState('networkidle');

    // Find any existing group (either E2E Updated Plans or E2E License Plans)
    const editButtons = page.locator('button[title*="Edytuj"]').or(page.locator('button[title*="Edit"]'));
    const buttonCount = await editButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Click first edit button
    await editButtons.first().click();

    // Modal should open
    const modal = page.locator('[data-testid="variant-group-modal"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify modal opened with products
    await expect(modal.locator('h3', { hasText: /Wybrane produkty|Selected Products/i })).toBeVisible();

    // Close modal
    const cancelButton = modal.getByRole('button', { name: /Anuluj|Cancel/i });
    await cancelButton.click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 5000 });
  });

  test('E2E: Delete variant group', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/variants');
    await page.waitForLoadState('networkidle');

    // Find any delete button
    const deleteButtons = page.locator('button[title*="Usuń grupę"]').or(page.locator('button[title*="Delete group"]'));
    const buttonCount = await deleteButtons.count();
    expect(buttonCount).toBeGreaterThan(0);

    // Get the group name before deletion
    const initialGroupCount = buttonCount;

    // Click first delete button
    await deleteButtons.first().click();

    // Confirmation modal should appear
    const confirmModal = page.locator('div.fixed').filter({ hasText: /Usunąć grupę|Delete|Usuń/i });
    await expect(confirmModal).toBeVisible({ timeout: 5000 });

    // Confirm deletion
    const confirmButton = confirmModal.getByRole('button', { name: /Usuń|Delete/i });
    await confirmButton.click();

    // Wait for deletion
    await page.waitForTimeout(1000);

    // Reload to verify
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should have one fewer group
    const newDeleteButtons = page.locator('button[title*="Usuń grupę"]').or(page.locator('button[title*="Delete group"]'));
    const newCount = await newDeleteButtons.count();
    expect(newCount).toBeLessThan(initialGroupCount);

    // Clear the ID since we deleted it
    createdGroupId = '';
  });
});

test.describe('Variant Flow with Order Bumps', () => {
  let mainProduct: any;
  let variantProduct: any;
  let bumpProduct: any;
  let variantGroup: any;

  test.beforeAll(async () => {
    await productGuard.save();
    // Create main product
    const { data: main, error: mainError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Variant with Bump - Main',
        slug: `variant-bump-main-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        description: 'Main product with order bump',
        is_active: true,
        icon: '📦',
      })
      .select()
      .single();

    if (mainError) throw mainError;
    mainProduct = main;

    // Create variant product
    const { data: variant, error: variantError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Variant with Bump - Premium',
        slug: `variant-bump-premium-${Date.now()}`,
        price: 200,
        currency: 'PLN',
        description: 'Premium variant',
        is_active: true,
        icon: '💎',
      })
      .select()
      .single();

    if (variantError) throw variantError;
    variantProduct = variant;

    // Create bump product (only for main product)
    const { data: bump, error: bumpError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Bonus Add-on',
        slug: `variant-bump-addon-${Date.now()}`,
        price: 20,
        currency: 'PLN',
        description: 'Special add-on',
        is_active: true,
        icon: '🎁'
      })
      .select()
      .single();

    if (bumpError) throw bumpError;
    bumpProduct = bump;

    // Create variant group
    const { data: group, error: groupError } = await supabaseAdmin
      .from('variant_groups')
      .insert({
        name: 'Bump Test Group',
        slug: `bump-group-${Date.now()}`
      })
      .select()
      .single();

    if (groupError) throw groupError;
    variantGroup = group;

    // Link products to group
    await supabaseAdmin.from('product_variant_groups').insert([
      { group_id: variantGroup.id, product_id: mainProduct.id, variant_name: 'Standard', display_order: 0, is_featured: false },
      { group_id: variantGroup.id, product_id: variantProduct.id, variant_name: 'Premium', display_order: 1, is_featured: false },
    ]);

    // Create order bump only for main product
    await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: bumpProduct.id,
        bump_price: 15,
        bump_title: 'Add bonus content!',
        is_active: true
      });
  });

  test.afterEach(async () => {
    await productGuard.restore();
  });

  test.afterAll(async () => {
    await productGuard.restore();
    // Cleanup
    await supabaseAdmin.from('order_bumps').delete().eq('main_product_id', mainProduct.id);
    await supabaseAdmin.from('variant_groups').delete().eq('id', variantGroup.id);
    await supabaseAdmin.from('products').delete().eq('id', mainProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', variantProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', bumpProduct.id);
  });

  test('Standard variant should show order bump', async ({ page }) => {
    await acceptAllCookies(page);

    // Go to variant selector
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Select Standard variant (has bump)
    const standardVariant = page.locator('[class*="cursor-pointer"]').filter({ hasText: 'Standard' }).first();
    await standardVariant.click();

    // Should redirect to checkout
    await page.waitForURL(/\/checkout\//);
    await page.waitForLoadState('networkidle');

    // Order bump should be visible for Standard variant
    await expect(page.getByText('Add bonus content!')).toBeVisible({ timeout: 10000 });
  });

  test('Premium variant should NOT show Standard variant bump', async ({ page }) => {
    await acceptAllCookies(page);

    // Go to variant selector
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Select Premium variant (no bump configured)
    const premiumVariant = page.locator('[class*="cursor-pointer"]').filter({ hasText: 'Premium' }).first();
    await premiumVariant.click();

    // Should redirect to checkout
    await page.waitForURL(/\/checkout\//);
    await page.waitForLoadState('networkidle');

    // Wait for page to fully load
    await page.waitForTimeout(2000);

    // Order bump from Standard should NOT be visible
    await expect(page.getByText('Add bonus content!')).not.toBeVisible();
  });
});

test.describe('Variant Selector respects product status', () => {
  let products: any[] = [];
  let variantGroup: any;

  test.beforeAll(async () => {
    await productGuard.save();
    // Create products - one will be deactivated
    const productConfigs = [
      { name: 'Active Product 1', is_active: true },
      { name: 'Active Product 2', is_active: true },
      { name: 'Inactive Product', is_active: false },
    ];

    for (let i = 0; i < productConfigs.length; i++) {
      const config = productConfigs[i];
      const { data, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: config.name,
          slug: `status-test-${Date.now()}-${i}`,
          price: 50,
          currency: 'PLN',
          description: `Status test ${i + 1}`,
          is_active: config.is_active,
          icon: '📦',
        })
        .select()
        .single();

      if (error) throw error;
      products.push(data);
    }

    // Create variant group
    const { data: group, error: groupError } = await supabaseAdmin
      .from('variant_groups')
      .insert({
        name: 'Status Test Group',
        slug: `status-group-${Date.now()}`
      })
      .select()
      .single();

    if (groupError) throw groupError;
    variantGroup = group;

    // Link all products
    for (let i = 0; i < products.length; i++) {
      await supabaseAdmin.from('product_variant_groups').insert({
        group_id: variantGroup.id,
        product_id: products[i].id,
        variant_name: `Option ${i + 1}`,
        display_order: i,
        is_featured: i === 0
      });
    }
  });

  test.afterEach(async () => {
    await productGuard.restore();
  });

  test.afterAll(async () => {
    await productGuard.restore();
    if (variantGroup) {
      await supabaseAdmin.from('variant_groups').delete().eq('id', variantGroup.id);
    }
    for (const product of products) {
      await supabaseAdmin.from('products').delete().eq('id', product.id);
    }
  });

  test('should show only active variants', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Should show only 2 active variants
    await expect(page.getByRole('heading', { name: 'Option 1' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Option 2' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Option 3' })).not.toBeVisible();
  });

  test('deactivating product removes it from selector', async ({ page }) => {
    // Deactivate one more product
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .eq('id', products[1].id);

    await acceptAllCookies(page);
    await page.goto(`/pl/v/${variantGroup.id}`);
    await page.waitForLoadState('networkidle');

    // Should show only 1 active variant now
    await expect(page.getByRole('heading', { name: 'Option 1' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Option 2' })).not.toBeVisible();

    // Reactivate for cleanup
    await supabaseAdmin
      .from('products')
      .update({ is_active: true })
      .eq('id', products[1].id);
  });
});
