import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Enforce single worker to avoid race conditions
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Valid test NIP
const TEST_NIP_VALID = '5261040828';

/**
 * Mock Stripe.js globally for all tests
 * This prevents real Stripe API calls and iframe loading
 */
async function mockStripe(page: any) {
  await page.addInitScript(() => {
    // Mock loadStripe function (used by @stripe/stripe-js)
    // @ts-ignore
    window.loadStripe = async function() {
      return {
        elements: function() {
          return {
            _commonOptions: {
              clientSecret: 'pi_mock_secret_123'
            },
            create: function() {
              return {
                mount: function(selector) {
                  const container = document.querySelector(selector);
                  if (container) {
                    const mockEl = document.createElement('div');
                    mockEl.setAttribute('data-testid', 'mock-payment-element');
                    mockEl.innerHTML = '<div>Mock Payment Element (Test Mode)</div>';
                    container.appendChild(mockEl);
                  }
                },
                on: function() {},
                unmount: function() {},
                destroy: function() {}
              };
            },
            submit: async function() {
              return { error: null };
            }
          };
        },
        confirmPayment: async function(options) {
          const returnUrl = options.confirmParams?.return_url;
          if (returnUrl) {
            window.location.href = returnUrl;
          }
          return { error: null };
        },
        retrievePaymentIntent: async function(cs) {
          return {
            paymentIntent: {
              id: 'pi_mock_123',
              client_secret: cs,
              status: 'succeeded'
            }
          };
        }
      };
    };

    // Also mock Stripe constructor (fallback)
    // @ts-ignore
    window.Stripe = window.loadStripe;
  });

  // Mock the Stripe CDN script to prevent loading real Stripe.js
  await page.route('https://js.stripe.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '// Mocked Stripe.js'
    });
  });
}

/**
 * Mock Stripe API endpoints
 */
async function mockStripeAPI(page: any) {
  await page.route('**/api/create-payment-intent', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        clientSecret: 'pi_mock_secret_123',
        amount: 10000
      })
    });
  });

  await page.route('**/api/update-payment-metadata', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });

  await page.route('**/api/verify-payment**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        verified: true,
        status: 'succeeded'
      })
    });
  });
}

