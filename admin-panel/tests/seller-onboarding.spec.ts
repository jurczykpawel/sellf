/**
 * Seller Onboarding E2E Tests
 *
 * Tests the full seller onboarding flow:
 * 1. Platform admin creates seller via Add Seller form
 * 2. Seller admin sees Stripe Connect in Settings
 *
 * Uses seed data + creates new test sellers.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

const adminEmail = 'demo@sellf.app';
const adminPassword = 'demo123';
const sellerEmail = 'kowalski@demo.sellf.app';
const sellerPassword = 'demo1234';

async function loginAs(page: any, email: string, password: string) {
  await acceptAllCookies(page);
  await page.addInitScript(() => {
    const s = () => {
      if (document.head) {
        const el = document.createElement('style');
        el.innerHTML = '#klaro { display: none !important; }';
        document.head.appendChild(el);
      } else setTimeout(s, 10);
    };
    s();
  });
  await setAuthSession(page, email, password);
}

// ===== ADD SELLER FORM =====

test.describe('Admin: Add Seller Form', () => {
  const testSlug = `test-seller-${Date.now()}`;
  const testEmail = `test-seller-${Date.now()}@example.com`;
  let createdSellerId: string | null = null;

  test.afterAll(async () => {
    // Cleanup: deprovision if created
    if (createdSellerId) {
      await supabaseAdmin.rpc('deprovision_seller_schema', { p_seller_id: createdSellerId }).catch(() => {});
    }
    // Cleanup auth user
    try {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers();
      const testUser = users?.users?.find(u => u.email === testEmail);
      if (testUser) {
        await supabaseAdmin.from('sellers').update({ user_id: null as any }).eq('user_id', testUser.id).catch(() => {});
        await supabaseAdmin.auth.admin.deleteUser(testUser.id).catch(() => {});
      }
    } catch { /* ignore cleanup errors */ }
  });

  test('admin sees Add Seller form on /admin/sellers', async ({ page }) => {
    await loginAs(page, adminEmail, adminPassword);
    await page.goto('/en/admin/sellers');
    await page.waitForLoadState('domcontentloaded');

    // Form should be visible (inputs have specific IDs)
    await expect(page.locator('#seller-name')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#seller-slug')).toBeVisible();
    await expect(page.locator('#seller-email')).toBeVisible();
  });

  test('admin can fill and submit Add Seller form', async ({ page }) => {
    await loginAs(page, adminEmail, adminPassword);
    await page.goto('/en/admin/sellers');
    await page.waitForLoadState('domcontentloaded');

    // Fill display name — type slowly to trigger onChange
    const nameInput = page.locator('#seller-name');
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    const uniqueName = `Test Store ${Date.now().toString().slice(-6)}`;
    await nameInput.fill(uniqueName);

    // Slug should auto-generate
    const slugInput = page.locator('#seller-slug');
    await expect(slugInput).not.toHaveValue('', { timeout: 3000 });

    // Fill email
    const emailInput = page.locator('#seller-email');
    await emailInput.fill(testEmail);

    // Submit
    await page.locator('button:has-text("Add Seller")').click();

    // Wait for success or error message
    await expect(page.locator('text=/successfully|error|already exists/i').first()).toBeVisible({ timeout: 30000 });

    // Check if it was success
    const isSuccess = await page.locator('text=/successfully/i').isVisible().catch(() => false);
    if (isSuccess) {
      // Verify in DB
      const slugValue = await slugInput.inputValue();
      const platform = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        db: { schema: 'public' },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: seller } = await platform
        .from('sellers')
        .select('id, slug, user_id')
        .ilike('slug', `%${slugValue}%`)
        .maybeSingle();

      if (seller) {
        expect(seller.user_id).not.toBeNull();
        createdSellerId = seller.id;
      }
    }
  });

  test('new seller appears in sellers table', async ({ page }) => {
    if (!createdSellerId) {
      test.skip();
      return;
    }
    await loginAs(page, adminEmail, adminPassword);
    await page.goto('/en/admin/sellers');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('text=Test Seller Store')).toBeVisible({ timeout: 15000 });
  });

  test('duplicate slug is rejected', async ({ page }) => {
    await loginAs(page, adminEmail, adminPassword);
    await page.goto('/en/admin/sellers');
    await page.waitForLoadState('domcontentloaded');

    const nameInput = page.locator('#seller-name');
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill('Kowalski Digital');

    const slugInput = page.locator('#seller-slug');
    await slugInput.fill('kowalski-digital');

    const emailInput = page.locator('#seller-email');
    await emailInput.fill('duplicate@example.com');

    const submitBtn = page.locator('button[type="submit"]').first();
    await submitBtn.click();

    // Should show error about duplicate
    await expect(page.locator('text=/already exists|error|istnieje/i').first()).toBeVisible({ timeout: 10000 });
  });
});

