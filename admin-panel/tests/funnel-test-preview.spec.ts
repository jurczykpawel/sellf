/**
 * E2E Tests: Admin Funnel Test Preview
 *
 * Tests the "Test Funnel" feature that lets admins preview the checkout flow
 * without creating real Stripe sessions or granting access.
 *
 * Covers:
 * - "Test Funnel" button visible in admin products table
 * - Funnel test banner + "Zapłać.*symulacja|Pay.*simulation" button for admin
 * - Product variants: simple paid, with order bump, with coupon, PWYW
 * - Non-admin users see normal checkout with ?funnel_test=1
 *
 * @see admin-panel/src/components/ProductsTable.tsx
 * @see admin-panel/src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx
 */

import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin, setAuthSession } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

test.describe('Admin Funnel Test Preview', () => {
  // run sequentially because data setup is shared
  test.describe.configure({ mode: 'serial', retries: 1 });

  // increase default test timeout to give slow environments extra margin
  test.setTimeout(60_000);

  let adminEmail: string;
  let adminPassword: string;
  let adminCleanup: () => Promise<void>;

  // Product slugs for cleanup
  let simpleProductSlug: string;
  let bumpMainSlug: string;
  let bumpAddonSlug: string;
  let couponProductSlug: string;
  let pwywProductSlug: string;

  // IDs needed for order bump / coupon setup
  let bumpMainId: string;
  let bumpAddonId: string;
  let couponProductId: string;
  let orderBumpId: string;
  let couponCode: string;
  let couponId: string;

  test.beforeAll(async () => {
    const admin = await createTestAdmin('funnel-test');
    adminEmail = admin.email;
    adminPassword = admin.password;
    adminCleanup = admin.cleanup;

    const ts = Date.now();

    // 1. Simple paid product
    simpleProductSlug = `funnel-simple-${ts}`;
    await supabaseAdmin
      .from('products')
      .insert({
        name: 'Funnel Test — Simple',
        slug: simpleProductSlug,
        price: 99,
        currency: 'PLN',
        description: 'Simple paid product for funnel test',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true,
      });

    // 2. Product with order bump (main + addon)
    bumpMainSlug = `funnel-bump-main-${ts}`;
    bumpAddonSlug = `funnel-bump-addon-${ts}`;

    const { data: mainProduct } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Funnel Test — Main + Bump',
        slug: bumpMainSlug,
        price: 149,
        currency: 'PLN',
        description: 'Main product with order bump',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true,
      })
      .select()
      .single();
    bumpMainId = mainProduct!.id;

    const { data: addonProduct } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Pro Toolkit Addon',
        slug: bumpAddonSlug,
        price: 79,
        currency: 'PLN',
        description: 'Addon product used as order bump',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true,
      })
      .select()
      .single();
    bumpAddonId = addonProduct!.id;

    const { data: ob } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: bumpMainId,
        bump_product_id: bumpAddonId,
        bump_title: 'Add Pro Toolkit!',
        bump_price: 49,
        is_active: true,
      })
      .select()
      .single();
    orderBumpId = ob!.id;

    // 3. Product with coupon
    couponProductSlug = `funnel-coupon-${ts}`;
    const { data: couponProd } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Funnel Test — Coupon',
        slug: couponProductSlug,
        price: 199,
        currency: 'PLN',
        description: 'Product for coupon test',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true,
      })
      .select()
      .single();
    couponProductId = couponProd!.id;

    couponCode = `FUNNEL20-${ts}`;
    const { data: couponData } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: couponCode,
        name: 'Funnel test 20% off',
        discount_type: 'percentage',
        discount_value: 20,
        is_active: true,
        starts_at: new Date().toISOString(),
      })
      .select()
      .single();
    couponId = couponData!.id;

    // 4. PWYW product
    pwywProductSlug = `funnel-pwyw-${ts}`;
    await supabaseAdmin
      .from('products')
      .insert({
        name: 'Funnel Test — PWYW',
        slug: pwywProductSlug,
        price: 50,
        currency: 'PLN',
        description: 'Pay What You Want product',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 5,
        show_price_presets: true,
        custom_price_presets: [10, 25, 50],
        vat_rate: 23,
        price_includes_vat: true,
      });
  });

  test.afterAll(async () => {
    // Clean up in dependency order: order_bumps → coupons → products → user
    if (orderBumpId) {
      await supabaseAdmin.from('order_bumps').delete().eq('id', orderBumpId);
    }
    if (couponId) {
      await supabaseAdmin.from('coupons').delete().eq('id', couponId);
    }
    const slugs = [simpleProductSlug, bumpMainSlug, bumpAddonSlug, couponProductSlug, pwywProductSlug];
    for (const slug of slugs) {
      if (slug) {
        await supabaseAdmin.from('products').delete().eq('slug', slug);
      }
    }
    await adminCleanup();
  });

  // helper for navigating to checkout pages with robust waiting
  async function gotoCheckout(page: any, slug: string, query = '') {
    const url = `/checkout/${slug}${query}`;
    // Avoid networkidle: external resources and open sockets can prevent idle
    // Use default 'load' which is faster and reliable; tests then wait for DOM
    await page.goto(url, { timeout: 60000 });
  }

  // =========================================================================
  // Admin Dashboard — "Test Funnel" button
  // =========================================================================

  test('should show "Test Funnel" button in products table', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/products', { waitUntil: 'domcontentloaded', timeout: 60000 });

    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // The Test Funnel option is in the ⋯ dropdown — open it and check visibility
    const firstMoreActions = page.locator('button[aria-label*="akcji"], button[aria-label*="actions"]').first();
    await firstMoreActions.click();
    await expect(page.locator('button').filter({ hasText: /Testuj lejek|Test Funnel/i }).first()).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // Simple paid product — core funnel test flow
  // =========================================================================

  test('should show funnel test banner on checkout for admin', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, simpleProductSlug, '?funnel_test=1');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('TEST LEJKA')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Podgląd checkoutu jako administrator/i)).toBeVisible();
  });

  test('should show "Zapłać.*symulacja|Pay.*simulation" button instead of Stripe Elements', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, simpleProductSlug, '?funnel_test=1');
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });

    // Stripe Pay button should NOT be present (exclude the simulation button)
    await expect(
      page.getByRole('button', { name: /Pay|Zapłać/i }).filter({ hasNotText: /symulacja/i })
    ).not.toBeVisible({ timeout: 3000 });
  });

  test('should show product name and pricing in funnel test mode', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, simpleProductSlug, '?funnel_test=1');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Funnel Test — Simple')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/99/)).toBeVisible();
  });

  test('should show success state when clicking "Zapłać.*symulacja|Pay.*simulation"', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, simpleProductSlug, '?funnel_test=1');
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    await expect(page.getByText(/Access Granted|Dostęp przyznany/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Auto-redirect|Przekierowanie za/i)).toBeVisible({ timeout: 3000 });

    // "Go to Product" button should be visible in success state
    await expect(page.getByRole('button', { name: /Go to Product|Przejdź do produktu/i })).toBeVisible({ timeout: 3000 });

    // "Zapłać.*symulacja|Pay.*simulation" button should disappear after access granted
    await expect(completeButton).not.toBeVisible();
  });

  // =========================================================================
  // Product with order bump
  // =========================================================================

  test('should display order bump UI in funnel test mode', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, bumpMainSlug, '?funnel_test=1');
    await page.waitForLoadState('domcontentloaded');

    // Funnel test banner present
    await expect(page.getByText('TEST LEJKA')).toBeVisible({ timeout: 15000 });

    // Main product name and price visible
    await expect(page.getByText('Funnel Test — Main + Bump')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/149/).first()).toBeVisible();

    // Order bump offer should be visible
    await expect(page.getByText('Add Pro Toolkit!')).toBeVisible({ timeout: 10000 });

    // Bump price visible (use first() since "49" can appear in multiple places)
    await expect(page.getByText(/49/).first()).toBeVisible();

    // Zapłać.*symulacja|Pay.*simulation button present (simulation complete)
    await expect(page.getByRole('button', { name: /Zapłać.*symulacja/i })).toBeVisible();

    // The only pay-themed button should be the simulation one
    const payButtons = page.getByRole('button').filter({ hasText: /Pay|Zapłać/i });
    await expect(payButtons).toHaveCount(1);
    // (Stripe iframe may be present but hidden; funnel_test ensures the user-facing
    // button is the simulation button.)
  });

  test('should allow selecting order bump and completing test', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, bumpMainSlug, '?funnel_test=1');
    await page.waitForLoadState('domcontentloaded');

    // Click the bump offer to select it
    const bumpCard = page.getByText('Add Pro Toolkit!');
    await expect(bumpCard).toBeVisible({ timeout: 10000 });
    await bumpCard.click();

    // Complete test
    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 5000 });
    await completeButton.click();

    // Success state
    await expect(page.getByText(/Access Granted|Dostęp przyznany/i)).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // Product with coupon
  // =========================================================================

  test('should show coupon input and apply coupon in funnel test mode', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, couponProductSlug, '?funnel_test=1&show_promo=true');
    await page.waitForLoadState('domcontentloaded');

    // Funnel test banner present
    await expect(page.getByText('TEST LEJKA')).toBeVisible({ timeout: 15000 });

    // Product name and price visible (heading only)
    await expect(page.getByRole('heading', { name: 'Funnel Test — Coupon' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/199/).first()).toBeVisible();

    // Wait for the coupon section to appear, then type
    await page.waitForTimeout(2000);
    const couponField = page.locator('input[type="text"]').last();
    await expect(couponField).toBeVisible({ timeout: 5000 });
    await couponField.fill(couponCode);

    // Click apply button
    const applyButton = page.getByRole('button', { name: /Apply|Zastosuj/i });
    await applyButton.click();

    // Wait for coupon verification
    await page.waitForTimeout(2000);

    // Discount should be applied (green checkmark or discount text)
    await expect(page.getByText(/20%/)).toBeVisible({ timeout: 5000 });

    // Zapłać.*symulacja|Pay.*simulation button should still be present after coupon applied
    await expect(page.getByRole('button', { name: /Zapłać.*symulacja/i })).toBeVisible();

    // Stripe Pay button (non-simulation) should NOT be visible
    await expect(
      page.getByRole('button', { name: /Pay|Zapłać/i }).filter({ hasNotText: /symulacja/i })
    ).not.toBeVisible({ timeout: 3000 });
  });

  test('should auto-apply URL coupon in funnel test mode', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, couponProductSlug, `?funnel_test=1&coupon=${couponCode}`);
    await page.waitForLoadState('domcontentloaded');

    // Funnel test banner present
    await expect(page.getByText('TEST LEJKA')).toBeVisible({ timeout: 15000 });

    // Product name visible (heading only to avoid title element)
    await expect(page.getByRole('heading', { name: 'Funnel Test — Coupon' })).toBeVisible({ timeout: 10000 });

    // Coupon should auto-apply from URL param
    await expect(page.getByText(/20%/)).toBeVisible({ timeout: 10000 });

    // Zapłać.*symulacja|Pay.*simulation button present
    await expect(page.getByRole('button', { name: /Zapłać.*symulacja/i })).toBeVisible();

    // Stripe Pay button (non-simulation) should NOT be visible
    await expect(
      page.getByRole('button', { name: /Pay|Zapłać/i }).filter({ hasNotText: /symulacja/i })
    ).not.toBeVisible({ timeout: 3000 });
  });

  // =========================================================================
  // PWYW (Pay What You Want) product
  // =========================================================================

  test('should show PWYW price presets in funnel test mode', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, pwywProductSlug, '?funnel_test=1');
    await page.waitForLoadState('domcontentloaded');

    // Funnel test banner present
    await expect(page.getByText('TEST LEJKA')).toBeVisible({ timeout: 15000 });

    // Product name visible (heading only)
    await expect(page.getByRole('heading', { name: 'Funnel Test — PWYW' })).toBeVisible({ timeout: 10000 });

    // PWYW preset buttons should be visible
    await expect(page.getByRole('button', { name: /10/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /25/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /50/ })).toBeVisible();

    // Custom amount input field visible
    await expect(page.locator('input[inputmode="decimal"]')).toBeVisible();

    // Currency label visible
    await expect(page.getByText('PLN').first()).toBeVisible();

    // Zapłać.*symulacja|Pay.*simulation button present
    await expect(page.getByRole('button', { name: /Zapłać.*symulacja/i })).toBeVisible();

    // Stripe Pay button (non-simulation) should NOT be visible
    await expect(
      page.getByRole('button', { name: /Pay|Zapłać/i }).filter({ hasNotText: /symulacja/i })
    ).not.toBeVisible({ timeout: 3000 });
  });

  test('should allow selecting PWYW preset and completing test', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, pwywProductSlug, '?funnel_test=1');
    await page.waitForLoadState('domcontentloaded');

    // Select the 25 PLN preset
    const preset25 = page.getByRole('button', { name: /25/ });
    await expect(preset25).toBeVisible({ timeout: 10000 });
    await preset25.click();

    // Complete test
    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 5000 });
    await completeButton.click();

    // Success state
    await expect(page.getByText(/Access Granted|Dostęp przyznany/i)).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // Normal checkout (no funnel_test) — admin sees Stripe
  // =========================================================================

  test('should show normal Stripe checkout for admin without funnel_test param', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoCheckout(page, simpleProductSlug);
    await page.waitForLoadState('domcontentloaded');

    // Funnel test banner should NOT be visible
    await expect(page.getByText('TEST LEJKA')).not.toBeVisible({ timeout: 3000 });

    // "Zapłać.*symulacja|Pay.*simulation" button should NOT be present
    await expect(page.locator('button', { hasText: /Zapłać.*symulacja/i })).toHaveCount(0, { timeout: 3000 });

    // Product name should still be visible
    await expect(page.getByText('Funnel Test — Simple')).toBeVisible({ timeout: 15000 });
  });

  // =========================================================================
  // Non-admin user — funnel_test param ignored
  // =========================================================================

  test('should show normal checkout for non-admin with funnel_test=1', async ({ page }) => {
    const nonAdminEmail = `non-admin-funnel-${Date.now()}@example.com`;
    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: nonAdminEmail,
      password: 'password123',
      email_confirm: true,
    });
    if (error) throw error;

    try {
      await acceptAllCookies(page);
      await page.addInitScript(() => {
        const addStyle = () => {
          if (document.head) {
            const style = document.createElement('style');
            style.innerHTML = '#cc-main { display: none !important; }';
            document.head.appendChild(style);
          } else {
            setTimeout(addStyle, 10);
          }
        };
        addStyle();
      });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await setAuthSession(page, nonAdminEmail, 'password123');

      await gotoCheckout(page, simpleProductSlug, '?funnel_test=1');
      await page.waitForLoadState('domcontentloaded');

      // Funnel test banner should NOT be visible (non-admin)
      // Use toHaveCount(0) to avoid strict mode violations if text partially matches multiple nodes
      await expect(page.locator('text="TEST LEJKA"')).toHaveCount(0, { timeout: 5000 });
      await expect(page.locator('text="FUNNEL TEST"')).toHaveCount(0, { timeout: 2000 });

      // "Zapłać.*symulacja|Pay.*simulation" button should NOT be present for non-admin
      await expect(page.locator('button', { hasText: /Zapłać.*symulacja|Pay.*simulation|Zapłać.*symulacja|Pay.*simulation/i })).toHaveCount(0, { timeout: 3000 });

      // Normal checkout should load
      await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
    } finally {
      await supabaseAdmin.auth.admin.deleteUser(user!.id);
    }
  });
});
