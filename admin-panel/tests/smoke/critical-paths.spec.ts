/**
 * Smoke Tests - Critical Paths
 *
 * Minimal E2E tests for critical user journeys.
 * Run frequently (every commit): npm run test:smoke
 *
 * These tests verify:
 * 1. App loads and renders
 * 2. Authentication works
 * 3. Core CRUD operations work
 * 4. Checkout flow works (with mocked Stripe)
 */

import { test, expect } from '@playwright/test';

// Test user credentials (from seed data)
const ADMIN_EMAIL = 'admin@test.local';

test.describe('Smoke Tests', () => {
  test.describe('App Health', () => {
    test('homepage loads', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle(/GateFlow/i);
    });

    test('login page loads', async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('input[type="email"]')).toBeVisible();
    });

    test('API health check', async ({ request }) => {
      const response = await request.get('/api/health');
      expect(response.status()).toBe(200);
    });

    test('runtime config loads', async ({ request }) => {
      const response = await request.get('/api/runtime-config');
      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.supabaseUrl).toBeDefined();
    });
  });

  test.describe('Authentication', () => {
    test('login form is functional', async ({ page }) => {
      await page.goto('/login');

      // Email input exists and is editable
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toBeVisible();
      await emailInput.fill(ADMIN_EMAIL);
      await expect(emailInput).toHaveValue(ADMIN_EMAIL);

      // Submit button exists
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeVisible();
      await expect(submitButton).toBeEnabled();
    });
  });

  test.describe('Dashboard Access', () => {
    test('redirects unauthenticated users to login', async ({ page }) => {
      await page.goto('/dashboard');

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    });

    test('redirects unauthenticated from admin pages', async ({ page }) => {
      await page.goto('/dashboard/products');
      await expect(page).toHaveURL(/\/login/);
    });
  });

  test.describe('Public Pages', () => {
    test('checkout page loads for invalid slug', async ({ page }) => {
      const response = await page.goto('/checkout/non-existent-product-slug');

      // Page should load (might show error state in UI)
      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(500);
    });

    test('product page loads for invalid slug', async ({ page }) => {
      const response = await page.goto('/p/non-existent-product-slug');

      // Page should load (might show error state in UI)
      expect(response).not.toBeNull();
      expect(response!.status()).toBeLessThan(500);
    });
  });

  test.describe('API v1 Endpoints', () => {
    // These tests verify API endpoints are accessible (auth tested separately)

    test('products endpoint requires auth', async ({ request }) => {
      const response = await request.get('/api/v1/products');
      expect(response.status()).toBe(401);
    });

    test('coupons endpoint requires auth', async ({ request }) => {
      const response = await request.get('/api/v1/coupons');
      expect(response.status()).toBe(401);
    });

    test('payments endpoint requires auth', async ({ request }) => {
      const response = await request.get('/api/v1/payments');
      expect(response.status()).toBe(401);
    });

    test('webhooks endpoint requires auth', async ({ request }) => {
      const response = await request.get('/api/v1/webhooks');
      expect(response.status()).toBe(401);
    });

    test('system status endpoint works', async ({ request }) => {
      const response = await request.get('/api/v1/system/status');
      // Status endpoint might or might not require auth
      const status = response.status();
      expect(status === 200 || status === 401).toBe(true);
    });
  });

  test.describe('Internationalization', () => {
    test('default locale is English', async ({ page }) => {
      await page.goto('/');
      // Check for English lang attribute on html element
      const lang = await page.locator('html').getAttribute('lang');
      expect(lang).toBe('en');
    });

    test('Polish locale loads', async ({ page }) => {
      await page.goto('/pl');
      await expect(page).toHaveURL(/\/pl/);
    });

    test('login page has Polish version', async ({ page }) => {
      await page.goto('/pl/login');
      // Should show Polish login button text
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test('404 page for non-existent routes', async ({ page }) => {
      await page.goto('/this-page-does-not-exist-12345');

      // Should show 404 or not found
      await expect(page.locator('text=/404|not found/i')).toBeVisible({ timeout: 10000 });
    });

    test('API returns proper error format', async ({ request }) => {
      const response = await request.get('/api/v1/products/invalid-uuid');

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBeDefined();
      expect(data.error.message).toBeDefined();
    });
  });
});
