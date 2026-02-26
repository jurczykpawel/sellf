import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Enforce single worker
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Valid test NIP (Polish test company): 5261040828
// This is a public test NIP that should exist in GUS database
const TEST_NIP_VALID = '5261040828';
const TEST_NIP_INVALID_CHECKSUM = '1234567890'; // Invalid checksum

test.describe('GUS Checkout Flow - NIP Validation', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    // Create test product
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GUS Test Product ${Date.now()}`,
        slug: `gus-test-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        description: 'Test product for GUS integration',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true,
      })
      .select()
      .single();

    if (error) throw error;
    testProduct = data;
  });

  test.afterAll(async () => {
    // Cleanup: delete test product
    if (testProduct) {
      await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', testProduct.id);
    }
  });

  test('should show NIP field and company fields appear after entering 10 digits', async ({ page }) => {
    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);

    // Wait for checkout form to load (wait for email or firstName field)
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // NIP field should be visible (always shown now)
    await expect(page.locator('input#nip')).toBeVisible();

    // Company fields should be hidden initially
    await expect(page.locator('input#companyName')).not.toBeVisible();

    // Fill NIP with 10 digits
    await page.locator('input#nip').fill(TEST_NIP_VALID);

    // Company fields should now be visible (auto-wait)
    await expect(page.locator('input#companyName')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input#address')).toBeVisible();
    await expect(page.locator('input#city')).toBeVisible();
    await expect(page.locator('input#postalCode')).toBeVisible();
  });

  test('should validate NIP checksum and show error for invalid NIP', async ({ page }) => {
    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Fill invalid NIP
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_INVALID_CHECKSUM);
    await nipInput.blur(); // Trigger onBlur

    // Should show validation error (auto-wait)
    await expect(page.locator('text=Nieprawidłowy numer NIP')).toBeVisible({ timeout: 5000 });

    // Should NOT show loading spinner
    await expect(page.locator('svg.animate-spin').first()).not.toBeVisible();
  });

  test('should accept valid NIP format (10 digits)', async ({ page }) => {
    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Fill valid NIP and wait for value to be set
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);

    // Wait for input to have the expected value
    await expect(nipInput).toHaveValue(TEST_NIP_VALID, { timeout: 5000 });
  });

  test('should enforce maxLength=20 on NIP input (supports international tax IDs)', async ({ page }) => {
    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Try to fill more than 20 characters
    const nipInput = page.locator('input#nip');
    await nipInput.fill('PL12345678901234567890EXTRA');

    // Should be truncated to 20 (supports international formats like "PL1234567890")
    const value = await nipInput.inputValue();
    expect(value.length).toBeLessThanOrEqual(20);
  });
});

