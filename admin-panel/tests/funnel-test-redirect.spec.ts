/**
 * E2E Tests: Funnel Test — Post-Complete Redirect Behavior
 *
 * After clicking "Complete Test" in funnel test mode, the redirect should
 * simulate what happens after a real purchase (priority order):
 *   1. if URL has ?success_url param → use it (override)
 *   2. if product has success_redirect_url → redirect there
 *   3. if product has OTO configured → redirect to OTO target checkout
 *   4. if nothing configured → go to /p/${slug}
 *
 * FIX: handleRedirectToProduct() in PaidProductForm now checks all of the above.
 *
 * KNOWN LIMITATION: When admin falls through to /p/${slug} without DB access,
 * useProductAccess bounces back to /checkout/${slug}. This is documented in test 2.
 *
 * @see admin-panel/src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx
 * @see admin-panel/src/hooks/useProductAccess.ts
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

test.describe('Funnel Test: Post-Complete Redirect', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  let adminPassword: string;
  let adminUserId: string;

  // Product slugs and IDs
  let noRedirectSlug: string;
  let noRedirectProductId: string;
  let successUrlSlug: string;
  let urlParamSlug: string;
  let otoMainSlug: string;
  let otoTargetSlug: string;

  let otoMainId: string;
  let otoTargetId: string;
  let otoOfferId: string;

  const SUCCESS_REDIRECT_PATH = '/my-products'; // safe internal path for redirect tests

  test.beforeAll(async () => {
    // Create admin user directly to capture ID immediately (avoids listUsers() pagination issues)
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `funnel-redir-${Date.now()}-${randomStr}@example.com`;
    adminPassword = 'password123';

    const { data: { user }, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;

    adminUserId = user!.id;
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    const ts = Date.now();

    // 1. Simple product — no redirect configured
    //    Admin will be granted actual access so product page doesn't bounce back to checkout
    noRedirectSlug = `ft-redir-none-${ts}`;
    const { data: noRedirectProduct } = await supabaseAdmin.from('products').insert({
      name: 'FT Redirect — None',
      slug: noRedirectSlug,
      price: 99,
      currency: 'PLN',
      description: 'No redirect configured',
      is_active: true,
      vat_rate: 23,
      price_includes_vat: true,
    }).select().single();
    noRedirectProductId = noRedirectProduct!.id;

    // Grant admin access so product page shows content (not checkout redirect)
    await supabaseAdmin.from('user_product_access').insert({
      user_id: adminUserId,
      product_id: noRedirectProductId,
      access_granted_at: new Date().toISOString(),
    });

    // 2. Product with success_redirect_url configured (EXPECTED FAIL: current code ignores this)
    successUrlSlug = `ft-redir-url-${ts}`;
    await supabaseAdmin.from('products').insert({
      name: 'FT Redirect — Has Success URL',
      slug: successUrlSlug,
      price: 149,
      currency: 'PLN',
      description: 'Configured success redirect to /my-products',
      is_active: true,
      vat_rate: 23,
      price_includes_vat: true,
      success_redirect_url: SUCCESS_REDIRECT_PATH,
    });

    // 3. Product for ?success_url URL param override test (EXPECTED FAIL)
    urlParamSlug = `ft-redir-param-${ts}`;
    await supabaseAdmin.from('products').insert({
      name: 'FT Redirect — URL Param',
      slug: urlParamSlug,
      price: 79,
      currency: 'PLN',
      description: 'No DB redirect; override via URL param',
      is_active: true,
      vat_rate: 23,
      price_includes_vat: true,
    });

    // 4. Products with OTO configured (EXPECTED FAIL)
    otoTargetSlug = `ft-redir-oto-target-${ts}`;
    const { data: otoTarget } = await supabaseAdmin.from('products').insert({
      name: 'FT OTO Target',
      slug: otoTargetSlug,
      price: 99,
      currency: 'PLN',
      description: 'Product offered as one-time offer',
      is_active: true,
      vat_rate: 23,
      price_includes_vat: true,
    }).select().single();
    otoTargetId = otoTarget!.id;

    otoMainSlug = `ft-redir-oto-main-${ts}`;
    const { data: otoMain } = await supabaseAdmin.from('products').insert({
      name: 'FT OTO Main',
      slug: otoMainSlug,
      price: 199,
      currency: 'PLN',
      description: 'Main product — has OTO configured',
      is_active: true,
      vat_rate: 23,
      price_includes_vat: true,
    }).select().single();
    otoMainId = otoMain!.id;

    const { data: otoOffer } = await supabaseAdmin.from('oto_offers').insert({
      source_product_id: otoMainId,
      oto_product_id: otoTargetId,
      discount_type: 'percentage',
      discount_value: 30,
      duration_minutes: 15,
      is_active: true,
    }).select().single();
    otoOfferId = otoOffer!.id;
  });

  test.afterAll(async () => {
    if (otoOfferId) {
      await supabaseAdmin.from('oto_offers').delete().eq('id', otoOfferId);
    }
    if (adminUserId && noRedirectProductId) {
      await supabaseAdmin.from('user_product_access')
        .delete()
        .eq('user_id', adminUserId)
        .eq('product_id', noRedirectProductId);
    }
    const slugs = [noRedirectSlug, successUrlSlug, urlParamSlug, otoMainSlug, otoTargetSlug];
    for (const slug of slugs) {
      if (slug) await supabaseAdmin.from('products').delete().eq('slug', slug);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  // Helper: complete funnel test and click "Go to Product"
  async function completeFunnelTest(page: Parameters<typeof loginAsAdmin>[0], slug: string, extraParams = '') {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${slug}?funnel_test=1${extraParams}`);
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    const goToProductBtn = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(goToProductBtn).toBeVisible({ timeout: 5000 });

    // Start waitForURL BEFORE clicking to avoid race where navigation resolves
    // before the assertion is set up
    const urlPromise = page.waitForURL(new RegExp(`/p/${slug}`), { timeout: 15000, waitUntil: 'commit' });
    await goToProductBtn.click();
    return urlPromise;
  }

  // =========================================================================
  // No redirect configured, admin HAS product access → end of funnel
  // =========================================================================

  test('no redirect configured (has access): should go to dashboard/products with end-of-funnel toast', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${noRedirectSlug}?funnel_test=1`);
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    const goToProductBtn = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(goToProductBtn).toBeVisible({ timeout: 5000 });

    const adminUrl = page.waitForURL(/\/dashboard\/products/, { timeout: 10000, waitUntil: 'commit' });
    await goToProductBtn.click();
    await adminUrl;

    expect(page.url()).toContain('/dashboard/products');
    await expect(page.getByText(/Koniec lejka|End of funnel/i)).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // No redirect configured, admin has NO product access → end of funnel
  // (previously bounced to checkout — now correctly shows end-of-funnel)
  // =========================================================================

  test('no redirect configured (no access): should go to dashboard/products with end-of-funnel toast', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${urlParamSlug}?funnel_test=1`);
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    const goToProductBtn = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(goToProductBtn).toBeVisible({ timeout: 5000 });

    const adminUrl = page.waitForURL(/\/dashboard\/products/, { timeout: 10000, waitUntil: 'commit' });
    await goToProductBtn.click();
    await adminUrl;

    expect(page.url()).toContain('/dashboard/products');
    await expect(page.getByText(/Koniec lejka|End of funnel/i)).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // Product has success_redirect_url → should follow it
  // =========================================================================

  test('success_redirect_url configured: should redirect to that URL after completing test', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${successUrlSlug}?funnel_test=1`);
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    const goToProductBtn = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(goToProductBtn).toBeVisible({ timeout: 5000 });

    const urlPromise = page.waitForURL(new RegExp(SUCCESS_REDIRECT_PATH), { timeout: 10000, waitUntil: 'commit' });
    await goToProductBtn.click();
    await urlPromise;

    expect(page.url()).toContain(SUCCESS_REDIRECT_PATH);
    expect(page.url()).not.toContain(`/p/${successUrlSlug}`);
    expect(page.url()).not.toContain(`/checkout/${successUrlSlug}`);
  });

  // =========================================================================
  // ?success_url param in URL (priority 1, overrides product setting)
  // =========================================================================

  test('?success_url param in URL: should redirect to it after completing test', async ({ page }) => {
    const overrideUrl = '/my-products';
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${urlParamSlug}?funnel_test=1&success_url=${encodeURIComponent(overrideUrl)}`);
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    const goToProductBtn = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(goToProductBtn).toBeVisible({ timeout: 5000 });

    const urlPromise = page.waitForURL(new RegExp(overrideUrl), { timeout: 10000, waitUntil: 'commit' });
    await goToProductBtn.click();
    await urlPromise;

    expect(page.url()).toContain(overrideUrl);
    expect(page.url()).not.toContain(`/checkout/${urlParamSlug}`);
  });

  // =========================================================================
  // ?success_url param OVERRIDES product's success_redirect_url (priority conflict)
  // =========================================================================

  test('?success_url param wins over product success_redirect_url when both present', async ({ page }) => {
    // successUrlSlug has success_redirect_url = '/my-products'
    // We pass ?success_url=/dashboard — the URL param must win
    const overrideUrl = '/dashboard';
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${successUrlSlug}?funnel_test=1&success_url=${encodeURIComponent(overrideUrl)}`);
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    const goToProductBtn = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(goToProductBtn).toBeVisible({ timeout: 5000 });

    const urlPromise = page.waitForURL(new RegExp(overrideUrl), { timeout: 10000, waitUntil: 'commit' });
    await goToProductBtn.click();
    await urlPromise;

    expect(page.url()).toContain(overrideUrl);
    // Should NOT go to the product's configured redirect
    expect(page.url()).not.toContain(SUCCESS_REDIRECT_PATH);
    expect(page.url()).not.toContain(`/p/${successUrlSlug}`);
  });

  // =========================================================================
  // OTO configured → redirect to OTO target checkout (simulates post-purchase flow)
  // =========================================================================

  test('OTO configured: should redirect to OTO target checkout after completing test', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${otoMainSlug}?funnel_test=1`);
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    const goToProductBtn = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(goToProductBtn).toBeVisible({ timeout: 5000 });

    // EXPECTED: admin is redirected to the OTO target product's checkout (simulating the post-purchase OTO flow)
    // ACTUAL (before fix): bounces to /checkout/otoMainSlug (no access → checkout redirect)
    const urlPromise = page.waitForURL(new RegExp(`/checkout/${otoTargetSlug}`), { timeout: 10000, waitUntil: 'commit' });
    await goToProductBtn.click();
    await urlPromise;

    expect(page.url()).toContain(`/checkout/${otoTargetSlug}`);
    expect(page.url()).not.toContain(`/checkout/${otoMainSlug}`);
  });

  // =========================================================================
  // Auto-redirect countdown also uses the fixed handleRedirectToProduct()
  // Both the button and the 5s countdown go through the same function.
  // =========================================================================

  test('auto-redirect countdown: should go to success_redirect_url, not product/checkout', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${successUrlSlug}?funnel_test=1`);
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    // Do NOT click "Go to Product" — let the 5s countdown auto-redirect
    await expect(page.getByText(/Przekierowanie za/i)).toBeVisible({ timeout: 5000 });

    // Wait for countdown to finish and redirect (5 seconds + buffer)
    await page.waitForURL(new RegExp(SUCCESS_REDIRECT_PATH), { timeout: 12000, waitUntil: 'commit' });
    expect(page.url()).toContain(SUCCESS_REDIRECT_PATH);
  });

  // =========================================================================
  // FULL FUNNEL SIMULATION — one browser session, multiple steps
  //
  // Simulates what an admin sees when previewing the entire funnel:
  //   1. Main product checkout → click "Zapłać (symulacja)"
  //   2. Redirect to OTO checkout (funnel_test=1 carried over automatically)
  //   3. OTO checkout → click "Zapłać (symulacja)" again
  //   4. End of funnel — lands on final destination
  //
  // This verifies the whole chain works without closing/reopening the browser.
  // =========================================================================

  test('full funnel simulation: main → OTO → end (one continuous session)', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    // === Step 1: Main product checkout ===
    await page.goto(`/checkout/${otoMainSlug}?funnel_test=1`);
    await page.waitForLoadState('domcontentloaded');

    const step1Button = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(step1Button).toBeVisible({ timeout: 15000 });
    await step1Button.click();

    const step1Redirect = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(step1Redirect).toBeVisible({ timeout: 5000 });

    // Pre-register before clicking to avoid race
    const otoCheckoutUrl = page.waitForURL(
      new RegExp(`/checkout/${otoTargetSlug}`),
      { timeout: 10000, waitUntil: 'commit' }
    );
    await step1Redirect.click();
    await otoCheckoutUrl;

    // === Step 2: Now on OTO checkout — still in funnel_test mode ===
    expect(page.url()).toContain(`/checkout/${otoTargetSlug}`);
    expect(page.url()).toContain('funnel_test=1');

    const step2Button = page.getByRole('button', { name: /Zapłać.*symulacja/i });
    await expect(step2Button).toBeVisible({ timeout: 15000 });
    await step2Button.click();

    const step2Redirect = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(step2Redirect).toBeVisible({ timeout: 5000 });

    // OTO target has no further OTO and no success_redirect_url →
    // funnel test fallback: redirect to admin/products + toast
    const endUrl = page.waitForURL(/\/dashboard\/products/, { timeout: 10000, waitUntil: 'commit' });
    await step2Redirect.click();
    await endUrl;

    // Funnel chain completed — landed on admin products with end-of-funnel toast
    expect(page.url()).toContain('/dashboard/products');
    await expect(page.getByText(/Koniec lejka|End of funnel/i)).toBeVisible({ timeout: 5000 });
    expect(page.url()).not.toContain(otoMainSlug);
    expect(page.url()).not.toContain(otoTargetSlug);
  });
});
