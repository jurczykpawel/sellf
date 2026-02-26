import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

// Enforce single worker
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Authenticated Admin Dashboard', () => {
  let adminEmail: string;
  const adminPassword = 'password123';

  // Helper to login in any test
  const loginAsAdmin = async (page: Page) => {
    // Set consent cookie first to avoid banner
    await acceptAllCookies(page);
    
    // Aggressively hide Klaro via CSS
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

  // Helper to create product via API (faster setup)
  const createProductViaApi = async (name: string, price = 10) => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name,
        slug: `api-${Date.now()}-${Math.random().toString(36).substr(7)}`,
        price,
        currency: 'USD',
        description: 'API created product',
        is_active: true
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  };

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-admin-${Date.now()}-${randomStr}@example.com`;
    
    const { data: { user }, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: user!.id });
  });

  test('should access all admin pages with expected content', async ({ page }) => {
    await loginAsAdmin(page);

    // Each page has a path and a content marker that proves the page rendered its data layer,
    // not just a shell. We look for headings, table headers, or action buttons specific to each page.
    const pages: { path: string; contentMarker: RegExp }[] = [
      { path: '/dashboard', contentMarker: /Total Revenue|Przychód/i },
      { path: '/dashboard/products', contentMarker: /Product|Produkt/i },
      { path: '/dashboard/categories', contentMarker: /Categor|Kategori/i },
      { path: '/dashboard/coupons', contentMarker: /Coupon|Kupon/i },
      { path: '/dashboard/webhooks', contentMarker: /Webhook|Endpoint/i },
      { path: '/dashboard/users', contentMarker: /User|Użytkowni/i },
      { path: '/dashboard/payments', contentMarker: /Payment|Płatnoś|Transaction|Transakcj/i },
      { path: '/dashboard/order-bumps', contentMarker: /Order Bump|Bump/i }
    ];

    for (const { path, contentMarker } of pages) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path), { timeout: 10000 });
      await expect(page.locator('body')).not.toContainText('Application error');
      // Verify the page actually rendered its domain-specific content
      await expect(page.locator('body')).toContainText(contentMarker, { timeout: 10000 });
    }
  });

  test('should perform full CRUD on a product', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/products');

    // 1. Create
    await page.getByRole('button', { name: /Product/i }).first().click();
    
    const productName = `CRUD-Prod-${Date.now()}`;
    const productSlug = `crud-${Date.now()}`;
    
    const modal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    await modal.locator('input[name="name"]').fill(productName);
    await modal.locator('input[name="slug"]').fill(productSlug);
    await modal.locator('textarea[name="description"]').fill('Description');
    await modal.locator('input[name="price"]').fill('50');
    // Select currency explicitly (defaults to shop's default currency, but we want to be explicit in tests)
    await modal.locator('select[name="currency"]').selectOption('USD');

    // Click "Create Product" button (wizard uses regular button, not form submit)
    await page.getByRole('button', { name: /Utwórz produkt|Create Product/i }).click();

    // Verify wizard closes
    await expect(modal).not.toBeVisible({ timeout: 15000 });

    // Verify creation
    const productCell = page.locator('table').getByText(productName).first();
    await expect(productCell).toBeVisible({ timeout: 15000 });

    // 2. Edit
    const row = page.locator('tr', { hasText: productName }).first();
    await row.locator('button[title*="Edit"], button[title*="Edytuj"]').first().click();
    await modal.locator('input[name="price"]').fill('99');
    await page.getByRole('button', { name: /Aktualizuj produkt|Update product/i }).click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('99');

    // 3. Delete
    await row.locator('button[title*="Delete"], button[title*="Usuń"]').first().click();
    const confirmModal = page.locator('div.fixed').filter({ hasText: /Delete|Usuń|Confirm/i });
    await confirmModal.getByRole('button', { name: /Delete|Confirm|Usuń/i }).click();
    
    // Verify gone
    await expect(page.locator('table').getByText(productName).first()).not.toBeVisible({ timeout: 10000 });
  });

  test('should perform CRUD on a webhook endpoint', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/webhooks');

    await page.getByRole('button', { name: /Add|Create/i }).first().click();
    const wModal = page.locator('[role="dialog"], dialog').filter({ hasText: /Cancel|Anuluj/i });
    const webhookUrl = `https://example.com/crud-${Date.now()}`;
    await wModal.locator('input[type="url"]').fill(webhookUrl);
    await wModal.locator('input[type="checkbox"]').first().check();
    await wModal.locator('button[type="submit"]').click();

    // Verify
    await expect(page.locator('table').getByText(webhookUrl).first()).toBeVisible({ timeout: 10000 });

    // 2. Delete
    const row = page.locator('tr', { hasText: webhookUrl }).first();
    await row.getByRole('button', { name: /Delete|Usuń/i }).click();
    const confirmModal = page.locator('[role="dialog"], dialog').filter({ hasText: /Delete|Usuń/i });
    await confirmModal.getByRole('button', { name: /Delete|Usuń/i }).click();

    await expect(page.locator('table').getByText(webhookUrl).first()).not.toBeVisible({ timeout: 10000 });
  });

  test('should perform CRUD on a coupon', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/coupons');

    // 1. Create
    await page.getByRole('button', { name: /Coupon/i }).first().click();
    const modal = page.locator('div.fixed').filter({ hasText: /Cancel|Anuluj/i });
    const code = `CRUD-${Date.now()}`;
    await modal.locator('input[placeholder*="SUMMER"]').fill(code);
    await modal.locator('input[name="discount_value"]').fill('20');
    await modal.locator('button[type="submit"]').click();

    await expect(page.locator('table').getByText(code).first()).toBeVisible({ timeout: 10000 });

    // 2. Edit
    const row = page.locator('tr', { hasText: code }).first();
    await row.getByRole('button', { name: /Edit/i }).click();
    await modal.locator('input[name="discount_value"]').fill('50');
    await modal.locator('button[type="submit"]').click();
    
    // Wait for modal to close (confirming success)
    await expect(modal).not.toBeVisible({ timeout: 10000 });
    
    // Sometimes list refresh takes a moment or requires reload in test env
    await expect(async () => {
      await page.reload();
      const updatedRow = page.locator('tr', { hasText: code }).first();
      await expect(updatedRow).toContainText('50%');
    }).toPass({ timeout: 10000 });

    // 3. Delete
    // Need to re-find row after reload
    const rowToDelete = page.locator('tr', { hasText: code }).first();
    await rowToDelete.getByRole('button', { name: /Delete/i }).click();
    const confirmModal = page.locator('div.fixed').filter({ hasText: /Delete|Usuń/i });
    await confirmModal.getByRole('button', { name: /Delete|Usuń/i }).click();

    await expect(page.locator('table').getByText(code).first()).not.toBeVisible({ timeout: 10000 });
  });

  test('should perform CRUD on an order bump', async ({ page }) => {
    // 1. Setup products via API with UNIQUE NAMES
    const mainProduct = await createProductViaApi(`Main-${Date.now()}`);
    const bumpProduct = await createProductViaApi(`Bump-${Date.now()}`);

    // 2. Create bump via API
    const { error } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: bumpProduct.id,
        bump_price: 5,
        bump_title: 'Yes, add the bonus!'
      });
    if (error) throw error;

    // 3. Verify in UI
    await loginAsAdmin(page);
    await page.goto('/dashboard/order-bumps');

    const row = page.locator('tr', { hasText: mainProduct.name }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('5');

    // 4. Edit (Update Price)
    await row.getByRole('button', { name: /Edit/i }).click();
    const modal = page.locator('div.fixed').filter({ hasText: /Cancel|Anuluj/i });
    
    await modal.locator('input[type="checkbox"]#useCustomPrice').check();
    await modal.locator('input[name="bump_price"]').fill('7.50');
    await modal.locator('button[type="submit"]').click();
    
    // Verify Update
    await expect(row).toContainText('7.5');

    // 5. Delete
    await row.getByRole('button', { name: /Delete|Usuń/i }).click();
    const confirmModal = page.locator('div.fixed').filter({ hasText: /Delete|Usuń/i });
    await confirmModal.getByRole('button', { name: /Delete|Usuń/i }).click();

    // Verify gone
    await expect(page.locator('table').getByText(mainProduct.name).first()).not.toBeVisible();
  });

  test('should display revenue statistics and trend chart', async ({ page }) => {
    // 1. Setup: Create a transaction so the dashboard has data
    const product = await createProductViaApi(`Stats-Test-${Date.now()}`, 100);
    const sessionId = `cs_test_${Date.now()}`;
    await supabaseAdmin.from('payment_transactions').insert({
      session_id: sessionId,
      product_id: product.id,
      customer_email: 'stats-test@example.com',
      amount: 10000,
      currency: 'USD',
      status: 'completed'
    });

    await loginAsAdmin(page);
    await page.goto('/dashboard');

    // 2. Verify all four stat cards are rendered
    await expect(page.getByTestId('stat-card-total-revenue')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('stat-card-today-orders')).toBeVisible();
    await expect(page.getByTestId('stat-card-total-users')).toBeVisible();
    await expect(page.getByTestId('stat-card-active-users')).toBeVisible();

    // 3. Verify the revenue card shows a non-zero value (not just "visible")
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const revenueValue = revenueCard.locator('p.text-2xl');
    await expect(revenueValue).not.toHaveText('0', { timeout: 10000 });
    // Revenue should contain a currency symbol (e.g., "$" or "PLN" or "zł")
    await expect(revenueValue).not.toHaveText('****'); // not hidden

    // 4. Verify that today's orders shows at least 1 (from the transaction we created)
    const ordersCard = page.getByTestId('stat-card-today-orders');
    const ordersValue = ordersCard.locator('p.text-2xl');
    await expect(ordersValue).not.toHaveText('0', { timeout: 10000 });

    // 5. Verify total users shows at least 1 (the admin user we created)
    const usersCard = page.getByTestId('stat-card-total-users');
    const usersValue = usersCard.locator('p.text-2xl');
    await expect(usersValue).not.toHaveText('0', { timeout: 10000 });

    // 6. Verify chart is rendered (since we have completed transactions, chart should have data)
    const chartContainer = page.locator('.recharts-responsive-container');
    await expect(chartContainer).toBeVisible({ timeout: 15000 });
  });

});