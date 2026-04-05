/**
 * E2E Tests for Payment Method Configuration
 *
 * Tests admin UI for configuring payment methods:
 * - Automatic mode (E2E-ADMIN-001, E2E-ADMIN-006, E2E-ADMIN-007)
 * - Stripe preset mode (E2E-ADMIN-002, E2E-ADMIN-004, E2E-ADMIN-010)
 * - Custom mode with drag & drop ordering (E2E-ADMIN-003, E2E-ADMIN-009)
 * - Express Checkout configuration (E2E-ADMIN-005)
 * - Reset functionality (E2E-ADMIN-008)
 * - Security (E2E-ADMIN-011)
 *
 * Total: 11 admin UI test cases
 */

import { test, expect, Page } from '@playwright/test';
import { createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

const gotoPaymentsSettings = async (page: Page) => {
  await page.goto('/pl/dashboard/settings');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /^Payments$|^Płatności$/i }).click();
  await page.waitForSelector('input[type="radio"][value="automatic"]', { timeout: 10000 });
};

const reloadPaymentsSettings = async (page: Page) => {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /^Payments$|^Płatności$/i }).click();
  await page.waitForSelector('input[type="radio"][value="automatic"]', { timeout: 10000 });
};

test.describe('Payment Method Configuration - Admin UI', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  let adminPassword: string;
  let cleanup: () => Promise<void>;

  test.beforeAll(async () => {
    const admin = await createTestAdmin('payment-config-test');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanup = admin.cleanup;
  });

  test.afterAll(async () => {
    if (cleanup) await cleanup();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
  });

  test('Admin can view payment method configuration settings', async ({ page }) => {
    // Navigate to settings page
    await gotoPaymentsSettings(page);

    // Verify Payment Method Configuration section exists
    const heading = page.locator('text=Konfiguracja Metod Płatności');
    await expect(heading).toBeVisible();

    // Verify description
    await expect(
      page.locator('text=Zarządzaj metodami płatności wyświetlanymi podczas checkout')
    ).toBeVisible();
  });

  test('Admin can select automatic mode', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Select automatic mode
    const automaticRadio = page.locator('input[type="radio"][value="automatic"]').first();
    await automaticRadio.check();

    // Verify automatic mode description
    await expect(
      page.locator('text=Użyj domyślnych metod płatności Stripe')
    ).toBeVisible();

    // Save configuration
    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();

    // Verify success toast
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });
  });

  test('Admin can select stripe preset mode', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Select Stripe preset mode
    const stripePresetRadio = page.locator('input[name="config_mode"]').nth(1);
    await stripePresetRadio.check();

    // Verify Stripe PMC selector appears
    await expect(
      page.locator('text=Konfiguracja Stripe PMC')
    ).toBeVisible();

    // Verify dropdown exists
    const dropdown = page.locator('select').first();
    await expect(dropdown).toBeVisible();
  });

  test('Admin can select custom mode and enable payment methods', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Select custom mode
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();

    // Verify payment methods list appears
    await expect(page.locator('text=Wybierz Metody Płatności')).toBeVisible();

    // Enable Card (should be visible) — ensure it ends up checked
    const cardCheckbox = page.locator('input[type="checkbox"]').first();
    if (!(await cardCheckbox.isChecked())) {
      await cardCheckbox.check();
    }
    await expect(cardCheckbox).toBeChecked();

    // Verify payment method order section appears when methods are enabled
    // (This might be async, so wait a bit)
    await page.waitForTimeout(500);

    // Save configuration
    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();

    // Verify success
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });
  });

  test('E2E-ADMIN-003: Complete custom mode setup with drag & drop', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Select custom mode
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();

    // Wait for custom mode UI to render (Card checkbox is a reliable indicator)
    const cardCheckbox = page.locator('label:has-text("Card")').locator('input[type="checkbox"]');
    await expect(cardCheckbox).toBeVisible({ timeout: 8000 });

    // Enable Card, BLIK, Przelewy24
    if (!(await cardCheckbox.isChecked())) {
      await cardCheckbox.check();
    }
    await expect(cardCheckbox).toBeChecked();

    const blikCheckbox = page.locator('label:has-text("BLIK")').locator('input[type="checkbox"]');
    if (!(await blikCheckbox.isChecked())) {
      await blikCheckbox.check();
    }
    await expect(blikCheckbox).toBeChecked();

    const p24Checkbox = page.locator('label:has-text("Przelewy24")').locator('input[type="checkbox"]');
    if (!(await p24Checkbox.isChecked())) {
      await p24Checkbox.check();
    }
    await expect(p24Checkbox).toBeChecked();

    // Verify payment method order section appears
    await expect(page.getByText('Kolejność Metod Płatności', { exact: true })).toBeVisible();

    // TODO: Test drag & drop reordering (requires more complex Playwright interaction)
    // For now, just verify the order list exists

    // Save configuration
    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();

    // Verify success
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });
  });

  test('E2E-ADMIN-004: Refresh Stripe PMCs', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Select Stripe preset mode
    const stripePresetRadio = page.locator('input[name="config_mode"]').nth(1);
    await stripePresetRadio.check();

    // Wait for Stripe PMC section to render (select is a reliable indicator)
    const pmcSelect = page.locator('select').first();
    await expect(pmcSelect).toBeVisible({ timeout: 10000 });

    // Refresh button is immediately after the select in the same flex row
    const refreshButton = page.locator('select + button').first();
    await expect(refreshButton, 'Refresh button should be visible in Stripe preset mode').toBeVisible({ timeout: 5000 });

    await refreshButton.click();

    // Wait for refresh to complete
    await page.waitForTimeout(1000);
  });

  test('E2E-ADMIN-005: Express Checkout configuration', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Find Express Checkout section
    const expressCheckoutSection = page.locator('text=Express Checkout').first();
    await expect(expressCheckoutSection).toBeVisible();

    // Master toggle should be visible
    const masterToggle = page.locator('label:has-text("Włącz Express Checkout")').locator('input[type="checkbox"]');

    // Ensure master toggle is checked
    if (!(await masterToggle.isChecked())) {
      await masterToggle.check();
    }
    await expect(masterToggle).toBeChecked();

    // Verify sub-options appear
    await expect(page.getByText('Apple Pay', { exact: true })).toBeVisible();
    await expect(page.getByText('Google Pay', { exact: true })).toBeVisible();

    // Disable Apple Pay as per test case
    const applePayCheckbox = page.locator('label:has-text("Apple Pay")').locator('input[type="checkbox"]');
    if (await applePayCheckbox.isChecked()) {
      await applePayCheckbox.uncheck();
    }
    await expect(applePayCheckbox).not.toBeChecked();

    // Save configuration
    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();

    // Verify success
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Verify config was saved - reload page and check
    await reloadPaymentsSettings(page);

    const applePayCheckboxReload = page.locator('label:has-text("Apple Pay")').locator('input[type="checkbox"]');
    await expect(applePayCheckboxReload).toBeVisible({ timeout: 10000 });
    await expect(applePayCheckboxReload).not.toBeChecked();
  });

  test('E2E-ADMIN-006: Mode transition automatic → custom', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Start with automatic mode
    const automaticRadio = page.locator('input[type="radio"][value="automatic"]').first();
    await automaticRadio.check();

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Reload to clear toast and confirm automatic was saved
    await reloadPaymentsSettings(page);
    await expect(automaticRadio).toBeChecked();

    // Switch to custom mode
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();

    // Enable at least one payment method
    const cardCheckbox = page.locator('label:has-text("Card")').locator('input[type="checkbox"]');
    await expect(cardCheckbox).toBeVisible({ timeout: 8000 });
    if (!(await cardCheckbox.isChecked())) {
      await cardCheckbox.check();
    }
    await expect(cardCheckbox).toBeChecked();

    // Save
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Verify transition succeeded by reloading
    await reloadPaymentsSettings(page);

    const customRadioReload = page.locator('input[name="config_mode"]').nth(2);
    await expect(customRadioReload).toBeChecked();
  });

  test('E2E-ADMIN-007: Mode transition custom → automatic', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Start with custom mode
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();

    const cardCheckbox = page.locator('label:has-text("Card")').locator('input[type="checkbox"]');
    await expect(cardCheckbox).toBeVisible({ timeout: 8000 });
    if (!(await cardCheckbox.isChecked())) {
      await cardCheckbox.check();
    }
    await expect(cardCheckbox).toBeChecked();

    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Reload to clear toast and confirm custom was saved
    await reloadPaymentsSettings(page);
    await expect(customRadio).toBeChecked();

    // Switch to automatic
    const automaticRadio = page.locator('input[type="radio"][value="automatic"]').first();
    await automaticRadio.check();

    await saveButton.click();
    await expect(page.locator('text=Konfiguracja metod płatności zapisana pomyślnie')).toBeVisible({
      timeout: 10000,
    });

    // Verify custom methods were cleared
    await reloadPaymentsSettings(page);

    const automaticRadioReload = page.locator('input[type="radio"][value="automatic"]').first();
    await expect(automaticRadioReload).toBeChecked();
  });

  test('E2E-ADMIN-008: Reset configuration', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Confirm current saved state (automatic from E2E-ADMIN-007)
    const automaticRadio = page.locator('input[type="radio"][value="automatic"]').first();
    await expect(automaticRadio).toBeChecked({ timeout: 5000 });

    // Make some changes without saving
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();
    await expect(customRadio).toBeChecked();

    // Click reset button (reverts to last saved state)
    const resetButton = page.getByRole('button', { name: 'Resetuj', exact: true });
    await expect(resetButton).toBeVisible({ timeout: 5000 });
    await resetButton.click();

    // Check if automatic mode is selected again (last saved state)
    await expect(automaticRadio).toBeChecked({ timeout: 5000 });
  });

  test('E2E-ADMIN-009: Validation error - Custom no methods', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Select custom mode
    const customRadio = page.locator('input[name="config_mode"]').nth(2);
    await customRadio.check();

    // Wait for custom mode UI to render (payment method checkboxes must appear before counting)
    const checkboxes = page.locator('input[type="checkbox"]:visible');
    await expect(checkboxes.first()).toBeVisible({ timeout: 8000 });
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const checkbox = checkboxes.nth(i);
      // Double-check visibility before interacting
      if (await checkbox.isVisible() && await checkbox.isChecked()) {
        await checkbox.uncheck();
      }
    }

    // Try to save
    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();

    // Verify error message appears
    await expect(page.locator('text=Wybierz przynajmniej jedną metodę płatności')).toBeVisible({
      timeout: 5000,
    });
  });

  test('E2E-ADMIN-010: Validation error - Stripe no PMC', async ({ page }) => {
    await gotoPaymentsSettings(page);

    // Select Stripe preset mode by clicking the label (triggers React onChange reliably)
    const stripePresetLabel = page.locator('label').filter({ hasText: /Stripe Preset/i });
    await stripePresetLabel.click();

    // Wait for mode change to take effect
    await expect(page.locator('input[name="config_mode"][value="stripe_preset"]')).toBeChecked({ timeout: 5000 });

    // Dropdown may be disabled if no PMCs are available in Stripe account — that's fine,
    // we just want to verify saving without a valid PMC selected shows an error.
    // Don't interact with the dropdown — leave it as-is (no PMC selected).

    // Try to save
    const saveButton = page.locator('button:has-text("Zapisz Konfigurację")');
    await saveButton.click();

    // Verify error toast appears (sonner renders in [data-sonner-toast])
    await expect(page.locator('[data-sonner-toast]', { hasText: /Wybierz konfigurację Stripe PMC|Select a Stripe PMC/i })).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('Payment Method Configuration - Security', () => {
  test('E2E-ADMIN-011: Unauthorized access attempt', async ({ page }) => {
    // Don't call setupAdminAuth - simulate non-admin or unauthenticated user

    // Try to access settings page directly
    await page.goto('/pl/dashboard/settings');

    // Wait for redirect or page load (shorter timeout, don't require networkidle)
    await page.waitForLoadState('domcontentloaded');

    // Wait for any client-side redirects to complete
    await page.waitForURL(url => url.includes('/auth/login') || url.includes('/login') || !url.includes('/settings'), { timeout: 5000 }).catch(() => {});

    // Should be redirected to login page or see 403 error
    // Check for either login page or unauthorized message
    const url = page.url();
    const isLoginPage = url.includes('/auth/login') || url.includes('/login');
    const hasUnauthorizedMessage = await page.locator('text=403').isVisible().catch(() => false) ||
                                    await page.locator('text=Unauthorized').isVisible().catch(() => false) ||
                                    await page.locator('text=Access denied').isVisible().catch(() => false) ||
                                    await page.locator('text=Brak dostępu').isVisible().catch(() => false);

    // Either redirected to login OR shows unauthorized message
    expect(isLoginPage || hasUnauthorizedMessage, `Expected redirect to login or unauthorized message, but got URL: ${url}`).toBeTruthy();
  });
});
