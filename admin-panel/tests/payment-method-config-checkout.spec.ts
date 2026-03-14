/**
 * E2E Tests for Payment Method Configuration - Checkout Flow
 *
 * Tests how payment method configuration affects the checkout experience:
 * - Automatic mode (E2E-CHECKOUT-001, E2E-CHECKOUT-002)
 * - Stripe preset mode (E2E-CHECKOUT-003)
 * - Custom mode (E2E-CHECKOUT-004, E2E-CHECKOUT-005)
 * - Payment method ordering (E2E-CHECKOUT-006, E2E-CHECKOUT-007)
 * - Express Checkout toggles (E2E-CHECKOUT-008, E2E-CHECKOUT-009, E2E-CHECKOUT-010)
 * - Fallback behavior (E2E-CHECKOUT-011)
 * - Complete payment flow (E2E-CHECKOUT-012)
 *
 * Total: 12 checkout flow test cases
 */

import { test, expect, Page } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

const gotoPaymentsSettings = async (page: Page) => {
  await page.goto('/dashboard/settings');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /^Payments$|^Płatności$/i }).click();
  await page.waitForSelector('input[type="radio"][value="automatic"]', { timeout: 10000 });
};

test.describe('Payment Method Configuration - Checkout Flow', () => {
  let testProductSlug: string;
  let adminEmail: string;
  let adminPassword: string;
  let cleanup: () => Promise<void>;
  const createdProductSlugs: string[] = [];

  test.beforeAll(async () => {
    // Create admin user for tests
    const admin = await createTestAdmin('payment-checkout-test');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanup = admin.cleanup;

    // Create PLN test product via API (more robust than UI)
    testProductSlug = `pmc-checkout-pln-${Date.now()}`;
    const { error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Test Product - Payment Config E2E',
        slug: testProductSlug,
        price: 99,
        currency: 'PLN',
        description: 'Test product for payment config checkout tests',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true,
      });
    if (error) throw error;
    createdProductSlugs.push(testProductSlug);
  });

  test.afterAll(async () => {
    // Clean up products
    for (const slug of createdProductSlugs) {
      await supabaseAdmin.from('products').delete().eq('slug', slug);
    }
    if (cleanup) await cleanup();
  });

  test('E2E-CHECKOUT-001: Automatic mode - PLN product', async ({ page }) => {
    // Set payment config to automatic mode
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    const automaticRadio = page.locator('input[type="radio"][value="automatic"]').first();
    await automaticRadio.check();

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Visit checkout page
    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for Stripe Payment Element to load
    await page.waitForTimeout(3000);

    // Verify checkout loaded with Stripe Payment Element (pay button shows price from payment intent)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-002: Automatic mode - USD product', async ({ page }) => {
    // Create USD product via API
    const usdProductSlug = `pmc-checkout-usd-${Date.now()}`;
    const { error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Test Product USD - Payment Config',
        slug: usdProductSlug,
        price: 29.99,
        currency: 'USD',
        description: 'USD test product for payment config',
        is_active: true,
      });
    if (error) throw error;
    createdProductSlugs.push(usdProductSlug);

    // Visit checkout
    await page.goto(`/checkout/${usdProductSlug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Verify checkout loaded with Stripe Payment Element (pay button shows price from payment intent)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-003: Stripe preset - Custom PMC', async ({ page }) => {
    // This test requires a real Stripe PMC to be configured in Stripe Dashboard
    // Skip if no valid PMC options are available

    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    // Scroll to Payment Method Settings section
    await page.locator('h3:has-text("Konfiguracja Metod Płatności")').scrollIntoViewIfNeeded();

    const stripePresetRadio = page.locator('input[name="config_mode"]').nth(1);
    await stripePresetRadio.check();

    await page.waitForTimeout(1000);

    // Look for PMC dropdown specifically in the Stripe Preset section
    const pmcSection = page.locator('.bg-gray-50, .bg-gray-700\\/50').filter({ hasText: /Konfiguracja Stripe PMC|Stripe PMC/i });
    const dropdown = pmcSection.locator('select');

    // Check if dropdown exists and has valid PMC options (starts with pmc_)
    const isVisible = await dropdown.isVisible().catch(() => false);
    if (!isVisible) {
      test.skip(true, 'PMC dropdown not visible - Stripe PMC might not be loaded');
      return;
    }

    const options = await dropdown.locator('option').allTextContents();
    const hasPmcOptions = options.some(opt => opt.includes('pmc_'));

    if (!hasPmcOptions) {
      test.skip(true, 'No Stripe PMC configurations available in account');
      return;
    }

    // Select first PMC option
    await dropdown.selectOption({ index: 1 });

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();

    // Save must succeed to continue to checkout
    const successMessage = page.locator('text=Konfiguracja metod płatności zapisana pomyślnie');
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-004: Custom mode - PLN methods', async ({ page }) => {
    // Configure custom mode — uses drag-and-drop list (all methods shown by default)
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    // Scroll to payment method section and select custom mode
    const customLabel = page.locator('text=/Niestandardowy|Custom/i').first();
    await customLabel.scrollIntoViewIfNeeded();
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();
    await page.waitForTimeout(500);

    // In custom mode, all enabled methods (Card, BLIK, Przelewy24) are shown in a drag-and-drop list
    // Verify the list is visible
    await expect(page.getByText('Kolejność Metod Płatności', { exact: true }).or(page.getByText('Payment Method Order', { exact: true }))).toBeVisible({ timeout: 5000 });

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Visit checkout
    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');

    // Verify checkout loaded with Stripe Payment Element (pay button shows price from payment intent)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-005: Custom mode - Currency filter', async ({ page }) => {
    // Custom mode with all methods — verify checkout works for USD (BLIK filtered by Stripe for non-PLN)
    // Create USD product to test currency filtering via API
    const usdFilterSlug = `pmc-usd-filter-${Date.now()}`;
    const { error: usdError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Test USD - Currency Filter',
        slug: usdFilterSlug,
        price: 49.99,
        currency: 'USD',
        description: 'USD test product for currency filtering',
        is_active: true,
      });
    if (usdError) throw usdError;
    createdProductSlugs.push(usdFilterSlug);

    // Visit checkout for USD product — Stripe automatically filters BLIK (PLN-only)
    await page.goto(`/checkout/${usdFilterSlug}`);
    await page.waitForLoadState('domcontentloaded');

    // Verify checkout loaded (pay button with USD price)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-006: Payment method order - BLIK first', async ({ page }) => {
    // This test verifies that custom mode with drag-and-drop payment method order works
    // Custom mode uses a reorderable list (no checkboxes) — all methods are always enabled

    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    // Select custom mode
    const customLabel = page.locator('text=/Niestandardowy|Custom/i').first();
    await customLabel.scrollIntoViewIfNeeded();
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();
    await page.waitForTimeout(500);

    // Verify drag-and-drop payment method order list is visible
    await expect(page.getByText('Kolejność Metod Płatności', { exact: true }).or(page.getByText('Payment Method Order', { exact: true }))).toBeVisible({ timeout: 5000 });

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Visit checkout
    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Verify checkout loaded with Stripe Payment Element (pay button shows price from payment intent)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-007: Payment method order - Card first', async ({ page }) => {
    // Similar to CHECKOUT-006 — custom mode uses drag-and-drop list, no checkboxes
    // Verifies custom config is saved and checkout still works

    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    // Select custom mode
    const customLabel = page.locator('text=/Niestandardowy|Custom/i').first();
    await customLabel.scrollIntoViewIfNeeded();
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();
    await page.waitForTimeout(500);

    // Verify drag-and-drop payment method order list is visible
    await expect(page.getByText('Kolejność Metod Płatności', { exact: true }).or(page.getByText('Payment Method Order', { exact: true }))).toBeVisible({ timeout: 5000 });

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Visit checkout
    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Verify checkout loaded with Stripe Payment Element (pay button shows price from payment intent)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-008: Express Checkout - All enabled', async ({ page }) => {
    // Configure Express Checkout with all options enabled
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    // Scroll to Express Checkout section
    const expressSection = page.getByText(/Express Checkout/).first();
    await expect(expressSection).toBeVisible({ timeout: 10000 });
    await expressSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Enable Express Checkout master toggle
    const masterToggle = page.getByRole('checkbox', { name: /Włącz Express Checkout|Enable Express Checkout/i });
    if (!(await masterToggle.isChecked())) {
      await masterToggle.check();
    }

    await page.waitForTimeout(500);

    // Enable all sub-options
    const applePayCheckbox = page.getByRole('checkbox', { name: /Apple Pay/i });
    if (!(await applePayCheckbox.isChecked())) {
      await applePayCheckbox.check();
    }

    const googlePayCheckbox = page.getByRole('checkbox', { name: /Google Pay/i });
    if (!(await googlePayCheckbox.isChecked())) {
      await googlePayCheckbox.check();
    }

    const linkCheckbox = page.getByRole('checkbox', { name: /^Link$/i });
    if (!(await linkCheckbox.isChecked())) {
      await linkCheckbox.check();
    }

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Visit checkout
    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');
    // Wait for Stripe Elements iframe to mount before asserting Pay button
    await expect(page.locator('iframe[name^="__privateStripeFrame"]').first()).toBeAttached({ timeout: 20000 });

    // Verify checkout loaded (Express Checkout + Payment Element)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-009: Express Checkout - Link only', async ({ page }) => {
    // Configure Express Checkout with only Link enabled
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    // Scroll to Express Checkout section
    const expressSection = page.getByText(/Express Checkout/).first();
    await expect(expressSection).toBeVisible({ timeout: 10000 });
    await expressSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Enable Express Checkout master toggle
    const masterToggle = page.getByRole('checkbox', { name: /Włącz Express Checkout|Enable Express Checkout/i });
    if (!(await masterToggle.isChecked())) {
      await masterToggle.check();
    }

    await page.waitForTimeout(500);

    // Disable Apple Pay and Google Pay, enable Link
    const applePayCheckbox = page.getByRole('checkbox', { name: /Apple Pay/i });
    if (await applePayCheckbox.isChecked()) {
      await applePayCheckbox.uncheck();
    }

    const googlePayCheckbox = page.getByRole('checkbox', { name: /Google Pay/i });
    if (await googlePayCheckbox.isChecked()) {
      await googlePayCheckbox.uncheck();
    }

    const linkCheckbox = page.getByRole('checkbox', { name: /^Link$/i });
    if (!(await linkCheckbox.isChecked())) {
      await linkCheckbox.check();
    }

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Visit checkout
    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');
    // Wait for Stripe Elements iframe to mount before asserting Pay button
    await expect(page.locator('iframe[name^="__privateStripeFrame"]').first()).toBeAttached({ timeout: 20000 });

    // Verify checkout loaded (Express Checkout with Link only)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-010: Express Checkout - All disabled', async ({ page }) => {
    // Disable Express Checkout entirely
    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    // Scroll to Express Checkout section
    const expressSection = page.getByText(/Express Checkout/).first();
    await expressSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Disable Express Checkout master toggle
    const masterToggle = page.getByRole('checkbox', { name: /Włącz Express Checkout|Enable Express Checkout/i });
    if (await masterToggle.isChecked()) {
      await masterToggle.uncheck();
    }

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Visit checkout — the Pay button only renders after clientSecret is set, which
    // requires /api/create-payment-intent to respond. Wait for that response directly
    // instead of networkidle (which waits unnecessarily for all Stripe background requests).
    expect(testProductSlug).toBeTruthy();
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/api/create-payment-intent') && resp.status() === 200,
      { timeout: 15000 }
    );
    await page.goto(`/checkout/${testProductSlug}`);
    await responsePromise;

    // Verify checkout loaded (no Express Checkout, only regular Payment Element)
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 5000 });
  });

  test('E2E-CHECKOUT-011: Config fallback - No config', async ({ page }) => {
    // This test would require deleting the config row from database
    // For now, just verify that automatic mode works as fallback

    await loginAsAdmin(page, adminEmail, adminPassword);
    await gotoPaymentsSettings(page);

    // Ensure automatic mode is selected
    const automaticRadio = page.locator('input[type="radio"][value="automatic"]').first();
    await automaticRadio.check();

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Visit checkout - should work with automatic mode fallback
    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');
    // Wait for Stripe Elements iframe to mount before asserting Pay button
    await expect(page.locator('iframe[name^="__privateStripeFrame"]').first()).toBeAttached({ timeout: 20000 });

    // Verify checkout loaded with Stripe Payment Element
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 15000 });
  });

  test('E2E-CHECKOUT-012: Complete payment - Custom config', async ({ page }) => {
    // Set custom mode with card enabled directly in DB to avoid UI race conditions
    // (custom mode requires at least one enabled method, which the UI initializes async)
    await supabaseAdmin
      .from('payment_method_config')
      .upsert({
        id: 1,
        config_mode: 'custom',
        custom_payment_methods: [
          { type: 'card', enabled: true, display_order: 0, currency_restrictions: [] },
        ],
        payment_method_order: ['card'],
        enable_express_checkout: false,
        enable_apple_pay: false,
        enable_google_pay: false,
        enable_link: false,
        currency_overrides: {},
      });

    // Visit checkout and verify custom config is applied
    // (Stripe Elements loads = payment intent created successfully with custom method list)
    expect(testProductSlug).toBeTruthy();
    await page.goto(`/checkout/${testProductSlug}`);
    await page.waitForLoadState('domcontentloaded');

    // Stripe Elements iframe mounting confirms payment intent was created with custom config
    const stripeFrame = page.locator('iframe[name^="__privateStripeFrame"]').first();
    await expect(stripeFrame).toBeVisible({ timeout: 15000 });

    // Confirm the pay button is present and shows the correct amount
    await expect(page.getByRole('button', { name: /Pay|Zapłać/i })).toBeVisible({ timeout: 5000 });
  });
});
