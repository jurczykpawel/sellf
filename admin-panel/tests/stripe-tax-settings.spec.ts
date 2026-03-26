/**
 * E2E Tests: Stripe Tax Settings (Admin UI)
 *
 * Tests the StripeTaxSettings component on /dashboard/settings page.
 * Covers: tax mode selector (local/stripe_tax), default VAT rate input,
 * tax ID collection toggle, billing address, session expires hours (with clamping),
 * collect terms toggle.
 *
 * Unit tests for the config resolution logic (DB > env > default) are in:
 * @see admin-panel/tests/unit/checkout-tax-config.test.ts
 *
 * This file tests the admin UI interaction + DB persistence.
 *
 * @see admin-panel/src/components/settings/StripeTaxSettings.tsx
 * @see admin-panel/src/lib/actions/shop-config.ts
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

test.describe('Stripe Tax Settings Admin UI', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  const password = 'password123';
  let shopConfigId: string;
  let originalFields: Record<string, unknown> | null = null;

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

  /** Navigate to settings → Payments tab and return the Tax & Checkout section container */
  async function goToStripeTaxSection(page: Page) {
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('domcontentloaded');
    // Payments tab: wait for React hydration (can be slow under full-suite pressure)
    const paymentsTab = page.getByRole('button', { name: /^Payments$|^Płatności$/i });
    await expect(paymentsTab).toBeVisible({ timeout: 20000 });
    await paymentsTab.click();

    const heading = page.locator('h2', { hasText: /Tax & Checkout|Stripe Tax|Tax/i }).first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    // h2 → div → div.flex → div.card (section container)
    const section = heading.locator('../../..');
    return section;
  }

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-stripe-tax-${Date.now()}-${randomStr}@example.com`;

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

    // Save original fields
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('id, tax_mode, tax_rate, tax_id_collection_enabled, checkout_billing_address, checkout_expires_hours, checkout_collect_terms')
      .single();

    if (config) {
      shopConfigId = config.id;
      originalFields = {
        tax_mode: config.tax_mode,
        tax_rate: config.tax_rate,
        tax_id_collection_enabled: config.tax_id_collection_enabled,
        checkout_billing_address: config.checkout_billing_address,
        checkout_expires_hours: config.checkout_expires_hours,
        checkout_collect_terms: config.checkout_collect_terms,
      };
    }
  });

  test.beforeEach(async () => {
    // Reset to known state before each test
    await supabaseAdmin
      .from('shop_config')
      .update({
        tax_mode: 'local',
        tax_id_collection_enabled: null,
        checkout_billing_address: null,
        checkout_expires_hours: null,
        checkout_collect_terms: null,
      })
      .eq('id', shopConfigId);
  });

  test.afterAll(async () => {
    // Restore original values
    if (shopConfigId && originalFields) {
      await supabaseAdmin
        .from('shop_config')
        .update(originalFields)
        .eq('id', shopConfigId);
    }

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

  test('should display tax mode selector and checkout configuration fields', async ({ page }) => {
    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // Tax mode selector: "Fixed Rate" and "Stripe Tax" buttons
    await expect(section.locator('button', { hasText: /Fixed Rate|Stała stawka/i }).first()).toBeVisible();
    await expect(section.locator('button', { hasText: /Stripe Tax/i }).first()).toBeVisible();

    // 2 toggles: tax ID collection, collect terms (automatic_tax toggle was replaced by mode selector)
    const toggles = section.locator('button[role="switch"]');
    const toggleCount = await toggles.count();
    expect(toggleCount).toBeGreaterThanOrEqual(2);

    // Billing address buttons: "Auto" and "Required"
    await expect(section.locator('button', { hasText: /auto/i }).first()).toBeVisible();
    await expect(section.locator('button', { hasText: /required/i }).first()).toBeVisible();

    // Session expires hours input
    await expect(section.locator('input[type="number"][min="1"][max="168"]')).toBeVisible();
  });

  test('should switch tax mode to stripe_tax and persist in DB', async ({ page }) => {
    // Start in local mode
    await supabaseAdmin
      .from('shop_config')
      .update({ tax_mode: 'local' })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // Click "Stripe Tax" button
    const stripeTaxBtn = section.locator('button', { hasText: /Stripe Tax/i }).first();
    await stripeTaxBtn.click();
    await page.waitForTimeout(2000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('tax_mode')
      .eq('id', shopConfigId)
      .single();

    expect(config!.tax_mode).toBe('stripe_tax');
  });

  test('should switch tax mode to local and persist in DB', async ({ page }) => {
    // Start in stripe_tax mode
    await supabaseAdmin
      .from('shop_config')
      .update({ tax_mode: 'stripe_tax' })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // Click "Fixed Rate" button
    const localBtn = section.locator('button', { hasText: /Fixed Rate|Stała stawka/i }).first();
    await localBtn.click();
    await page.waitForTimeout(2000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('tax_mode')
      .eq('id', shopConfigId)
      .single();

    expect(config!.tax_mode).toBe('local');
  });

  test('should show default VAT rate input in local mode', async ({ page }) => {
    await supabaseAdmin
      .from('shop_config')
      .update({ tax_mode: 'local', tax_rate: 0.23 })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // VAT rate input should be visible in local mode
    const vatInput = section.locator('input#default-vat-rate');
    await expect(vatInput).toBeVisible();
    await expect(vatInput).toHaveValue('23');
  });

  test('should hide VAT rate input in stripe_tax mode', async ({ page }) => {
    await supabaseAdmin
      .from('shop_config')
      .update({ tax_mode: 'stripe_tax' })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // VAT rate input should NOT be visible in stripe_tax mode
    const vatInput = section.locator('input#default-vat-rate');
    await expect(vatInput).not.toBeVisible();
  });

  test('should update default VAT rate on blur and persist in DB', async ({ page }) => {
    await supabaseAdmin
      .from('shop_config')
      .update({ tax_mode: 'local', tax_rate: null })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    const vatInput = section.locator('input#default-vat-rate');
    await vatInput.fill('8');
    await vatInput.blur();
    await page.waitForTimeout(2000);

    // DB should store 0.08 (decimal)
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('tax_rate')
      .eq('id', shopConfigId)
      .single();

    expect(Number(config!.tax_rate)).toBeCloseTo(0.08, 2);
  });

  test('should toggle tax ID collection and persist in DB', async ({ page }) => {
    await supabaseAdmin
      .from('shop_config')
      .update({
        tax_id_collection_enabled: false,
      })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // First toggle = Tax ID Collection (automatic_tax toggle was removed)
    const firstToggle = section.locator('button[role="switch"]').first();

    // Should be OFF initially (false)
    await expect(firstToggle).toHaveAttribute('aria-checked', 'false');

    // Click to enable
    await firstToggle.click();
    await page.waitForTimeout(2000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('tax_id_collection_enabled')
      .eq('id', shopConfigId)
      .single();

    expect(config!.tax_id_collection_enabled).toBe(true);
  });

  test('should change billing address to required', async ({ page }) => {
    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // Click "Required" button (billing address segment control) within section
    const requiredBtn = section.locator('button', { hasText: /required/i }).first();
    await requiredBtn.click();
    await page.waitForTimeout(2000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('checkout_billing_address')
      .eq('id', shopConfigId)
      .single();

    expect(config!.checkout_billing_address).toBe('required');
  });

  test('should update session expires hours on blur', async ({ page }) => {
    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    const hoursInput = section.locator('input[type="number"][min="1"][max="168"]');
    await hoursInput.fill('48');

    // Trigger blur (save happens on blur)
    await hoursInput.blur();
    await page.waitForTimeout(2000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('checkout_expires_hours')
      .eq('id', shopConfigId)
      .single();

    expect(config!.checkout_expires_hours).toBe(48);
  });

  test('should clamp expires hours to valid range (1-168)', async ({ page }) => {
    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    const hoursInput = section.locator('input[type="number"][min="1"][max="168"]');

    // Enter value above max
    await hoursInput.fill('999');
    await hoursInput.blur();
    await page.waitForTimeout(2000);

    // DB should have clamped value (168)
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('checkout_expires_hours')
      .eq('id', shopConfigId)
      .single();

    expect(config!.checkout_expires_hours).toBe(168);
  });

  test('should toggle collect terms of service', async ({ page }) => {
    // Set known state
    await supabaseAdmin
      .from('shop_config')
      .update({
        tax_id_collection_enabled: true,
        checkout_collect_terms: false,
      })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // Second toggle = Collect Terms (was third before automatic_tax toggle removal)
    const secondToggle = section.locator('button[role="switch"]').nth(1);

    // Should be OFF (false)
    await expect(secondToggle).toHaveAttribute('aria-checked', 'false');

    // Click to enable
    await secondToggle.click();
    await page.waitForTimeout(2000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('checkout_collect_terms')
      .eq('id', shopConfigId)
      .single();

    expect(config!.checkout_collect_terms).toBe(true);
  });
});