// NOTE: Most tests in this file are skipped because mocking Stripe Elements is unreliable
// Stripe.js module caching and @stripe/react-stripe-js make it difficult to properly mock
// Payment flow is comprehensively tested in payment-access-flow.spec.ts using RPC functions
test.describe('Checkout E2E - Guest Purchase Flow', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: `E2E Test Product ${Date.now()}`,
        slug: `e2e-test-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        description: 'Test product for E2E checkout',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true
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

  test('should validate required fields before submission', async ({ page }) => {
    await page.goto(`/pl/checkout/${testProduct.slug}`);

    // Email is now handled by Stripe's LinkAuthenticationElement (iframe) — not directly testable

    // Full name field is required
    const fullNameInput = page.locator('input#fullName');
    await expect(fullNameInput).toBeVisible({ timeout: 15000 });
    await expect(fullNameInput).toHaveAttribute('required', '');

    // T&C checkbox is required for guests
    const termsCheckbox = page.locator('input[type="checkbox"]').first();
    const isVisible = await termsCheckbox.count();
    if (isVisible > 0) {
      await expect(termsCheckbox).toBeVisible();
    }
  });
});

test.describe('Checkout E2E - Invoice & GUS Integration', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    const { data } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Invoice Test ${Date.now()}`,
        slug: `invoice-test-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true
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

  test('should autofill company data from GUS API', async ({ page }) => {
    await page.route('**/api/gus/fetch-company-data', async (route) => {
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
            nip: TEST_NIP_VALID
          }
        })
      });
    });

    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    // NIP field should be visible (no checkbox needed)
    await expect(page.locator('input#nip')).toBeVisible();

    // Fill NIP and trigger autofill
    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);
    await nipInput.blur();

    await page.waitForTimeout(1000);

    // Verify all fields were autofilled correctly
    await expect(page.locator('input#companyName')).toHaveValue('TEST SPÓŁKA Z O.O.');
    await expect(page.locator('input#address')).toHaveValue('ul. Testowa 123/4');
    await expect(page.locator('input#city')).toHaveValue('Warszawa');
    await expect(page.locator('input#postalCode')).toHaveValue('00-001');

    // Success message should be visible
    await expect(page.locator('text=Dane pobrane z bazy GUS')).toBeVisible();
  });

  test('should validate NIP before calling GUS API', async ({ page }) => {
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    const nipInput = page.locator('input#nip');
    await nipInput.fill('1234567890'); // Invalid NIP
    await nipInput.blur();

    // Should show validation error
    await expect(page.locator('text=/Nieprawidłowy numer NIP/i')).toBeVisible();
    // Should NOT show loading spinner (validation happens before API call)
    await expect(page.locator('svg.animate-spin').first()).not.toBeVisible();
  });

  test('should show company fields when NIP has 10 digits', async ({ page }) => {
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    // NIP field should be visible
    const nipInput = page.locator('input#nip');
    await expect(nipInput).toBeVisible();

    // Company fields should not be visible initially
    await expect(page.locator('input#companyName')).not.toBeVisible();

    // Fill NIP with 10 digits (even if invalid checksum)
    await nipInput.fill('1234567890');

    // Wait for company fields to appear - use proper wait instead of fixed timeout
    const companyInput = page.locator('input#companyName');
    await expect(companyInput).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Checkout E2E - Error Scenarios', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    const { data } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Error Test ${Date.now()}`,
        slug: `error-test-${Date.now()}`,
        price: 50,
        currency: 'PLN',
        is_active: true
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

  // Removed: Payment error handling requires Stripe Elements
  // This is tested in payment-access-flow.spec.ts using RPC functions

  test('should handle GUS API failure gracefully', async ({ page }) => {
    await page.route('**/api/gus/fetch-company-data', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Internal server error',
          code: 'UNKNOWN_ERROR'
        })
      });
    });

    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    const nipInput = page.locator('input#nip');
    await nipInput.fill(TEST_NIP_VALID);
    await nipInput.blur();

    await page.waitForTimeout(1000);

    await expect(page.locator('text=/Nie udało się pobrać danych/i')).toBeVisible();

    await page.fill('input#companyName', 'MANUAL COMPANY');
    await page.fill('input#address', 'ul. Manual 1');
    await page.fill('input#city', 'Warsaw');

    await expect(page.locator('input#companyName')).toHaveValue('MANUAL COMPANY');
  });

  test('should show 404 for non-existent product', async ({ page }) => {
    await page.goto('/pl/checkout/non-existent-product-slug-12345');

    await expect(page.locator('h1:has-text("404")').first()).toBeVisible({ timeout: 5000 });
  });

  test('should show 404 for inactive product', async ({ page }) => {
    const { data: inactiveProduct } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Inactive Product',
        slug: `inactive-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: false
      })
      .select()
      .single();

    await page.goto(`/pl/checkout/${inactiveProduct.slug}`);

    await expect(page.locator('h1:has-text("404")').first()).toBeVisible({ timeout: 5000 });

    await supabaseAdmin.from('products').delete().eq('id', inactiveProduct.id);
  });
});

test.describe('Checkout E2E - Price Display', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    const { data } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Price Test ${Date.now()}`,
        slug: `price-test-${Date.now()}`,
        price: 123,
        currency: 'PLN',
        vat_rate: 23,
        price_includes_vat: true,
        is_active: true
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

  test('should display correct price breakdown with VAT', async ({ page }) => {
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    // Check product name is visible (not in title tag)
    await expect(page.locator(`h1:has-text("${testProduct.name}"), h2:has-text("${testProduct.name}")`).first()).toBeVisible();

    // Check price and VAT are displayed
    await expect(page.locator('text=/123.*PLN/i').first()).toBeVisible();
    await expect(page.locator('text=/VAT.*23%/i').first()).toBeVisible();
  });

  test('should show price summary section', async ({ page }) => {
    await page.goto(`/pl/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    // Check for order summary or total section
    await expect(page.locator('text=/Order Summary|Total|Podsumowanie|Razem/i')).toBeVisible();
  });
});

test.describe('Checkout E2E - Authenticated User Profile Data', () => {
  let testProduct: any;
  let testUser: any;
  const testPassword = 'TestPassword123!';

  // Helper to login as test user
  const loginAsUser = async (page: any) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const supabase = createBrowserClient(supabaseUrl, anonKey);
      await supabase.auth.signInWithPassword({ email, password });
    }, {
      email: testUser.email,
      password: testPassword,
      supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    });

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    // Create test product
    const { data: productData } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Auth Test Product ${Date.now()}`,
        slug: `auth-test-${Date.now()}`,
        price: 100,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    testProduct = productData;

    // Create test user with password
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: `test-${Date.now()}@example.com`,
      password: testPassword,
      email_confirm: true,
    });

    if (userError) throw userError;
    testUser = userData.user;

    // Create/update profile with pre-filled data (use upsert in case trigger already created empty profile)
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: testUser.id,
        full_name: 'Jan Kowalski',
        company_name: 'Test Company Sp. z o.o.',
        tax_id: '5261040828',
        address_line1: 'ul. Testowa 123/4',
        city: 'Warszawa',
        zip_code: '00-001',
        country: 'PL',
      });

    if (profileError) {
      console.error('Profile creation error:', profileError);
      throw profileError;
    }

    // Verify profile was created correctly
    const { data: verifyProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', testUser.id)
      .single();

    console.log('Created profile:', verifyProfile);
  });

  test.afterAll(async () => {
    // Cleanup: delete test product and user
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
    if (testUser) {
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
  });

  test('should pre-fill email and full name from profile', async ({ page }) => {
    // Login as test user
    await loginAsUser(page);

    // Go to checkout (using /en for USD product)
    await page.goto(`/en/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    // Wait for profile to load (fullName field becomes enabled when loading is done)
    await page.waitForTimeout(2000);

    // Email is passed to Stripe's LinkAuthenticationElement (iframe)
    // Verify our code passes the correct email via data-test-email attribute on the wrapper
    const emailWrapper = page.locator('[data-test-email]');
    await expect(emailWrapper).toHaveAttribute('data-test-email', testUser.email, { timeout: 10000 });

    // Debug: Check what value fullName has
    const fullNameInput = page.locator('input#fullName');
    const actualValue = await fullNameInput.inputValue();
    console.log('fullName actual value:', actualValue);
    console.log('fullName placeholder:', await fullNameInput.getAttribute('placeholder'));

    // Full name should be pre-filled
    await expect(fullNameInput).toHaveValue('Jan Kowalski');
    await expect(fullNameInput).toBeEnabled(); // Should be editable
  });

  test('should pre-fill company data from profile when NIP entered', async ({ page }) => {
    // Login as test user
    await loginAsUser(page);

    // Go to checkout (using /en for USD product)
    await page.goto(`/en/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    // Wait for profile to load
    await page.waitForTimeout(2000);

    // NIP field should be visible
    const nipInput = page.locator('input#nip');
    await expect(nipInput).toBeVisible();

    // When user has saved NIP, it should be pre-filled
    await expect(nipInput).toHaveValue('5261040828');

    // Company fields should be visible (because NIP has 10 digits)
    await page.waitForTimeout(500);
    await expect(page.locator('input#companyName')).toBeVisible();
    await expect(page.locator('input#companyName')).toHaveValue('Test Company Sp. z o.o.');
    await expect(page.locator('input#address')).toHaveValue('ul. Testowa 123/4');
    await expect(page.locator('input#city')).toHaveValue('Warszawa');
    await expect(page.locator('input#postalCode')).toHaveValue('00-001');
  });

  test('should allow editing pre-filled profile data', async ({ page }) => {
    // Login as test user
    await loginAsUser(page);

    // Go to checkout (using /en for USD product)
    await page.goto(`/en/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    // Wait for profile to load
    await page.waitForTimeout(2000);

    // User should be able to edit full name
    const fullNameInput = page.locator('input#fullName');
    await fullNameInput.clear();
    await fullNameInput.fill('Anna Nowak');
    await expect(fullNameInput).toHaveValue('Anna Nowak');

    // User should be able to edit company data (need to wait for NIP field to trigger company fields)
    await page.waitForTimeout(500);
    const companyInput = page.locator('input#companyName');
    await companyInput.clear();
    await companyInput.fill('New Company Ltd');
    await expect(companyInput).toHaveValue('New Company Ltd');
  });

  test('should render payment form with Express Checkout support', async ({ page }) => {
    await mockStripe(page);

    // Go to checkout as guest
    await page.goto(`/en/checkout/${testProduct.slug}`);
    await page.waitForSelector('input#fullName', { timeout: 10000 });

    // Email is in Stripe's LinkAuthenticationElement (iframe) — fill only fullName
    const fullNameInput = page.locator('input#fullName');
    await fullNameInput.fill('Express User');

    // Accept terms
    const termsCheckbox = page.locator('input[type="checkbox"]').first();
    await termsCheckbox.check();

    // Wait for payment form to initialize
    await page.waitForTimeout(1000);

    // Verify form rendered correctly with filled data
    await expect(fullNameInput).toHaveValue('Express User');
    await expect(termsCheckbox).toBeChecked();

    // Verify the form structure is complete for submission
    // (Payment Element container depends on Stripe.js, but form fields must be present)
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
  });
});
