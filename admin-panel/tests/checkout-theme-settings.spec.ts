/**
 * E2E Tests: Checkout Theme Settings
 *
 * Tests the CheckoutThemeSettings component on /dashboard/settings page.
 * Covers: system/light/dark selection, immediate save, checkout page rendering.
 *
 * @see admin-panel/src/components/settings/CheckoutThemeSettings.tsx
 * @see admin-panel/src/components/providers/theme-provider.tsx
 */

import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Checkout Theme Settings', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  const password = 'password123';
  let shopConfigId: string;
  let originalCheckoutTheme: string | null = null;
  let testProductSlug: string;

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

    await setAuthSession(page, adminEmail, password);

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-checkout-theme-${Date.now()}-${randomStr}@example.com`;

    // Create admin user
    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: user!.id });

    // Save original checkout_theme
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('id, checkout_theme')
      .single();

    if (config) {
      shopConfigId = config.id;
      originalCheckoutTheme = config.checkout_theme;
    }

    // Create test product for checkout page verification
    testProductSlug = `checkout-theme-test-${Date.now()}`;
    await supabaseAdmin.from('products').insert({
      name: 'Checkout Theme Test Product',
      slug: testProductSlug,
      price: 10,
      currency: 'USD',
      is_active: true,
    });
  });

  test.afterAll(async () => {
    // Restore original theme
    if (shopConfigId) {
      await supabaseAdmin
        .from('shop_config')
        .update({ checkout_theme: originalCheckoutTheme })
        .eq('id', shopConfigId);
    }

    // Cleanup product
    await supabaseAdmin
      .from('products')
      .delete()
      .eq('slug', testProductSlug);

    // Delete test user
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const testUser = users.users.find(u => u.email === adminEmail);
    if (testUser) {
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
  });

  // =========================================================================
  // Tests
  // =========================================================================

  test('should display three theme options (system, light, dark)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    // Find the Checkout Theme section
    const themeHeading = page.locator('h2', { hasText: /Site Theme|Checkout Theme|Motyw|Motyw checkout/i });
    await expect(themeHeading).toBeVisible({ timeout: 10000 });

    // Should show system, light, dark buttons with their icons (use emoji to disambiguate)
    const themeSection = themeHeading.locator('..');
    await expect(themeSection.locator('button', { hasText: '💻' })).toBeVisible();
    await expect(themeSection.locator('button', { hasText: '☀️' })).toBeVisible();
    await expect(themeSection.locator('button', { hasText: '🌙' })).toBeVisible();
  });

  test('should save theme selection immediately on click', async ({ page }) => {
    // Start with known state
    await supabaseAdmin
      .from('shop_config')
      .update({ checkout_theme: 'system' })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const themeHeading = page.locator('h2', { hasText: /Site Theme|Checkout Theme|Motyw|Motyw checkout/i });
    await expect(themeHeading).toBeVisible({ timeout: 10000 });

    const themeSection = themeHeading.locator('..');

    // Click "Dark" button
    await themeSection.locator('button', { hasText: '🌙' }).click();
    await page.waitForTimeout(2000);

    // Verify in DB — should be saved immediately (no "Save" button)
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('checkout_theme')
      .eq('id', shopConfigId)
      .single();

    expect(config!.checkout_theme).toBe('dark');
  });

  test('should persist theme after page refresh', async ({ page }) => {
    // Set "light" in DB
    await supabaseAdmin
      .from('shop_config')
      .update({ checkout_theme: 'light' })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const themeHeading = page.locator('h2', { hasText: /Site Theme|Checkout Theme|Motyw|Motyw checkout/i });
    await expect(themeHeading).toBeVisible({ timeout: 10000 });

    const themeSection = themeHeading.locator('..');

    // The "Light" button should have the selected styling (border-sf-border-accent)
    const lightButton = themeSection.locator('button', { hasText: '☀️' });
    const buttonClass = await lightButton.getAttribute('class');
    expect(buttonClass).toContain('border-sf-border-accent');

    // Now switch to dark
    const darkBtn = themeSection.locator('button', { hasText: '🌙' });
    await darkBtn.click();
    // Wait for the dark button to get the selected class (server action saves + revalidates)
    await expect(darkBtn).toHaveClass(/border-sf-border-accent/, { timeout: 10000 });

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');

    const reloadedHeading = page.locator('h2', { hasText: /Site Theme|Checkout Theme|Motyw|Motyw checkout/i });
    await expect(reloadedHeading).toBeVisible({ timeout: 10000 });

    const reloadedSection = reloadedHeading.locator('..');
    const darkButton = reloadedSection.locator('button', { hasText: '🌙' });
    await expect(darkButton).toBeVisible({ timeout: 5000 });
    await expect(darkButton).toHaveClass(/border-sf-border-accent/, { timeout: 5000 });
  });

  test('should apply dark theme on checkout page', async ({ page }) => {
    // Set dark theme
    await supabaseAdmin
      .from('shop_config')
      .update({ checkout_theme: 'dark' })
      .eq('id', shopConfigId);

    await acceptAllCookies(page);

    // Clear any stored theme preference to ensure admin theme applies
    await page.addInitScript(() => {
      localStorage.removeItem('sf_theme');
    });

    // Visit checkout page (public, no login needed)
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // The HTML element should have the "dark" class from ThemeScript
    const hasDark = await page.evaluate(() => {
      return document.documentElement.classList.contains('dark');
    });
    expect(hasDark).toBe(true);
  });
});
