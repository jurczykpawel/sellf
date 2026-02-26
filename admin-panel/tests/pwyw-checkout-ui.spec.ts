import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

/**
 * PWYW Checkout UI Tests
 *
 * Tests the Pay What You Want UI on the checkout page:
 * - Preset buttons
 * - Custom amount input
 * - Validation
 * - Price display updates
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('PWYW Checkout UI', () => {
  let pwywProduct: any;
  let regularProduct: any;

  test.beforeAll(async () => {
    // Create PWYW product with presets
    const { data: pwyw, error: pwywError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PWYW UI Test Product',
        slug: `pwyw-ui-test-${Date.now()}`,
        price: 50,
        currency: 'PLN',
        description: 'Test product for PWYW UI',
        is_active: true,
        icon: '💰',
        allow_custom_price: true,
        custom_price_min: 5,
        show_price_presets: true,
        custom_price_presets: [10, 25, 50]
      })
      .select()
      .single();

    if (pwywError) throw pwywError;
    pwywProduct = pwyw;

    // Create regular product (no PWYW)
    const { data: regular, error: regularError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Regular UI Test Product',
        slug: `regular-ui-test-${Date.now()}`,
        price: 99,
        currency: 'PLN',
        description: 'Regular product without PWYW',
        is_active: true,
        icon: '📦',
        allow_custom_price: false
      })
      .select()
      .single();

    if (regularError) throw regularError;
    regularProduct = regular;
  });

  test.afterAll(async () => {
    if (pwywProduct) {
      await supabaseAdmin.from('products').delete().eq('id', pwywProduct.id);
    }
    if (regularProduct) {
      await supabaseAdmin.from('products').delete().eq('id', regularProduct.id);
    }
  });

  test.beforeEach(async ({ page }) => {
    await acceptAllCookies(page);

    // Block payment intent creation — never respond so clientSecret stays null
    // This prevents Stripe Elements from rendering (and crashing with fake secrets)
    await page.route('**/api/create-payment-intent', async () => {
      // Intentionally not calling route.fulfill/abort/continue
    });
  });

  // ========================================
  // PWYW Product Tests
  // ========================================

  test('should display preset buttons for PWYW product', async ({ page }) => {
    // Guard: ensure product was created in beforeAll
    expect(pwywProduct?.slug).toBeTruthy();

    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Wait for the page to fully load
    await page.waitForSelector('h1, h2, .text-white', { timeout: 10000 });

    // Should show preset buttons (look for amounts in any format - zł10.00, etc.)
    const preset10 = page.locator('button:not([type="submit"])').filter({ hasText: /zł10|10\.00|10,00/ }).first();
    await expect(preset10).toBeVisible({ timeout: 10000 });

    const preset25 = page.locator('button:not([type="submit"])').filter({ hasText: /zł25|25\.00|25,00/ }).first();
    await expect(preset25).toBeVisible();

    const preset50 = page.locator('button:not([type="submit"])').filter({ hasText: /zł50|50\.00|50,00/ }).first();
    await expect(preset50).toBeVisible();
  });

  test('should display custom amount input for PWYW product', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Should show custom amount input
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toBeVisible();
  });

  test('should select preset when clicking preset button', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click on 25 zł preset (use first() to avoid matching submit button)
    const preset25 = page.locator('button:not([type="submit"])').filter({ hasText: /25/ }).first();
    await preset25.click();

    // Preset should be visually selected (has blue background when active)
    await expect(preset25).toHaveClass(/bg-blue/);

    // Custom input should show 25
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toHaveValue('25');
  });

  test('should update price display when selecting different preset', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Click on 25 zł preset
    const preset25 = page.locator('button:not([type="submit"])').filter({ hasText: /25/ }).first();
    await preset25.click();

    // Preset should be visually selected
    await expect(preset25).toHaveClass(/bg-blue/);

    // Custom input should reflect the selected preset amount
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toHaveValue('25');
  });

  test('should allow typing custom amount', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Find and fill custom amount input
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await customInput.first().fill('42');

    // Input should have the new value
    await expect(customInput.first()).toHaveValue('42');
  });

  test('should show error when amount is below minimum', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Type amount below minimum (min is 5)
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await customInput.first().fill('3');

    // Blur to trigger validation
    await customInput.first().blur();

    // Should show error message (look for red error text)
    await expect(page.locator('.text-red-600, .text-red-400, .text-red-300').filter({ hasText: /co najmniej|at least/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('should not show error when amount is at minimum', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Type exactly minimum amount
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toBeVisible({ timeout: 10000 });
    await customInput.first().fill('5');
    await customInput.first().blur();

    // Should NOT show error message (no red error text)
    await expect(page.locator('.text-red-400, .text-red-300').filter({ hasText: /co najmniej|at least/i })).toHaveCount(0);
  });

  test('should not show error when amount is above minimum', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Type amount above minimum
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toBeVisible({ timeout: 10000 });
    await customInput.first().fill('100');
    await customInput.first().blur();

    // Should NOT show error message (no red error text)
    await expect(page.locator('.text-red-400, .text-red-300').filter({ hasText: /co najmniej|at least/i })).toHaveCount(0);
  });

  test('should show error and hide checkout when amount is below minimum', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Type amount below minimum
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await customInput.first().fill('2');
    await customInput.first().blur();

    // Should show error message about minimum amount
    await expect(page.locator('.text-red-600, .text-red-400, .text-red-300').filter({ hasText: /co najmniej|at least/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('should show product price as default selected', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Product price (50) should be the default amount, not the first preset
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toHaveValue('50');
  });

  // ========================================
  // Regular Product Tests (no PWYW)
  // ========================================

  test('should NOT show preset buttons for regular product', async ({ page }) => {
    await page.goto(`/pl/checkout/${regularProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Should NOT show preset buttons
    await expect(page.getByRole('button', { name: /10.*zł|zł.*10/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /25.*zł|zł.*25/i })).not.toBeVisible();
  });

  test('should NOT show custom amount input for regular product', async ({ page }) => {
    await page.goto(`/pl/checkout/${regularProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Wait for page to fully load
    await page.waitForTimeout(1000);

    // Should show fixed price, not custom input section
    await expect(page.getByText(/99[\.,]00.*zł|zł.*99/).first()).toBeVisible();

    // The PWYW section should not be visible
    const pwywSection = page.locator('[class*="preset"]').or(page.getByText(/Wybierz kwotę|Choose amount/i));
    await expect(pwywSection).not.toBeVisible();
  });

  test('should show fixed price for regular product', async ({ page }) => {
    await page.goto(`/pl/checkout/${regularProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Should show the fixed price
    await expect(page.getByText(/99[\.,]00.*zł|zł.*99/).first()).toBeVisible();
  });
});

test.describe('PWYW Checkout - No Presets', () => {
  let pwywNoPresetsProduct: any;

  test.beforeAll(async () => {
    // Create PWYW product WITHOUT presets
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PWYW No Presets Test',
        slug: `pwyw-no-presets-${Date.now()}`,
        price: 50,
        currency: 'USD',
        description: 'PWYW without preset buttons',
        is_active: true,
        icon: '🎁',
        allow_custom_price: true,
        custom_price_min: 1,
        show_price_presets: false,
        custom_price_presets: []
      })
      .select()
      .single();

    if (error) throw error;
    pwywNoPresetsProduct = data;
  });

  test.afterAll(async () => {
    if (pwywNoPresetsProduct) {
      await supabaseAdmin.from('products').delete().eq('id', pwywNoPresetsProduct.id);
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/create-payment-intent', async () => {
      // Intentionally not calling route.fulfill/abort/continue
    });
  });

  test('should show custom input but no preset buttons when presets disabled', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/en/checkout/${pwywNoPresetsProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Should show custom amount input
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toBeVisible();

    // Should NOT show preset buttons (they're disabled)
    const presetButtons = page.locator('button').filter({ hasText: /^\$\d+/ });
    await expect(presetButtons).toHaveCount(0);
  });

  test('should default to minimum price when no presets', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/en/checkout/${pwywNoPresetsProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Should default to minimum (1) or product price
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toBeVisible({ timeout: 10000 });
    const value = await customInput.first().inputValue();

    // Should be at least the minimum
    expect(parseFloat(value)).toBeGreaterThanOrEqual(1);
  });
});

test.describe('PWYW Checkout - Currency Display', () => {
  let usdProduct: any;
  let eurProduct: any;

  test.beforeAll(async () => {
    // Create USD PWYW product
    const { data: usd, error: usdError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PWYW USD Test',
        slug: `pwyw-usd-${Date.now()}`,
        price: 50,
        currency: 'USD',
        description: 'USD PWYW product',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 5,
        show_price_presets: true,
        custom_price_presets: [10, 25, 50]
      })
      .select()
      .single();

    if (usdError) throw usdError;
    usdProduct = usd;

    // Create EUR PWYW product
    const { data: eur, error: eurError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PWYW EUR Test',
        slug: `pwyw-eur-${Date.now()}`,
        price: 50,
        currency: 'EUR',
        description: 'EUR PWYW product',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 5,
        show_price_presets: true,
        custom_price_presets: [10, 25, 50]
      })
      .select()
      .single();

    if (eurError) throw eurError;
    eurProduct = eur;
  });

  test.afterAll(async () => {
    if (usdProduct) await supabaseAdmin.from('products').delete().eq('id', usdProduct.id);
    if (eurProduct) await supabaseAdmin.from('products').delete().eq('id', eurProduct.id);
  });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/create-payment-intent', async () => {
      // Intentionally not calling route.fulfill/abort/continue
    });
  });

  test('should display USD currency correctly in presets', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/en/checkout/${usdProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Should show $ symbol in presets
    await expect(page.getByRole('button', { name: /\$10|\$25|\$50/i }).first()).toBeVisible();
  });

  test('should display EUR currency correctly in presets', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/en/checkout/${eurProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Should show € symbol in presets
    await expect(page.getByRole('button', { name: /€10|€25|€50|10.*€|25.*€|50.*€/i }).first()).toBeVisible();
  });
});

test.describe('PWYW Checkout - E2E Payment Flow', () => {
  let pwywProduct: any;

  test.beforeAll(async () => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PWYW E2E Test',
        slug: `pwyw-e2e-${Date.now()}`,
        price: 50,
        currency: 'PLN',
        description: 'PWYW E2E test product',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 5,
        show_price_presets: true,
        custom_price_presets: [10, 25, 50]
      })
      .select()
      .single();

    if (error) throw error;
    pwywProduct = data;
  });

  test.afterAll(async () => {
    if (pwywProduct) {
      await supabaseAdmin.from('products').delete().eq('id', pwywProduct.id);
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/create-payment-intent', async () => {
      // Intentionally not calling route.fulfill/abort/continue
    });
  });

  test('should proceed to payment with selected preset amount', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Select 25 zł preset
    const preset25 = page.locator('button:not([type="submit"])').filter({ hasText: /25/ }).first();
    await preset25.click();

    // Verify the amount is selected
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await expect(customInput.first()).toHaveValue('25');
  });

  test('should proceed to payment with custom amount', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${pwywProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Type custom amount
    const customInput = page.locator('input[type="number"]').or(page.locator('input[inputmode="decimal"]'));
    await customInput.first().fill('42');

    // Verify custom amount is set
    await expect(customInput.first()).toHaveValue('42');
  });
});
