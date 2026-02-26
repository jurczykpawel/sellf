import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

/**
 * PWYW Admin Panel Tests
 *
 * Tests the Pay What You Want configuration in the admin product form:
 * - Toggle PWYW on/off
 * - Minimum price setting
 * - Preset buttons configuration
 * - Saving and loading PWYW settings
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('PWYW Admin Configuration', () => {
  let adminEmail: string;
  let adminUserId: string;
  const adminPassword = 'TestPassword123!';
  let testProduct: any;

  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);

    await page.addInitScript(() => {
      const addStyle = () => {
        if (document.head) {
          const style = document.createElement('style');
          style.innerHTML = '#klaro { display: none !important; }';
          document.head.appendChild(style);
        } else {
          setTimeout(addStyle, 10);
        }
      };
      addStyle();
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Retry logic for ESM import
    let retries = 3;
    while (retries > 0) {
      try {
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
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await page.waitForTimeout(1000);
      }
    }

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    // Create admin user
    adminEmail = `pwyw-admin-${Date.now()}@test.com`;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (authError) throw authError;
    adminUserId = authData.user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PWYW Admin Test Product',
        slug: `pwyw-admin-test-${Date.now()}`,
        price: 50,
        currency: 'PLN',
        description: 'Test product for PWYW admin',
        is_active: true,
        allow_custom_price: false
      })
      .select()
      .single();

    if (productError) throw productError;
    testProduct = product;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test('should display PWYW toggle in product form', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit on the test product
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    // Wait for modal
    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Should show PWYW toggle
    const pwywToggle = modal.locator('#allow_custom_price');
    await expect(pwywToggle).toBeVisible();
  });

  test('should show PWYW settings when toggle is enabled', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Enable PWYW
    const pwywToggle = modal.locator('#allow_custom_price');
    await pwywToggle.check();

    // Should show minimum price input
    await expect(modal.locator('#custom_price_min')).toBeVisible();

    // Should show preset toggle
    await expect(modal.locator('#show_price_presets')).toBeVisible();
  });

  test('should show preset inputs when preset toggle is enabled', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Enable PWYW
    await modal.locator('#allow_custom_price').check();

    // Preset toggle should be checked by default
    const presetToggle = modal.locator('#show_price_presets');
    await expect(presetToggle).toBeChecked();

    // Should show at least 4 number inputs (min price + 3 presets)
    const numberInputs = modal.locator('input[type="number"]');
    const count = await numberInputs.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('should hide preset inputs when preset toggle is disabled', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Enable PWYW
    await modal.locator('#allow_custom_price').check();

    // Disable presets
    const presetToggle = modal.locator('#show_price_presets');
    await presetToggle.uncheck();

    // Preset amount inputs should be hidden
    await expect(modal.getByText(/Kwota 1|Amount 1/i)).not.toBeVisible();
  });

  test('should enforce minimum price of 0 (allow free PWYW)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Enable PWYW
    await modal.locator('#allow_custom_price').check();

    // Try to set minimum below 0 (negative)
    const minPriceInput = modal.locator('#custom_price_min');
    await minPriceInput.fill('-5');
    await minPriceInput.blur();

    // Value should be corrected to at least 0
    const value = await minPriceInput.inputValue();
    expect(parseFloat(value)).toBeGreaterThanOrEqual(0);
  });

  test('should save PWYW settings', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Enable PWYW
    await modal.locator('#allow_custom_price').check();

    // Set minimum price
    const minPriceInput = modal.locator('#custom_price_min');
    await minPriceInput.fill('10');

    // Set presets — target inputs with placeholder="0" and step="1" (preset-specific attributes)
    const presetInputs = modal.locator('input[type="number"][placeholder="0"][step="1"]');
    const allPresets = await presetInputs.all();
    if (allPresets.length >= 3) {
      await allPresets[0].fill('15');
      await allPresets[1].fill('30');
      await allPresets[2].fill('60');
    }

    // Save — wizard uses "Aktualizuj produkt" / "Update product" button
    const saveButton = modal.getByRole('button', { name: /Aktualizuj produkt|Update product/i });
    await saveButton.click();

    // Wait for save
    await page.waitForTimeout(2000);

    // Verify in database
    const { data: updatedProduct } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', testProduct.id)
      .single();

    expect(updatedProduct.allow_custom_price).toBe(true);
    expect(updatedProduct.custom_price_min).toBe(10);
  });

  test('should load saved PWYW settings when editing', async ({ page }) => {
    // First, set PWYW via database
    await supabaseAdmin
      .from('products')
      .update({
        allow_custom_price: true,
        custom_price_min: 7,
        show_price_presets: true,
        custom_price_presets: [10, 20, 40]
      })
      .eq('id', testProduct.id);

    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // PWYW toggle should be checked
    await expect(modal.locator('#allow_custom_price')).toBeChecked();

    // Minimum price should be loaded
    await expect(modal.locator('#custom_price_min')).toHaveValue('7');

    // Presets toggle should be checked
    await expect(modal.locator('#show_price_presets')).toBeChecked();
  });

  test('should switch between fixed price and PWYW mode', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Initially PWYW is enabled (from previous test)
    const pwywToggle = modal.locator('#allow_custom_price');

    // Disable PWYW
    await pwywToggle.uncheck();

    // Should show standard price input
    await expect(modal.locator('#price')).toBeVisible();

    // Should hide PWYW settings
    await expect(modal.locator('#custom_price_min')).not.toBeVisible();

    // Enable PWYW again
    await pwywToggle.check();

    // Should show PWYW settings
    await expect(modal.locator('#custom_price_min')).toBeVisible();

    // Price input stays visible (acts as suggested price in PWYW mode)
    await expect(modal.locator('#price')).toBeVisible();
  });
});

test.describe('PWYW Admin - Create New Product', () => {
  let adminEmail: string;
  let adminUserId: string;
  const adminPassword = 'TestPassword123!';
  let createdProductId: string | null = null;

  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);

    await page.addInitScript(() => {
      const addStyle = () => {
        if (document.head) {
          const style = document.createElement('style');
          style.innerHTML = '#klaro { display: none !important; }';
          document.head.appendChild(style);
        } else {
          setTimeout(addStyle, 10);
        }
      };
      addStyle();
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Retry logic for ESM import
    let retries = 3;
    while (retries > 0) {
      try {
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
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await page.waitForTimeout(1000);
      }
    }

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    adminEmail = `pwyw-create-admin-${Date.now()}@test.com`;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (authError) throw authError;
    adminUserId = authData.user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });
  });

  test.afterAll(async () => {
    if (createdProductId) {
      await supabaseAdmin.from('products').delete().eq('id', createdProductId);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test('should create new product with PWYW enabled', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click add product button — opens wizard (step 1: Essentials)
    const addButton = page.getByRole('button', { name: /Dodaj produkt|Add product/i });
    await addButton.click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill basic info (step 1 — Essentials: BasicInfo + Pricing)
    await modal.locator('input[name="name"]').fill(`New PWYW Product ${Date.now()}`);
    await modal.locator('textarea[name="description"]').fill('New PWYW product description');
    await modal.locator('input[name="price"]').fill('10');

    // Enable PWYW (PricingSection is on step 1)
    await modal.locator('#allow_custom_price').check();
    await page.waitForTimeout(300);

    // Set minimum price
    await modal.locator('#custom_price_min').fill('5');

    // Save — wizard uses a regular button, not form submit
    const createButton = page.getByRole('button', { name: /Utwórz produkt|Create Product/i });
    await createButton.click();

    // Wait for save and wizard to close
    await page.waitForTimeout(3000);

    // Verify product was created with PWYW
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('*')
      .like('name', 'New PWYW Product%')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(products).toHaveLength(1);
    expect(products![0].allow_custom_price).toBe(true);
    expect(products![0].custom_price_min).toBe(5);

    createdProductId = products![0].id;
  });
});

test.describe('PWYW Admin - Info Display', () => {
  let adminEmail: string;
  let adminUserId: string;
  const adminPassword = 'TestPassword123!';
  let testProduct: any;

  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);

    await page.addInitScript(() => {
      const addStyle = () => {
        if (document.head) {
          const style = document.createElement('style');
          style.innerHTML = '#klaro { display: none !important; }';
          document.head.appendChild(style);
        } else {
          setTimeout(addStyle, 10);
        }
      };
      addStyle();
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Retry logic for ESM import
    let retries = 3;
    while (retries > 0) {
      try {
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
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await page.waitForTimeout(1000);
      }
    }

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    adminEmail = `pwyw-info-admin-${Date.now()}@test.com`;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (authError) throw authError;
    adminUserId = authData.user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create test product
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PWYW Info Test',
        slug: `pwyw-info-${Date.now()}`,
        price: 50,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: false
      })
      .select()
      .single();

    if (error) throw error;
    testProduct = data;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test('should show Stripe minimum info when PWYW enabled', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Enable PWYW
    await modal.locator('#allow_custom_price').check();

    // Should show Stripe minimum info (EN: "Stripe min. 0.50", PL: "Stripe min. 0,50")
    await expect(modal.getByText(/Stripe min\.\s*0[,.]50/i)).toBeVisible();
  });

  test('should show PWYW help text', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click edit
    const productRow = page.locator('tr', { hasText: testProduct.name }).first();
    await productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();

    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Should show PWYW help text near the toggle
    // EN: "Allow customer to choose price", PL: "Pozwól klientowi wybrać cenę"
    await expect(modal.getByText(/customer to choose price|klientowi wybrać cenę/i)).toBeVisible();
  });
});
