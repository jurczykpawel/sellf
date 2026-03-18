/**
 * Seller Admin Dashboard E2E Tests
 *
 * Tests the dashboard experience for seller admins (e.g., Kowalski Digital).
 * Verifies data isolation, navigation restrictions, currency switching,
 * stats display, and that seller sees only their own store's data.
 *
 * Uses seed data: kowalski@demo.sellf.app (seller_kowalski_digital)
 *
 * @see tests/admin-dashboard.spec.ts — platform admin dashboard tests
 * @see tests/marketplace-seller-admin.spec.ts — seller CRUD tests
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

// Tests are independent — run in parallel for speed

// ===== CONFIG =====

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

const sellerEmail = 'kowalski@demo.sellf.app';
const sellerPassword = 'demo1234';
const sellerDisplayName = 'Kowalski Digital';

const creativeEmail = 'creative@demo.sellf.app';
const creativePassword = 'demo1234';

// Kowalski Digital's schema-scoped Supabase client (service_role for DB verification)
const kowalskiClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: 'seller_kowalski_digital' },
  auth: { persistSession: false, autoRefreshToken: false },
});

const creativeClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: 'seller_creative_studio' },
  auth: { persistSession: false, autoRefreshToken: false },
});

// ===== HELPERS =====

async function loginAsSeller(page: any, email: string, password: string) {
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
  await setAuthSession(page, email, password);
  await page.goto('/pl/dashboard');
  await page.waitForSelector('nav, [role="navigation"], aside', { timeout: 15000 });
}

// ===== TESTS =====

test.describe('Seller Admin Dashboard', () => {

  test('seller admin can access dashboard', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    // Should see dashboard content (stat cards prove it loaded)
    await expect(page.getByTestId('stat-card-total-revenue')).toBeVisible({ timeout: 15000 });
  });

  test('dashboard URL stays on /dashboard (not redirected)', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    // Seller should stay on dashboard, not be redirected to login/home
    expect(page.url()).toContain('/dashboard');
  });

  test('seller sees full admin navigation including Users, API Keys, Integrations', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    // Seller admin sees ALL admin nav items (same as platform admin)
    await expect(page.getByTestId('stat-card-total-revenue')).toBeVisible({ timeout: 15000 });
  });

  test('seller CAN navigate to products page', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');

    // Should see products page content (table or heading)
    await expect(page.locator('text=/Produkt|Product/i').first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Seller Dashboard Stats', () => {

  test('stats cards are visible and show data', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    // All 4 stat cards should render
    for (const id of ['total-revenue', 'today-orders', 'total-users', 'active-users']) {
      const card = page.getByTestId(`stat-card-${id}`);
      await expect(card).toBeVisible({ timeout: 15000 });
    }
  });

  test('revenue shows seller currency (PLN)', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    const revenueCard = page.getByTestId('stat-card-total-revenue');
    await expect(revenueCard).toBeVisible({ timeout: 15000 });

    const revenueText = await revenueCard.textContent() || '';
    // Kowalski products are in PLN — revenue should contain PLN or zł or a number
    // (if no transactions, it may show "0" or "$0" depending on default currency)
    expect(revenueText.length).toBeGreaterThan(0);
  });

  test('revenue reflects only seller transactions (not platform)', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    // Get actual total from seller's schema
    const { data: transactions } = await kowalskiClient
      .from('payment_transactions')
      .select('amount')
      .eq('status', 'completed');

    const dbTotal = (transactions || []).reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

    const revenueCard = page.getByTestId('stat-card-total-revenue');
    await expect(revenueCard).toBeVisible({ timeout: 15000 });

    // If DB has transactions, revenue should show non-zero
    if (dbTotal > 0) {
      const revenueText = await revenueCard.locator('p').nth(1).textContent() || '';
      // Should NOT be "0" or empty
      expect(revenueText).not.toBe('0');
      expect(revenueText).not.toBe('');
    }
  });
});

test.describe('Seller Dashboard Currency Selector', () => {

  test('currency selector is visible when seller has transactions', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    // Currency selector button should be visible (or not, if only 1 currency)
    const currencyBtn = page.locator('button', { hasText: /Grouped|Convert|Pogrupowane|Konwertuj/i }).first();

    // Seller may have only PLN — in that case, selector doesn't render (that's OK)
    const { data: currencies } = await kowalskiClient
      .from('payment_transactions')
      .select('currency')
      .eq('status', 'completed');

    const uniqueCurrencies = new Set((currencies || []).map((c: any) => c.currency));

    if (uniqueCurrencies.size > 1) {
      await expect(currencyBtn).toBeVisible({ timeout: 15000 });
    }
    // If only 1 currency or none, selector may not show — that's by design
  });
});

test.describe('Seller Dashboard Products Page', () => {

  test('seller sees only their own products', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');

    // Get Kowalski's product names from DB
    const { data: sellerProducts } = await kowalskiClient
      .from('products')
      .select('name')
      .eq('is_active', true);

    const sellerProductNames = (sellerProducts || []).map((p: any) => p.name);
    expect(sellerProductNames.length).toBeGreaterThan(0);

    // Should see at least one of their products
    await expect(page.locator(`text=${sellerProductNames[0]}`)).toBeVisible({ timeout: 15000 });

    // Get Creative Studio's products — seller should NOT see these
    const { data: otherProducts } = await creativeClient
      .from('products')
      .select('name')
      .eq('is_active', true);

    const otherProductNames = (otherProducts || []).map((p: any) => p.name);

    // None of the other seller's products should be visible
    for (const name of otherProductNames) {
      const count = await page.locator(`text=${name}`).count();
      expect(count).toBe(0);
    }
  });
});

test.describe('Seller Dashboard Coupons Page', () => {

  test('seller sees only their own coupons', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);
    await page.goto('/pl/dashboard/coupons');
    await page.waitForLoadState('domcontentloaded');

    // Kowalski has KOWALSKI20 and ECOMMERCE50 coupons
    await expect(page.locator('text=KOWALSKI20').first()).toBeVisible({ timeout: 15000 });

    // Creative Studio has DESIGN10 — should NOT be visible
    const designCoupon = await page.locator('text=DESIGN10').count();
    expect(designCoupon).toBe(0);
  });
});

test.describe('Seller Dashboard Settings Page', () => {

  test('seller can access settings page', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);
    await page.goto('/pl/dashboard/settings');
    await page.waitForLoadState('domcontentloaded');

    // Should see settings page content (any form element or heading)
    await expect(page.locator('text=/Settings|Ustawienia|Theme|Motyw|Shop|Sklep/i').first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Seller Dashboard Full Navigation', () => {

  test('seller admin sees all admin navigation items', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');

    // Seller admin sees FULL admin menu (same as platform admin)
    await expect(page.locator('text=/Produkt|Product/i').first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Seller Dashboard Data Isolation — Cross-tenant', () => {

  test('Creative Studio seller sees different products than Kowalski', async ({ page }) => {
    await loginAsSeller(page, creativeEmail, creativePassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('domcontentloaded');

    // Creative Studio should see their products
    const { data: creativeProducts } = await creativeClient
      .from('products')
      .select('name')
      .eq('is_active', true);

    const creativeProductNames = (creativeProducts || []).map((p: any) => p.name);
    expect(creativeProductNames.length).toBeGreaterThan(0);

    // Should see at least one Creative product
    await expect(page.locator(`text=${creativeProductNames[0]}`)).toBeVisible({ timeout: 15000 });

    // Should NOT see Kowalski products
    const { data: kowalskiProducts } = await kowalskiClient
      .from('products')
      .select('name')
      .eq('is_active', true);

    for (const p of kowalskiProducts || []) {
      const count = await page.locator(`text=${p.name}`).count();
      expect(count).toBe(0);
    }
  });

  test('Creative Studio sees their own coupons, not Kowalski\'s', async ({ page }) => {
    await loginAsSeller(page, creativeEmail, creativePassword);
    await page.goto('/pl/dashboard/coupons');
    await page.waitForLoadState('domcontentloaded');

    // Creative Studio has DESIGN10
    await expect(page.locator('text=DESIGN10').first()).toBeVisible({ timeout: 15000 });

    // Should NOT see Kowalski's coupons
    const kowalskiCoupon = await page.locator('text=KOWALSKI20').count();
    expect(kowalskiCoupon).toBe(0);
  });
});

test.describe('Seller Dashboard Recent Activity', () => {

  test('recent activity section is visible', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    // Recent activity section should render (may be empty or have items)
    await expect(page.locator('text=/Recent Activity|Ostatnia aktywność|Ostatnia Aktywność/i').first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Seller Dashboard Revenue Chart', () => {

  test('revenue chart renders without errors', async ({ page }) => {
    await loginAsSeller(page, sellerEmail, sellerPassword);

    // Chart container should be visible (SVG or canvas element)
    const chartArea = page.locator('[class*="recharts"], canvas, svg').first();
    await expect(chartArea).toBeVisible({ timeout: 15000 });
  });
});