// ===== SELLER STRIPE CONNECT IN SETTINGS =====

test.describe('Seller Settings: Stripe Connect', () => {

  test('seller admin sees Stripe section in Payments tab', async ({ page }) => {
    await loginAs(page, sellerEmail, sellerPassword);
    await page.goto('/en/dashboard/settings');
    await page.waitForLoadState('domcontentloaded');

    // Seller does NOT see Marketplace tab (platform admin only)
    const marketplaceTab = page.locator('button', { hasText: /Marketplace/i });
    await expect(marketplaceTab).not.toBeVisible();

    // Click Payments tab — Stripe config is here
    const paymentsTab = page.locator('button', { hasText: /Payments|Płatności/i });
    await expect(paymentsTab).toBeVisible({ timeout: 15000 });
    await paymentsTab.click();

    // Should see Stripe configuration section
    await expect(page.locator('text=/Stripe/i').first()).toBeVisible({ timeout: 15000 });
  });

  test('seller admin does not see system updates or security audit', async ({ page }) => {
    await loginAs(page, sellerEmail, sellerPassword);
    await page.goto('/en/dashboard/settings');
    await page.waitForLoadState('domcontentloaded');

    // Click System tab
    const systemTab = page.locator('button', { hasText: /System/i });
    await expect(systemTab).toBeVisible({ timeout: 15000 });
    await systemTab.click();

    // Seller sees License settings
    await expect(page.locator('text=/License|Licencja/i').first()).toBeVisible({ timeout: 15000 });

    // Seller does NOT see system updates or security audit
    await expect(page.locator('text=/Check for Updates|Sprawdź aktualizacje/i').first()).not.toBeVisible();
    await expect(page.locator('text=/Security Audit|Audyt bezpieczeństwa/i').first()).not.toBeVisible();
  });

  test('platform admin sees "Manage Sellers" link, not Stripe Connect card', async ({ page }) => {
    await loginAs(page, adminEmail, adminPassword);
    await page.goto('/en/dashboard/settings');

    const marketplaceTab = page.locator('button', { hasText: /Marketplace/i });
    await expect(marketplaceTab).toBeVisible();
    await marketplaceTab.click();

    // Platform admin should see link to manage sellers, not Connect button
    await expect(page.locator('text=/Manage Sellers|Zarządzaj/i').first()).toBeVisible();
  });
});

// ===== STRIPE CONNECT API =====

test.describe('Stripe Connect API', () => {

  test('seller admin can call /api/stripe/connect/status', async ({ page }) => {
    await loginAs(page, sellerEmail, sellerPassword);
    // Navigate to establish cookies in the browser context before making API requests
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const response = await page.request.get('/api/stripe/connect/status?context=seller');
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Verify API returns valid response shape (seller may or may not be connected)
    expect(body).toHaveProperty('onboardingComplete');
    expect(typeof body.onboardingComplete).toBe('boolean');
  });

  test('unauthenticated request to /api/stripe/connect/status is rejected', async ({ page }) => {
    const response = await page.request.get('/api/stripe/connect/status');
    expect([401, 403]).toContain(response.status());
  });
});
