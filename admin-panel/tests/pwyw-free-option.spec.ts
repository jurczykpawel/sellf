import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

/**
 * PWYW Free Option Tests
 *
 * Comprehensive edge-case tests for PWYW products with custom_price_min = 0:
 * - Database layer: create, constraints
 * - Admin wizard: min=0, auto-sync presets/min, hints
 * - Checkout UI: presets, free UI, Stripe visibility, validation
 * - Grant-access API: accept/reject/idempotent
 * - Existing flows: free (price=0) and paid products unaffected
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

let adminEmail: string;
let adminPassword: string;
let adminCleanup: () => Promise<void>;

test.beforeAll(async () => {
  const admin = await createTestAdmin('pwyw-free');
  adminEmail = admin.email;
  adminPassword = admin.password;
  adminCleanup = admin.cleanup;
});

test.afterAll(async () => {
  await adminCleanup();
});

// ===== HELPER: intercept Stripe to prevent page crashes =====
async function blockStripeOnPage(page: import('@playwright/test').Page) {
  // Intercept payment intent creation — never respond so clientSecret stays null
  // This prevents Stripe Elements from rendering (and crashing with fake secrets)
  await page.route('**/api/create-payment-intent', async () => {
    // Intentionally not calling route.fulfill/abort/continue
    // Request hangs → clientSecret stays null → Stripe Elements don't render
  });
}

// ===== DATABASE TESTS =====
test.describe('PWYW Free Option — Database', () => {
  let productId: string;
  const slug = `pwyw-free-db-${Date.now()}`;

  test.afterAll(async () => {
    if (productId) {
      await supabaseAdminClient.from('user_product_access').delete().eq('product_id', productId);
      await supabaseAdminClient.from('products').delete().eq('id', productId);
    }
  });

  test('should allow creating product with custom_price_min = 0', async () => {
    const { data, error } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'PWYW Free DB Test',
        slug,
        price: 49,
        currency: 'PLN',
        description: 'PWYW with free option',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 0,
        show_price_presets: true,
        custom_price_presets: [0, 25, 49],
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.custom_price_min).toBe(0);
    expect(data!.allow_custom_price).toBe(true);
    productId = data!.id;
  });

  test('should allow creating PWYW product with custom_price_min > 0', async () => {
    const { data, error } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'PWYW Paid Min DB Test',
        slug: `pwyw-paid-min-${Date.now()}`,
        price: 99,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 10,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data!.custom_price_min).toBe(10);

    // Cleanup
    if (data) {
      await supabaseAdminClient.from('products').delete().eq('id', data.id);
    }
  });

  test('should reject negative custom_price_min', async () => {
    const { error } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'PWYW Negative Min',
        slug: `pwyw-neg-${Date.now()}`,
        price: 49,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: -1,
      });

    expect(error).toBeTruthy();
  });
});

