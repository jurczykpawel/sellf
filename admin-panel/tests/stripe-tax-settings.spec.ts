/**
 * E2E Tests: Stripe Tax Settings (Admin UI)
 *
 * Tests the StripeTaxSettings component on /dashboard/settings page.
 * Covers: automatic tax toggle, tax ID collection toggle, billing address,
 * session expires hours (with clamping), collect terms toggle.
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

    await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const supabase = createBrowserClient(supabaseUrl, anonKey);
      await supabase.auth.signInWithPassword({ email, password });
    }, {
      email: adminEmail,
      password,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
    });

    await page.waitForTimeout(1000);
  };

  /** Navigate to settings and return the Stripe Tax section container */
  async function goToStripeTaxSection(page: Page) {
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const heading = page.locator('h2', { hasText: /Stripe Tax|Tax/i }).first();
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
      .select('id, automatic_tax_enabled, tax_id_collection_enabled, checkout_billing_address, checkout_expires_hours, checkout_collect_terms')
      .single();

    if (config) {
      shopConfigId = config.id;
      originalFields = {
        automatic_tax_enabled: config.automatic_tax_enabled,
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
        automatic_tax_enabled: null,
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

  test('should display all 5 checkout configuration fields', async ({ page }) => {
    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // 3 toggles within the Stripe Tax section: automatic tax, tax ID, collect terms
    const toggles = section.locator('button[role="switch"]');
    const toggleCount = await toggles.count();
    expect(toggleCount).toBeGreaterThanOrEqual(3);

    // Billing address buttons: "Auto" and "Required"
    await expect(section.locator('button', { hasText: /auto/i }).first()).toBeVisible();
    await expect(section.locator('button', { hasText: /required/i }).first()).toBeVisible();

    // Session expires hours input
    await expect(section.locator('input[type="number"][min="1"][max="168"]')).toBeVisible();
  });

  test('should toggle automatic tax and persist in DB', async ({ page }) => {
    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // First toggle within Stripe Tax section = Automatic Tax
    const firstToggle = section.locator('button[role="switch"]').first();

    // Get current state
    const initialState = await firstToggle.getAttribute('aria-checked');

    // Click to toggle
    await firstToggle.click();
    await page.waitForTimeout(2000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('shop_config')
      .select('automatic_tax_enabled')
      .eq('id', shopConfigId)
      .single();

    const expectedValue = initialState !== 'true';
    expect(config!.automatic_tax_enabled).toBe(expectedValue);

    // Verify UI updated
    const newState = await firstToggle.getAttribute('aria-checked');
    expect(newState).toBe(String(expectedValue));
  });

  test('should toggle tax ID collection and persist in DB', async ({ page }) => {
    // Set known state: automatic_tax = true (to distinguish from first toggle)
    await supabaseAdmin
      .from('shop_config')
      .update({
        automatic_tax_enabled: true,
        tax_id_collection_enabled: false,
      })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // Second toggle within Stripe Tax section = Tax ID Collection
    const secondToggle = section.locator('button[role="switch"]').nth(1);

    // Should be OFF initially (false)
    await expect(secondToggle).toHaveAttribute('aria-checked', 'false');

    // Click to enable
    await secondToggle.click();
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

    // Click "Required" button (billing address segment control) within Stripe Tax section
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
        automatic_tax_enabled: true,
        tax_id_collection_enabled: true,
        checkout_collect_terms: false,
      })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    const section = await goToStripeTaxSection(page);

    // Third toggle within Stripe Tax section = Collect Terms
    const thirdToggle = section.locator('button[role="switch"]').nth(2);

    // Should be OFF (false)
    await expect(thirdToggle).toHaveAttribute('aria-checked', 'false');

    // Click to enable
    await thirdToggle.click();
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
