/**
 * Session Expiry E2E Tests
 *
 * Verifies that when a user's session cookies are cleared (simulating token expiry):
 * 1. Dashboard redirects to login page
 * 2. API calls return 401
 * 3. Seller context is properly lost
 *
 * Bug context: After ~1h of inactivity, the access token expired but:
 * - Sidebar still showed user email (stale SSR props)
 * - SiteMenu showed "Zaloguj" (AuthContext correctly detected expiry)
 * - Product links generated /p/ (platform) instead of /s/seller/ (seller)
 *
 * Fix: DashboardLayout now uses AuthContext as single source of truth
 * and auto-redirects to /login when session expires.
 *
 * @see src/components/DashboardLayout.tsx — auto-redirect on session loss
 */

import { test, expect } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

// Seed credentials
const ADMIN_EMAIL = 'demo@sellf.app';
const ADMIN_PASSWORD = 'demo123';
const SELLER_EMAIL = 'kowalski@demo.sellf.app';
const SELLER_PASSWORD = 'demo1234';

async function loginViaSession(page: import('@playwright/test').Page, email: string, password: string) {
  await acceptAllCookies(page);
  await setAuthSession(page, email, password);
}

test.describe('Session expiry — dashboard protection', () => {

  test('unauthenticated user cannot access dashboard', async ({ page }) => {
    await page.goto('/en/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('unauthenticated user cannot access products page', async ({ page }) => {
    await page.goto('/en/dashboard/products');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('clearing cookies while on dashboard triggers redirect to login on next navigation', async ({ page }) => {
    // 1. Login as admin via session injection
    await loginViaSession(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // 2. Verify we're on dashboard
    expect(page.url()).toContain('/dashboard');

    // 3. Clear all cookies (simulates session expiry)
    await page.context().clearCookies();

    // 4. Navigate within dashboard — proxy should catch expired session and redirect
    await page.goto('/en/dashboard/products');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});

test.describe('Session expiry — API protection', () => {

  test('v1 API rejects requests without valid session', async ({ request }) => {
    const response = await request.get('/api/v1/products');
    expect(response.status()).toBe(401);
  });

  test('v1 API rejects requests after cookie clearing', async ({ page }) => {
    // 1. Login via session injection
    await loginViaSession(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // 2. Verify API works while logged in
    const authedResponse = await page.evaluate(async () => {
      const res = await fetch('/api/v1/products', { credentials: 'include' });
      return { status: res.status };
    });
    expect(authedResponse.status).toBe(200);

    // 3. Clear cookies (simulate session expiry)
    await page.context().clearCookies();

    // 4. API call should now fail
    const expiredResponse = await page.evaluate(async () => {
      const res = await fetch('/api/v1/products', { credentials: 'include' });
      return { status: res.status };
    });
    expect(expiredResponse.status).toBe(401);
  });
});

test.describe('Session expiry — seller context', () => {

  test('after cookie clearing, dashboard redirects seller to login', async ({ page }) => {
    // 1. Login as seller via session injection
    await loginViaSession(page, SELLER_EMAIL, SELLER_PASSWORD);
    await page.goto('/en/dashboard');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toContain('/dashboard');

    // 2. Clear cookies
    await page.context().clearCookies();

    // 3. Navigate — should redirect to login
    await page.goto('/en/dashboard/products');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
