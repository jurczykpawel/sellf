import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Test licenses for localhost (generated with scripts/generate-license.js using v2 key)
// These licenses are for 'localhost' domain to match NEXT_PUBLIC_SITE_URL=http://localhost:3000
const TEST_LICENSES = {
  unlimited: 'SF-localhost-UNLIMITED-MEQCIGNN8RHvZ36XfI6d9nbL6QkW6-ygvmxiFkIqpUoledckAiBfxPhyxkNoQBRghX8fOs3H2HoAoqigXT_1-g-EaBqwqg',
  expired: 'SF-localhost-20251231-MEQCIHVQYmrREUupC_Bj-8de11HrYjzo6E0c3LKEwDWmatZfAiA3Peoc58ZEmuFb3hYUWHyq4p7Kp2C2mlBfr97oE04xQg',
  future: 'SF-localhost-20301231-MEYCIQCWjuZ-TYJIG_c6Lp6X02QtRF5U7HTcMT4e7xs37GDP9wIhAO4EoCyihqxyj43uKFMxR39JhfbEBoo3ilFkPZe2KVfh',
  invalid: 'INVALID-LICENSE-FORMAT',
};

// Test page URL - served by http-server on port 3002 (configured in playwright.config.ts)
// Requires ?testProduct param and optionally ?apiUrl for sellf source
const TEST_PAGE_URL = 'http://localhost:3002/element-protection.html?testProduct=test-product&apiUrl=http://localhost:3000';

test.describe('Watermark Visibility Based on License', () => {
  test.describe.configure({ mode: 'serial' });

  const setLicense = async (license: string | null) => {
    await supabaseAdmin
      .from('integrations_config')
      .upsert({ id: 1, sellf_license: license });
  };

  const clearGeneratorCache = async (page: typeof import('@playwright/test').Page.prototype) => {
    // Clear the generator cache to force re-generation with new license
    const response = await page.goto('/api/sellf?clearCache=true');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);
  };

  test.afterAll(async () => {
    // Clean up - remove license
    await setLicense(null);
  });

  test('Generated script contains LICENSE_VALID: true for valid unlimited license', async ({ page }) => {
    // Set valid license
    await setLicense(TEST_LICENSES.unlimited);

    // Clear cache and get the script directly
    const response = await page.goto('/api/sellf?clearCache=true');
    expect(response).not.toBeNull();
    const scriptContent = await response!.text();

    // Should contain LICENSE_VALID: true
    expect(scriptContent).toContain('LICENSE_VALID: true');
  });

  test('Generated script contains LICENSE_VALID: true for valid future license', async ({ page }) => {
    // Set valid future license (expires 2030-12-31)
    await setLicense(TEST_LICENSES.future);

    // Clear cache and get the script directly
    const response = await page.goto('/api/sellf?clearCache=true');
    expect(response).not.toBeNull();
    const scriptContent = await response!.text();

    // Should contain LICENSE_VALID: true
    expect(scriptContent).toContain('LICENSE_VALID: true');
  });

  test('Generated script contains LICENSE_VALID: false when no license is set', async ({ page }) => {
    // Remove license
    await setLicense(null);

    // Clear cache and get the script directly
    const response = await page.goto('/api/sellf?clearCache=true');
    expect(response).not.toBeNull();
    const scriptContent = await response!.text();

    // Should contain LICENSE_VALID: false
    expect(scriptContent).toContain('LICENSE_VALID: false');
  });

  test('Generated script contains LICENSE_VALID: false for expired license', async ({ page }) => {
    // Set expired license (expired 2025-12-31, before current date 2026-01-05)
    await setLicense(TEST_LICENSES.expired);

    // Clear cache and get the script directly
    const response = await page.goto('/api/sellf?clearCache=true');
    expect(response).not.toBeNull();
    const scriptContent = await response!.text();

    // Should contain LICENSE_VALID: false (expired)
    expect(scriptContent).toContain('LICENSE_VALID: false');
  });

  test('Generated script contains LICENSE_VALID: false for invalid license format', async ({ page }) => {
    // Set invalid license
    await setLicense(TEST_LICENSES.invalid);

    // Clear cache and get the script directly
    const response = await page.goto('/api/sellf?clearCache=true');
    expect(response).not.toBeNull();
    const scriptContent = await response!.text();

    // Should contain LICENSE_VALID: false (invalid format)
    expect(scriptContent).toContain('LICENSE_VALID: false');
  });

  test('Watermark is HIDDEN when valid license is set (visual test)', async ({ page }) => {
    // Set valid unlimited license
    await setLicense(TEST_LICENSES.unlimited);

    // Clear cache first
    await clearGeneratorCache(page);

    // Load test page from http-server (uses sellf from localhost:3000)
    await page.goto(TEST_PAGE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Watermark container should NOT exist (check inner visible element)
    const watermark = page.locator('#sellf-watermark > div');
    await expect(watermark).toHaveCount(0);
  });

  test('Watermark is SHOWN when no license is set (visual test)', async ({ page }) => {
    // Remove license
    await setLicense(null);

    // Clear cache first
    await clearGeneratorCache(page);

    // Load test page from http-server
    await page.goto(TEST_PAGE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Watermark inner div SHOULD be visible (position: fixed element)
    const watermark = page.locator('#sellf-watermark > div');
    await expect(watermark).toBeVisible();

    // Should contain Sellf branding
    await expect(watermark).toContainText('Sellf');
  });
});