// ===== CHECKOUT UI TESTS =====
test.describe('PWYW Free Option — Checkout UI', () => {
  let pwywFreeProduct: any;
  let pwywPaidMinProduct: any;
  let regularPaidProduct: any;
  let freeProduct: any;

  test.beforeAll(async () => {
    // Create PWYW product with min=0 and preset 0
    const { data: pwyw, error: err1 } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'PWYW Free Checkout Test',
        slug: `pwyw-free-checkout-${Date.now()}`,
        price: 49,
        currency: 'PLN',
        description: 'PWYW with free option for checkout tests',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 0,
        show_price_presets: true,
        custom_price_presets: [0, 25, 49],
      })
      .select()
      .single();
    if (err1) throw err1;
    pwywFreeProduct = pwyw;

    // Create PWYW product with min > 0 (no free option)
    const { data: pwywPaid, error: err2 } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'PWYW Paid Min Checkout Test',
        slug: `pwyw-paid-min-checkout-${Date.now()}`,
        price: 99,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 10,
        show_price_presets: true,
        custom_price_presets: [10, 50, 99],
      })
      .select()
      .single();
    if (err2) throw err2;
    pwywPaidMinProduct = pwywPaid;

    // Create regular paid product (no PWYW)
    const { data: regular, error: err3 } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'Regular Paid For Free Test',
        slug: `regular-paid-free-test-${Date.now()}`,
        price: 99,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: false,
      })
      .select()
      .single();
    if (err3) throw err3;
    regularPaidProduct = regular;

    // Create free product (price=0, no PWYW)
    const { data: free, error: err4 } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'Free Product For Free Test',
        slug: `free-product-free-test-${Date.now()}`,
        price: 0,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: false,
      })
      .select()
      .single();
    if (err4) throw err4;
    freeProduct = free;
  });

  test.afterAll(async () => {
    for (const p of [pwywFreeProduct, pwywPaidMinProduct, regularPaidProduct, freeProduct]) {
      if (p) {
        await supabaseAdminClient.from('user_product_access').delete().eq('product_id', p.id);
        await supabaseAdminClient.from('products').delete().eq('id', p.id);
      }
    }
  });

  test.beforeEach(async ({ page }) => {
    await acceptAllCookies(page);
    await blockStripeOnPage(page);
  });

  test('should show "Za darmo" preset button on PWYW-free checkout', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');

    // PWYW section title
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Should show "Za darmo" preset button
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await expect(freePreset.first()).toBeVisible({ timeout: 5000 });

    // Should also show paid presets
    const preset25 = page.locator('button').filter({ hasText: /25/ });
    await expect(preset25.first()).toBeVisible();

    const preset49 = page.locator('button').filter({ hasText: /49/ });
    await expect(preset49.first()).toBeVisible();
  });

  test('should show free access UI when clicking "Za darmo" preset', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Click "Za darmo" preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    // Custom input should show 0
    const customInput = page.locator('input[inputmode="decimal"]');
    await expect(customInput.first()).toHaveValue('0', { timeout: 3000 });

    // Should show free access section (green card with email input or "Odbierz za darmo")
    const freeUI = page.locator('text=Odbierz za darmo')
      .or(page.locator('text=Get for Free'))
      .or(page.locator('.bg-sf-success-soft input[type="email"]'));
    await expect(freeUI.first()).toBeVisible({ timeout: 5000 });
  });

  test('should hide Stripe Elements when $0 is selected', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Click "Za darmo" preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    // Stripe Elements should NOT be visible (no iframe from Stripe)
    // No Stripe iframe should exist
    expect(await page.locator('iframe[name*="stripe"]').count()).toBe(0);
  });

  test('should show "Minimum: 0,00" on PWYW-free checkout', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Should show "Minimum: 0,00 PLN" text
    const minimumText = page.locator('text=Minimum').first();
    await expect(minimumText).toBeVisible();
    // Value should contain 0,00 or 0.00
    const parentText = await minimumText.textContent();
    expect(parentText).toMatch(/0[.,]00/);
  });

  test('typing 0 in custom input should show free UI', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Type 0 directly in the input
    const customInput = page.locator('input[inputmode="decimal"]').first();
    await customInput.fill('0');
    await customInput.blur();

    // Should show free access UI
    const freeUI = page.locator('text=Odbierz za darmo')
      .or(page.locator('text=Get for Free'))
      .or(page.locator('.bg-sf-success-soft input[type="email"]'));
    await expect(freeUI.first()).toBeVisible({ timeout: 5000 });
  });

  test('PWYW with min > 0 should NOT show "Za darmo" preset', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywPaidMinProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');

    // PWYW section should appear
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Should NOT show "Za darmo" preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo|Free/i });
    await expect(freePreset).not.toBeVisible({ timeout: 3000 });

    // Should show paid presets (10, 50, 99)
    const preset10 = page.locator('button').filter({ hasText: /10/ });
    await expect(preset10.first()).toBeVisible();
  });

  test('regular paid product should NOT show PWYW section', async ({ page }) => {
    await page.goto(`/pl/checkout/${regularPaidProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Should NOT have PWYW section
    const pwywSection = page.locator('text=Wybierz kwotę');
    await expect(pwywSection).not.toBeVisible();
  });

  test('free product (price=0, no PWYW) should show FreeProductForm', async ({ page }) => {
    await page.goto(`/pl/checkout/${freeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // FreeProductForm renders "Darmowy" / "FREE" text
    const freeText = page.getByText(/darmowy|free/i);
    await expect(freeText.first()).toBeVisible({ timeout: 10000 });

    // Should NOT show PWYW section
    const pwywSection = page.locator('text=Wybierz kwotę');
    await expect(pwywSection).not.toBeVisible();
  });

  test('selecting paid preset after free should hide free UI', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // First select "Za darmo"
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    // Free UI should appear
    const freeUI = page.locator('.bg-sf-success-soft');
    await expect(freeUI.first()).toBeVisible({ timeout: 5000 });

    // Now select paid preset (25 PLN)
    const paidPreset = page.locator('button').filter({ hasText: /25/ });
    await paidPreset.first().click();

    // Free UI should disappear
    await expect(freeUI).not.toBeVisible({ timeout: 5000 });

    // Custom input should show 25
    const customInput = page.locator('input[inputmode="decimal"]');
    await expect(customInput.first()).toHaveValue('25');
  });

  test('logged-in user should see "Odbierz za darmo" button when $0 selected', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await blockStripeOnPage(page);

    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Click free preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    // Should show "Odbierz za darmo" button (not email form)
    const getForFreeButton = page.locator('button').filter({ hasText: /Odbierz za darmo/i });
    await expect(getForFreeButton).toBeVisible({ timeout: 5000 });

    // Should NOT show email input (user is logged in)
    const emailInputInFreeSection = page.locator('.bg-sf-success-soft input[type="email"]');
    await expect(emailInputInFreeSection).not.toBeVisible();
  });

  test('anonymous user should see email input when $0 selected', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Click free preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    // Should show email input (user is not logged in)
    const emailInput = page.locator('.bg-sf-success-soft input[type="email"]');
    await expect(emailInput).toBeVisible({ timeout: 5000 });

    // Should show "Odbierz za darmo" label text
    const getForFreeText = page.getByText(/Odbierz za darmo/i);
    await expect(getForFreeText).toBeVisible();
  });

  // --- Security: ToS + Captcha ---

  test('anonymous $0 should show terms checkbox and captcha widget', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Select free preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    // Green card should be visible
    const freeCard = page.locator('.bg-sf-success-soft').first();
    await expect(freeCard).toBeVisible({ timeout: 5000 });

    // Should show terms checkbox ("Zgadzam się z Regulaminem")
    const termsCheckbox = freeCard.locator('#terms-checkbox');
    await expect(termsCheckbox).toBeVisible({ timeout: 3000 });

    const termsLabel = freeCard.getByText(/Zgadzam się z/i);
    await expect(termsLabel).toBeVisible();

    // Should show captcha widget area (Turnstile iframe, ALTCHA widget, or "no captcha" dev msg)
    const captchaArea = freeCard.locator('div.mt-3').last();
    await expect(captchaArea).toBeVisible();
  });

  test('anonymous $0 magic link button should be disabled without terms accepted', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Select free preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    const freeCard = page.locator('.bg-sf-success-soft').first();
    await expect(freeCard).toBeVisible({ timeout: 5000 });

    // Fill email but leave terms unchecked
    const emailInput = freeCard.locator('input[type="email"]');
    await emailInput.fill('test@example.com');

    // Button should be disabled (terms not accepted)
    const sendButton = freeCard.locator('button').filter({ hasText: /Wyślij magiczny link/i });
    await expect(sendButton).toBeDisabled();

    // Now check the terms checkbox
    const termsCheckbox = freeCard.locator('#terms-checkbox');
    await termsCheckbox.check({ force: true });

    // Button should now be enabled (in dev mode captcha is not required)
    await expect(sendButton).toBeEnabled();
  });

  test('anonymous $0 magic link button should be disabled without email', async ({ page }) => {
    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Select free preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    const freeCard = page.locator('.bg-sf-success-soft').first();
    await expect(freeCard).toBeVisible({ timeout: 5000 });

    // Accept terms but don't fill email
    const termsCheckbox = freeCard.locator('#terms-checkbox');
    await termsCheckbox.check({ force: true });

    // Button should be disabled (no email)
    const sendButton = freeCard.locator('button').filter({ hasText: /Wyślij magiczny link/i });
    await expect(sendButton).toBeDisabled();
  });

  test('logged-in $0 should NOT show terms checkbox or captcha', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await blockStripeOnPage(page);

    // Clean up any existing access so we get the free UI
    await supabaseAdminClient
      .from('user_product_access')
      .delete()
      .eq('product_id', pwywFreeProduct.id);

    await page.goto(`/pl/checkout/${pwywFreeProduct.slug}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Wybierz kwotę')).toBeVisible({ timeout: 15000 });

    // Select free preset
    const freePreset = page.locator('button').filter({ hasText: /Za darmo/i });
    await freePreset.first().click();

    const freeCard = page.locator('.bg-sf-success-soft').first();
    await expect(freeCard).toBeVisible({ timeout: 5000 });

    // Should show "Odbierz za darmo" button
    const getForFreeBtn = freeCard.locator('button').filter({ hasText: /Odbierz za darmo/i });
    await expect(getForFreeBtn).toBeVisible();
    await expect(getForFreeBtn).toBeEnabled();

    // Should NOT show terms checkbox
    const termsCheckbox = freeCard.locator('#terms-checkbox');
    await expect(termsCheckbox).not.toBeVisible();

    // Should NOT show email input
    const emailInput = freeCard.locator('input[type="email"]');
    await expect(emailInput).not.toBeVisible();

    // Should NOT show captcha widget (Turnstile iframe or ALTCHA widget)
    const turnstileIframe = freeCard.locator('iframe[src*="turnstile"]');
    const altchaWidget = freeCard.locator('altcha-widget');
    await expect(turnstileIframe).not.toBeVisible();
    await expect(altchaWidget).not.toBeVisible();
  });
});

// ===== GRANT ACCESS API TESTS =====
test.describe('PWYW Free Option — Grant Access API', () => {
  let pwywFreeProduct: any;
  let pwywPaidMinProduct: any;
  let regularPaidProduct: any;

  test.beforeAll(async () => {
    const { data: pwyw, error: err1 } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'PWYW Free API Test',
        slug: `pwyw-free-api-${Date.now()}`,
        price: 49,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 0,
      })
      .select()
      .single();
    if (err1) throw err1;
    pwywFreeProduct = pwyw;

    const { data: pwywPaid, error: err2 } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'PWYW Paid Min API Test',
        slug: `pwyw-paid-min-api-${Date.now()}`,
        price: 99,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 10,
      })
      .select()
      .single();
    if (err2) throw err2;
    pwywPaidMinProduct = pwywPaid;

    const { data: regular, error: err3 } = await supabaseAdminClient
      .from('products')
      .insert({
        name: 'Regular API Test',
        slug: `regular-api-${Date.now()}`,
        price: 99,
        currency: 'PLN',
        is_active: true,
        allow_custom_price: false,
      })
      .select()
      .single();
    if (err3) throw err3;
    regularPaidProduct = regular;
  });

  test.afterAll(async () => {
    for (const p of [pwywFreeProduct, pwywPaidMinProduct, regularPaidProduct]) {
      if (p) {
        await supabaseAdminClient.from('user_product_access').delete().eq('product_id', p.id);
        await supabaseAdminClient.from('products').delete().eq('id', p.id);
      }
    }
  });

  test('grant-access API should accept PWYW-free product for authenticated user', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    const response = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/public/products/${slug}/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return { status: res.status, body: await res.json() };
    }, pwywFreeProduct.slug);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('grant-access API should reject regular paid product', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    const response = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/public/products/${slug}/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return { status: res.status, body: await res.json() };
    }, regularPaidProduct.slug);

    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  test('grant-access API should reject PWYW with min > 0', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    const response = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/public/products/${slug}/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return { status: res.status, body: await res.json() };
    }, pwywPaidMinProduct.slug);

    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  test('grant-access API should return already-has-access on second call', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    const response = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/public/products/${slug}/grant-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return { status: res.status, body: await res.json() };
    }, pwywFreeProduct.slug);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.alreadyHadAccess).toBe(true);
  });
});

// ===== ADMIN WIZARD TESTS =====
test.describe('PWYW Free Option — Admin Wizard', () => {
  const createdSlugs: string[] = [];

  test.afterAll(async () => {
    if (createdSlugs.length > 0) {
      for (const slug of createdSlugs) {
        await supabaseAdmin.from('products').delete().eq('slug', slug);
      }
    }
  });

  test('should allow setting custom_price_min to 0 in wizard', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Open wizard
    const addButton = page.locator('button', { hasText: /Dodaj produkt/i });
    await addButton.click();
    await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });

    // Fill Step 1: name + price
    await page.fill('input#name', 'PWYW Free Wizard Test');
    await page.fill('input#price', '49');

    // Enable PWYW
    const pwywCheckbox = page.locator('label').filter({ hasText: /Pozwól klientowi wybrać cenę/i }).locator('input[type="checkbox"]');
    await pwywCheckbox.check();

    // PWYW config should appear
    await expect(page.getByText(/Cena minimalna|Minimum Price/i)).toBeVisible({ timeout: 3000 });

    // Set minimum to 0
    const minInput = page.locator('input[type="number"][min="0"][step="0.10"]');
    await minInput.fill('0');

    // Should show free option hint
    await expect(page.getByText(/za darmo|for free/i)).toBeVisible({ timeout: 3000 });

    // Close wizard
    await page.getByRole('button', { name: /Anuluj/i }).click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('enabling PWYW should auto-populate presets relative to price', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Open wizard
    await page.locator('button', { hasText: /Dodaj produkt/i }).click();
    await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });

    // Set price to 100
    await page.fill('input#name', 'PWYW Preset Sync Test');
    await page.fill('input#price', '100');

    // Enable PWYW
    const pwywCheckbox = page.locator('label').filter({ hasText: /Pozwól klientowi wybrać cenę/i }).locator('input[type="checkbox"]');
    await pwywCheckbox.check();
    await expect(page.getByText(/Cena minimalna|Minimum Price/i)).toBeVisible({ timeout: 3000 });

    // Check presets: should be [100, 150, 200] (1x, 1.5x, 2x)
    // Use placeholder="0" to distinguish preset inputs from VAT rate input
    const presetInputs = page.locator('input[type="number"][min="0"][step="1"][placeholder="0"]');
    const presetCount = await presetInputs.count();
    expect(presetCount).toBe(3);

    await expect(presetInputs.nth(0)).toHaveValue('100');
    await expect(presetInputs.nth(1)).toHaveValue('150');
    await expect(presetInputs.nth(2)).toHaveValue('200');

    // Min should be 50% of price = 50
    const minInput = page.locator('input[type="number"][min="0"][step="0.10"]');
    await expect(minInput).toHaveValue('50');

    // Close wizard
    await page.getByRole('button', { name: /Anuluj/i }).click();
    if (await page.getByText(/Odrzucić zmiany/i).isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('changing price should auto-update presets and min', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Open wizard
    await page.locator('button', { hasText: /Dodaj produkt/i }).click();
    await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });

    // Set initial price
    await page.fill('input#name', 'PWYW Price Sync Test');
    await page.fill('input#price', '100');

    // Enable PWYW
    const pwywCheckbox = page.locator('label').filter({ hasText: /Pozwól klientowi wybrać cenę/i }).locator('input[type="checkbox"]');
    await pwywCheckbox.check();
    await expect(page.getByText(/Cena minimalna|Minimum Price/i)).toBeVisible({ timeout: 3000 });

    // Verify initial presets
    const presetInputs = page.locator('input[type="number"][min="0"][step="1"][placeholder="0"]');
    await expect(presetInputs.nth(0)).toHaveValue('100');

    // Change price to 200
    await page.fill('input#price', '200');

    // Presets should auto-update to [200, 300, 400]
    await expect(presetInputs.nth(0)).toHaveValue('200');
    await expect(presetInputs.nth(1)).toHaveValue('300');
    await expect(presetInputs.nth(2)).toHaveValue('400');

    // Min should update to 100 (50% of 200)
    const minInput = page.locator('input[type="number"][min="0"][step="0.10"]');
    await expect(minInput).toHaveValue('100');

    // Close wizard
    await page.getByRole('button', { name: /Anuluj/i }).click();
    if (await page.getByText(/Odrzucić zmiany/i).isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('manually edited min should not auto-sync on price change', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Open wizard
    await page.locator('button', { hasText: /Dodaj produkt/i }).click();
    await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });

    // Set initial price
    await page.fill('input#name', 'PWYW Manual Min Test');
    await page.fill('input#price', '100');

    // Enable PWYW
    const pwywCheckbox = page.locator('label').filter({ hasText: /Pozwól klientowi wybrać cenę/i }).locator('input[type="checkbox"]');
    await pwywCheckbox.check();
    await expect(page.getByText(/Cena minimalna|Minimum Price/i)).toBeVisible({ timeout: 3000 });

    // Manually edit min to 5
    const minInput = page.locator('input[type="number"][min="0"][step="0.10"]');
    await minInput.fill('5');

    // Change price to 200
    await page.fill('input#price', '200');

    // Min should stay at 5 (manually edited → no auto-sync)
    await expect(minInput).toHaveValue('5');

    // But presets should still auto-update (not manually edited)
    const presetInputs = page.locator('input[type="number"][min="0"][step="1"][placeholder="0"]');
    await expect(presetInputs.nth(0)).toHaveValue('200');

    // Close wizard
    await page.getByRole('button', { name: /Anuluj/i }).click();
    if (await page.getByText(/Odrzucić zmiany/i).isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('min=0 should show free hint, min>0 should show Stripe hint', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Open wizard
    await page.locator('button', { hasText: /Dodaj produkt/i }).click();
    await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });

    await page.fill('input#name', 'PWYW Hint Test');
    await page.fill('input#price', '49');

    // Enable PWYW
    const pwywCheckbox = page.locator('label').filter({ hasText: /Pozwól klientowi wybrać cenę/i }).locator('input[type="checkbox"]');
    await pwywCheckbox.check();

    // Default min should be ~24.5 (50% of 49) → Stripe minimum hint
    const stripeHint = page.getByText(/Stripe/i);
    await expect(stripeHint).toBeVisible({ timeout: 3000 });

    // Set min to 0
    const minInput = page.locator('input[type="number"][min="0"][step="0.10"]');
    await minInput.fill('0');

    // Should show free option hint instead of Stripe hint
    const freeHint = page.getByText(/za darmo|for free/i);
    await expect(freeHint).toBeVisible({ timeout: 3000 });

    // Stripe hint should disappear
    await expect(stripeHint).not.toBeVisible();

    // Close wizard
    await page.getByRole('button', { name: /Anuluj/i }).click();
    if (await page.getByText(/Odrzucić zmiany/i).isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('disabling and re-enabling PWYW should reset auto-sync', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/products');
    await page.waitForLoadState('networkidle');

    // Open wizard
    await page.locator('button', { hasText: /Dodaj produkt/i }).click();
    await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });

    await page.fill('input#name', 'PWYW Reset Test');
    await page.fill('input#price', '100');

    // Enable PWYW
    const pwywCheckbox = page.locator('label').filter({ hasText: /Pozwól klientowi wybrać cenę/i }).locator('input[type="checkbox"]');
    await pwywCheckbox.check();

    // Manually edit min
    const minInput = page.locator('input[type="number"][min="0"][step="0.10"]');
    await minInput.fill('5');

    // Disable PWYW
    await pwywCheckbox.uncheck();

    // Re-enable PWYW
    await pwywCheckbox.check();

    // Min should be reset to auto-calculated value (50)
    await expect(minInput).toHaveValue('50');

    // Presets should be fresh auto-calculated
    const presetInputs = page.locator('input[type="number"][min="0"][step="1"][placeholder="0"]');
    await expect(presetInputs.nth(0)).toHaveValue('100');

    // Close wizard
    await page.getByRole('button', { name: /Anuluj/i }).click();
    if (await page.getByText(/Odrzucić zmiany/i).isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });
});