test.describe('GUS Checkout Flow - Autofill (Mocked)', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    // Create test product
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GUS Autofill Test ${Date.now()}`,
        slug: `gus-autofill-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        description: 'Test product for GUS autofill',
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    testProduct = data;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', testProduct.id);
    }
  });

  test('should show loading spinner during GUS API call', async ({ page }) => {
    // Mock GUS API to delay response
    await page.route('**/api/gus/fetch-company-data', async route => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            nazwa: 'TEST SPÓŁKA Z O.O.',
            ulica: 'ul. Testowa',
            nrNieruchomosci: '123',
            nrLokalu: '4',
            miejscowosc: 'Warszawa',
            kodPocztowy: '00-001',
            wojewodztwo: 'MAZOWIECKIE',
            regon: '123456789',
            nip: TEST_NIP_VALID,
          },
        }),
      });
    });

    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Fill valid NIP
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);
    await nipInput.blur();

    // Should show loading spinner
    await expect(page.locator('svg.animate-spin').first()).toBeVisible({ timeout: 1000 });

    // Loading spinner should disappear (auto-wait with longer timeout for real API)
    await expect(page.locator('svg.animate-spin').first()).not.toBeVisible({ timeout: 10000 });
  });

  test('should autofill company data from mocked GUS response', async ({ page }) => {
    // Mock successful GUS API response
    await page.route('**/api/gus/fetch-company-data', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            nazwa: 'PRZYKŁADOWA FIRMA SP. Z O.O.',
            ulica: 'ul. Kwiatowa',
            nrNieruchomosci: '42',
            nrLokalu: '10',
            miejscowosc: 'Kraków',
            kodPocztowy: '30-001',
            wojewodztwo: 'MAŁOPOLSKIE',
            regon: '987654321',
            nip: TEST_NIP_VALID,
          },
        }),
      });
    });

    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Fill valid NIP and blur
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);
    await nipInput.blur();

    // Check that fields are autofilled (auto-wait)
    await expect(page.locator('input#companyName')).toHaveValue('PRZYKŁADOWA FIRMA SP. Z O.O.', { timeout: 10000 });
    await expect(page.locator('input#address')).toHaveValue('ul. Kwiatowa 42/10');
    await expect(page.locator('input#city')).toHaveValue('Kraków');
    await expect(page.locator('input#postalCode')).toHaveValue('30-001');

    // Should show success message
    await expect(page.locator('text=Dane pobrane z bazy GUS')).toBeVisible();
  });

  test('should show error message when company not found', async ({ page }) => {
    // Mock NOT_FOUND response
    await page.route('**/api/gus/fetch-company-data', async route => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Company not found in GUS database',
          code: 'NOT_FOUND',
        }),
      });
    });

    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Fill NIP and blur
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);
    await nipInput.blur();

    // Should show error message (wait for API response + UI update)
    await expect(page.locator('text=Nie znaleziono firmy w bazie GUS')).toBeVisible({ timeout: 10000 });

    // Fields should remain empty (allow manual entry)
    await expect(page.locator('input#companyName')).toHaveValue('');
  });

  test('should handle rate limit gracefully', async ({ page }) => {
    // Mock RATE_LIMIT_EXCEEDED response
    await page.route('**/api/gus/fetch-company-data', async route => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
        headers: {
          'X-RateLimit-Limit': '5',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(Date.now() + 60000).toISOString(),
          'Retry-After': '60',
        },
      });
    });

    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Fill NIP and blur
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);
    await nipInput.blur();

    // Should show rate limit error (auto-wait)
    await expect(page.locator('text=Zbyt wiele zapytań. Poczekaj chwilę i spróbuj ponownie.')).toBeVisible({ timeout: 10000 });
  });

  test('should allow manual entry when GUS fails', async ({ page }) => {
    // Mock API failure
    await page.route('**/api/gus/fetch-company-data', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Internal server error',
          code: 'UNKNOWN_ERROR',
        }),
      });
    });

    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Fill NIP and blur (will fail)
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);
    await nipInput.blur();

    // Should show generic error (auto-wait)
    await expect(page.locator('text=Nie udało się pobrać danych')).toBeVisible({ timeout: 10000 });

    // User should be able to manually fill fields
    await page.locator('input#companyName').fill('MANUAL COMPANY NAME');
    await page.locator('input#address').fill('ul. Manual 1');
    await page.locator('input#city').fill('Warsaw');
    await page.locator('input#postalCode').fill('00-000');

    // Fields should have manual values
    await expect(page.locator('input#companyName')).toHaveValue('MANUAL COMPANY NAME');
    await expect(page.locator('input#address')).toHaveValue('ul. Manual 1');
  });

  test('should clear previous autofill when NIP changes', async ({ page }) => {
    // Mock successful first response
    await page.route('**/api/gus/fetch-company-data', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            nazwa: 'FIRST COMPANY',
            ulica: 'ul. First',
            nrNieruchomosci: '1',
            nrLokalu: '',
            miejscowosc: 'Warsaw',
            kodPocztowy: '00-001',
            wojewodztwo: 'MAZOWIECKIE',
            regon: '111111111',
            nip: TEST_NIP_VALID,
          },
        }),
      });
    });

    // Navigate to checkout
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 30000 });

    // Fill NIP and blur
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);
    await nipInput.blur();

    // Verify autofill happened (auto-wait)
    await expect(page.locator('input#companyName')).toHaveValue('FIRST COMPANY', { timeout: 10000 });

    // Now change NIP - should clear success message
    await nipInput.clear();
    await nipInput.fill('5261040827'); // Different NIP

    // Success message should disappear
    await expect(page.locator('text=Dane pobrane z bazy GUS')).not.toBeVisible();
  });
});

test.describe('GUS Checkout Flow - Security', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    const { data } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GUS Security Test ${Date.now()}`,
        slug: `gus-security-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();
    testProduct = data;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should reject requests from invalid origin (CORS)', async ({ page }) => {
    // This test verifies that the API endpoint checks origin
    // We can't easily simulate cross-origin from Playwright, but we can verify the code path

    const response = await page.request.post('/api/gus/fetch-company-data', {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://evil.com', // Invalid origin
      },
      data: {
        nip: TEST_NIP_VALID,
      },
    });

    // Should return 403 Forbidden
    expect(response.status()).toBe(403);

    const body = await response.json();
    expect(body.code).toBe('INVALID_ORIGIN');
  });

  // Rate limiting test moved to tests/rate-limiting.spec.ts
  // Run with: RATE_LIMIT_TEST_MODE=true npx playwright test --project=rate-limiting
});
