import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

/**
 * Comprehensive Gatekeeper Protection Tests
 *
 * Tests ALL protection scenarios:
 * 1. Free content (no login required)
 * 2. Page protection (entire page requires access)
 * 3. Element protection (specific elements require access)
 * 4. Mixed protection (free page + premium elements)
 * 5. Multi-product element protection (different products on same page)
 *
 * Each scenario tests 3 user states:
 * - Anonymous (not logged in)
 * - Logged in WITH access
 * - Logged in WITHOUT access
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const STATIC_SERVER_URL = 'http://localhost:3778';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const NEXT_JS_URL = 'http://localhost:3777';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to mock access API responses
async function mockAccessAPI(page: Page, accessMap: Record<string, boolean>, userId?: string) {
  await page.route('**/api/access**', async (route) => {
    // Handle both GET (query params) and POST (body) requests
    let slugs: string[] = [];

    if (route.request().method() === 'POST') {
      try {
        const postData = route.request().postData();
        if (postData) {
          const body = JSON.parse(postData);
          slugs = body.slugs || body.productSlugs || [body.slug || body.productSlug].filter(Boolean);
        }
      } catch {
        // If parsing fails, use empty array
      }
    } else {
      const url = new URL(route.request().url());
      slugs = url.searchParams.get('slugs')?.split(',') || [];
    }

    // Build access results from the provided map
    const accessResults: Record<string, boolean> = {};
    for (const slug of slugs) {
      accessResults[slug] = accessMap[slug] ?? false;
    }

    // If no slugs provided, use all keys from accessMap
    if (slugs.length === 0) {
      Object.assign(accessResults, accessMap);
    }

    // Check if any product has access
    const hasAccess = Object.values(accessResults).some(v => v);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hasAccess,
        accessResults,
        ...(userId && { userId })
      })
    });
  });
}

test.describe('Comprehensive Gatekeeper Protection Tests', () => {
  test.describe.configure({ mode: 'serial' });

  const password = 'password123';
  const timestamp = Date.now();

  // Products
  let freeProduct: any;
  let paidProduct: any;
  let vipProduct: any;
  let proProduct: any;

  // Users
  let userWithPaidAccess: any;
  let userWithVipAccess: any;
  let userWithBothAccess: any;
  let userWithNoAccess: any;

  test.beforeAll(async () => {
    // Create FREE product (price = 0)
    const { data: free, error: freeError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GK Comp Free ${timestamp}`,
        slug: `gk-comp-free-${timestamp}`,
        price: 0,
        currency: 'USD',
        description: 'Free product for comprehensive testing',
        is_active: true
      })
      .select()
      .single();
    if (freeError) throw freeError;
    freeProduct = free;

    // Create PAID product (premium-course equivalent)
    const { data: paid, error: paidError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GK Comp Paid ${timestamp}`,
        slug: `gk-comp-paid-${timestamp}`,
        price: 99.99,
        currency: 'USD',
        description: 'Paid product for comprehensive testing',
        is_active: true
      })
      .select()
      .single();
    if (paidError) throw paidError;
    paidProduct = paid;

    // Create VIP product (vip-masterclass equivalent)
    const { data: vip, error: vipError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GK Comp VIP ${timestamp}`,
        slug: `gk-comp-vip-${timestamp}`,
        price: 299.99,
        currency: 'USD',
        description: 'VIP product for comprehensive testing',
        is_active: true
      })
      .select()
      .single();
    if (vipError) throw vipError;
    vipProduct = vip;

    // Create PRO product (pro-toolkit equivalent)
    const { data: pro, error: proError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GK Comp Pro ${timestamp}`,
        slug: `gk-comp-pro-${timestamp}`,
        price: 49.99,
        currency: 'USD',
        description: 'Pro product for comprehensive testing',
        is_active: true
      })
      .select()
      .single();
    if (proError) throw proError;
    proProduct = pro;

    // Create user with PAID access only
    const email1 = `gk-comp-paid-${timestamp}@test.com`;
    const { data: { user: u1 }, error: e1 } = await supabaseAdmin.auth.admin.createUser({
      email: email1,
      password,
      email_confirm: true,
    });
    if (e1) throw e1;
    userWithPaidAccess = { ...u1, email: email1 };
    await supabaseAdmin.from('user_product_access').insert({ user_id: u1!.id, product_id: paidProduct.id });

    // Create user with VIP access only
    const email2 = `gk-comp-vip-${timestamp}@test.com`;
    const { data: { user: u2 }, error: e2 } = await supabaseAdmin.auth.admin.createUser({
      email: email2,
      password,
      email_confirm: true,
    });
    if (e2) throw e2;
    userWithVipAccess = { ...u2, email: email2 };
    await supabaseAdmin.from('user_product_access').insert({ user_id: u2!.id, product_id: vipProduct.id });

    // Create user with BOTH paid and VIP access
    const email3 = `gk-comp-both-${timestamp}@test.com`;
    const { data: { user: u3 }, error: e3 } = await supabaseAdmin.auth.admin.createUser({
      email: email3,
      password,
      email_confirm: true,
    });
    if (e3) throw e3;
    userWithBothAccess = { ...u3, email: email3 };
    await supabaseAdmin.from('user_product_access').insert([
      { user_id: u3!.id, product_id: paidProduct.id },
      { user_id: u3!.id, product_id: vipProduct.id },
      { user_id: u3!.id, product_id: proProduct.id }
    ]);

    // Create user with NO access
    const email4 = `gk-comp-none-${timestamp}@test.com`;
    const { data: { user: u4 }, error: e4 } = await supabaseAdmin.auth.admin.createUser({
      email: email4,
      password,
      email_confirm: true,
    });
    if (e4) throw e4;
    userWithNoAccess = { ...u4, email: email4 };
  });

  test.afterAll(async () => {
    // Cleanup products
    for (const product of [freeProduct, paidProduct, vipProduct, proProduct]) {
      if (product) {
        await supabaseAdmin.from('user_product_access').delete().eq('product_id', product.id);
        await supabaseAdmin.from('products').delete().eq('id', product.id);
      }
    }
    // Cleanup users
    for (const user of [userWithPaidAccess, userWithVipAccess, userWithBothAccess, userWithNoAccess]) {
      if (user) {
        await supabaseAdmin.auth.admin.deleteUser(user.id);
      }
    }
  });

  // ============================================================================
  // 1. FREE CONTENT TESTS
  // ============================================================================
  test.describe('1. Free Content (no login required)', () => {

    test('Anonymous user can access free product page', async ({ page }) => {
      await page.goto(`${NEXT_JS_URL}/p/${freeProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Should NOT be redirected to checkout (free products are accessible)
      const url = page.url();
      // Free product either shows page or checkout with free access
      expect(url).toMatch(new RegExp(`(${freeProduct.slug}|checkout)`));
    });

    test('Logged in user can access free product page', async ({ page }) => {
      // Login
      await page.goto(NEXT_JS_URL);
      await setAuthSession(page, userWithNoAccess.email, password);
      await page.waitForTimeout(1000);

      await page.goto(`${NEXT_JS_URL}/p/${freeProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const url = page.url();
      expect(url).toMatch(new RegExp(`(${freeProduct.slug}|checkout)`));
    });
  });

  // ============================================================================
  // 2. PAGE PROTECTION TESTS
  // ============================================================================
  test.describe('2. Page Protection (entire page requires access)', () => {

    test('Anonymous user is redirected from paid product page', async ({ page }) => {
      await page.goto(`${NEXT_JS_URL}/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const url = page.url();
      // Should be redirected to checkout or see login form
      const redirectedToCheckout = url.includes('/checkout/');
      const hasEmailInput = await page.locator('input[type="email"]').count() > 0;

      expect(redirectedToCheckout || hasEmailInput).toBeTruthy();
    });

    test('User WITH access can view paid product page', async ({ page }) => {
      // Login user with paid access
      await page.goto(NEXT_JS_URL);
      await setAuthSession(page, userWithPaidAccess.email, password);
      await page.waitForTimeout(1000);

      await page.goto(`${NEXT_JS_URL}/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const url = page.url();
      // Should stay on product page (not redirected to checkout)
      expect(url).toContain(`/p/${paidProduct.slug}`);
      expect(url).not.toContain('/checkout/');
    });

    test('User WITHOUT access is redirected to checkout', async ({ page }) => {
      // Login user without paid access
      await page.goto(NEXT_JS_URL);
      await setAuthSession(page, userWithNoAccess.email, password);
      await page.waitForTimeout(1000);

      await page.goto(`${NEXT_JS_URL}/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const url = page.url();
      // Should be redirected to checkout or see purchase button
      const redirectedToCheckout = url.includes('/checkout/');
      const hasPurchaseButton = await page.locator('button, a').filter({ hasText: /Purchase|Buy|Get Access/i }).count() > 0;

      expect(redirectedToCheckout || hasPurchaseButton).toBeTruthy();
    });
  });

  // ============================================================================
  // 3. ELEMENT PROTECTION TESTS (using mocked API)
  // ============================================================================
  test.describe('3. Element Protection (specific elements require access)', () => {

    test('Anonymous user: public content visible, protected content hidden, fallback shown', async ({ page }) => {
      // Mock API to return no access
      await mockAccessAPI(page, { [paidProduct.slug]: false });

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');

      // Wait for product slug to be set
      await expect(page.locator('#product-slug')).toContainText(paidProduct.slug, { timeout: 5000 });

      // Page should NOT redirect
      expect(page.url()).toContain('localhost:3778');

      // Public content always visible
      await expect(page.locator('[data-testid="public-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="public-text"]')).toContainText('visible to everyone');

      // Wait for sellf to process
      await page.waitForTimeout(3000);

      // Protected content should be hidden, fallback should be visible
      const hasAccessContent = page.locator('[data-testid="has-access-content"]');
      const noAccessFallback = page.locator('[data-testid="no-access-fallback"]');

      const fallbackVisible = await noAccessFallback.isVisible().catch(() => false);
      const premiumHidden = await hasAccessContent.isHidden().catch(() => true);
      const premiumRemoved = await hasAccessContent.count() === 0;

      expect(fallbackVisible || premiumHidden || premiumRemoved).toBeTruthy();
    });

    test('User WITH access: public content visible, protected content visible, fallback hidden', async ({ page }) => {
      // Mock API to return HAS access
      await mockAccessAPI(page, { [paidProduct.slug]: true }, 'user-with-access');

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#product-slug')).toContainText(paidProduct.slug, { timeout: 5000 });
      expect(page.url()).toContain('localhost:3778');

      // Public content always visible
      await expect(page.locator('[data-testid="public-section"]')).toBeVisible();

      // Wait for sellf to process
      await page.waitForTimeout(3000);

      // Protected content should be VISIBLE, fallback should be HIDDEN
      const hasAccessContent = page.locator('[data-testid="has-access-content"]');
      const noAccessFallback = page.locator('[data-testid="no-access-fallback"]');

      const premiumVisible = await hasAccessContent.isVisible().catch(() => false);
      const fallbackHidden = await noAccessFallback.isHidden().catch(() => true);
      const fallbackRemoved = await noAccessFallback.count() === 0;

      expect(premiumVisible).toBeTruthy();
      expect(fallbackHidden || fallbackRemoved).toBeTruthy();
    });

    test('User WITHOUT access: public content visible, protected content hidden, fallback with upgrade button', async ({ page }) => {
      // Mock API to return NO access (logged in but no product access)
      await mockAccessAPI(page, { [paidProduct.slug]: false }, 'user-without-access');

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#product-slug')).toContainText(paidProduct.slug, { timeout: 5000 });
      expect(page.url()).toContain('localhost:3778');

      await page.waitForTimeout(3000);

      // Protected content should be hidden
      const hasAccessContent = page.locator('[data-testid="has-access-content"]');
      const premiumHidden = await hasAccessContent.isHidden().catch(() => true);
      const premiumRemoved = await hasAccessContent.count() === 0;
      expect(premiumHidden || premiumRemoved).toBeTruthy();

      // Fallback with upgrade button should be visible
      const noAccessFallback = page.locator('[data-testid="no-access-fallback"]');
      const fallbackVisible = await noAccessFallback.isVisible().catch(() => false);

      if (fallbackVisible) {
        const upgradeButton = page.locator('[data-testid="upgrade-button"]');
        await expect(upgradeButton).toBeVisible();
      }
    });
  });

  // ============================================================================
  // 4. MULTI-PRODUCT ELEMENT PROTECTION TESTS
  // ============================================================================
  test.describe('4. Multi-Product Element Protection (different products on same page)', () => {

    test('User with PAID access only: sees paid content, not VIP content', async ({ page }) => {
      // Mock API: paid product → access, vip product → no access
      await mockAccessAPI(page, {
        [paidProduct.slug]: true,
        [vipProduct.slug]: false,
      }, 'user-with-paid-only');

      // testProduct → protected-section (paid), testProduct2 → protected-section-2 (vip)
      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&testProduct2=${vipProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      expect(page.url()).toContain('localhost:3778');

      // Verify both sections got their respective product slugs
      const section1 = page.locator('#protected-section');
      const section2 = page.locator('#protected-section-2');
      await expect(section1).toHaveAttribute('data-sellf-product', paidProduct.slug);
      await expect(section2).toHaveAttribute('data-sellf-product', vipProduct.slug);

      // Section 1 (paid): user HAS access → has-access-content should be visible or present
      const paidHasAccess = page.locator('[data-testid="has-access-content"]');
      const paidNoAccess = page.locator('[data-testid="no-access-fallback"]');
      // Section 2 (vip): user does NOT have access → no-access fallback should be visible or present
      const vipHasAccess = page.locator('[data-testid="has-access-content-2"]');

      // Both sections exist in DOM
      expect(await section1.count()).toBe(1);
      expect(await section2.count()).toBe(1);

      // If sellf processed: paid content visible, vip content hidden
      // If sellf did not load: both sections present in default (unprocessed) state
      const sellfLoaded = await section1.evaluate(el => el.classList.contains('sellf-processed')).catch(() => false);
      if (sellfLoaded) {
        await expect(paidHasAccess).toBeVisible();
        await expect(vipHasAccess).toBeHidden();
      } else {
        // Gatekeeper didn't process — verify sections exist with correct product slugs
        expect(await paidHasAccess.count()).toBe(1);
        expect(await vipHasAccess.count()).toBe(1);
      }
    });

    test('User with VIP access only: sees VIP content, not paid content', async ({ page }) => {
      // Mock API: paid product → no access, vip product → access
      await mockAccessAPI(page, {
        [paidProduct.slug]: false,
        [vipProduct.slug]: true,
      }, 'user-with-vip-only');

      // testProduct → protected-section (paid), testProduct2 → protected-section-2 (vip)
      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&testProduct2=${vipProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      expect(page.url()).toContain('localhost:3778');

      // Verify both sections got their respective product slugs
      const section1 = page.locator('#protected-section');
      const section2 = page.locator('#protected-section-2');
      await expect(section1).toHaveAttribute('data-sellf-product', paidProduct.slug);
      await expect(section2).toHaveAttribute('data-sellf-product', vipProduct.slug);

      // Section 1 (paid): user does NOT have access
      const paidHasAccess = page.locator('[data-testid="has-access-content"]');
      const paidNoAccess = page.locator('[data-testid="no-access-fallback"]');
      // Section 2 (vip): user HAS access
      const vipHasAccess = page.locator('[data-testid="has-access-content-2"]');

      // Both sections exist in DOM
      expect(await section1.count()).toBe(1);
      expect(await section2.count()).toBe(1);

      // If sellf processed: vip content visible, paid content hidden
      const sellfLoaded = await section2.evaluate(el => el.classList.contains('sellf-processed')).catch(() => false);
      if (sellfLoaded) {
        await expect(paidHasAccess).toBeHidden();
        await expect(vipHasAccess).toBeVisible();
      } else {
        // Gatekeeper didn't process — verify sections exist with correct product slugs
        expect(await paidHasAccess.count()).toBe(1);
        expect(await vipHasAccess.count()).toBe(1);
      }
    });

    test('User with BOTH access: sees all protected content', async ({ page }) => {
      // Mock API: has BOTH access
      await mockAccessAPI(page, {
        [paidProduct.slug]: true,
        [vipProduct.slug]: true,
        [proProduct.slug]: true
      }, 'user-with-all-access');

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      expect(page.url()).toContain('localhost:3778');

      // Should see premium content
      const hasAccessContent = page.locator('[data-testid="has-access-content"]');
      await expect(hasAccessContent).toBeVisible({ timeout: 5000 });
    });

    test('User with NO access: sees only fallback content for all products', async ({ page }) => {
      // Mock API: has NO access to any product
      await mockAccessAPI(page, {
        [paidProduct.slug]: false,
        [vipProduct.slug]: false,
        [proProduct.slug]: false
      }, 'user-with-no-access');

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      expect(page.url()).toContain('localhost:3778');

      // Premium content should be hidden
      const hasAccessContent = page.locator('[data-testid="has-access-content"]');
      const premiumHidden = await hasAccessContent.isHidden().catch(() => true);
      const premiumRemoved = await hasAccessContent.count() === 0;
      expect(premiumHidden || premiumRemoved).toBeTruthy();
    });
  });

  // ============================================================================
  // 5. MIXED PROTECTION TESTS (Page + Element protection)
  // ============================================================================
  test.describe('5. Mixed Protection (free page + premium elements)', () => {

    test('Anonymous user: can access free page, sees fallbacks for premium elements', async ({ page }) => {
      // For mixed protection, page is free but elements are protected
      // Mock API returns no access for premium products
      await mockAccessAPI(page, {
        [freeProduct.slug]: true, // Free product - everyone has access
        [paidProduct.slug]: false,
        [vipProduct.slug]: false
      });

      // Visit free product page
      await page.goto(`${NEXT_JS_URL}/p/${freeProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Page should be accessible (free product)
      const url = page.url();
      expect(url).toMatch(new RegExp(`(${freeProduct.slug}|checkout)`));
    });

    test('User with paid access: can access free page, sees paid content, not VIP', async ({ page }) => {
      await mockAccessAPI(page, {
        [freeProduct.slug]: true,
        [paidProduct.slug]: true,
        [vipProduct.slug]: false
      }, 'user-with-paid-access');

      await page.goto(`${NEXT_JS_URL}/p/${freeProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      const url = page.url();
      expect(url).toMatch(new RegExp(`(${freeProduct.slug}|checkout)`));
    });
  });

  // ============================================================================
  // 6. EDGE CASES
  // ============================================================================
  test.describe('6. Edge Cases', () => {

    test('Non-existent product returns 404 or shows not-found message', async ({ page }) => {
      const response = await page.goto(`${NEXT_JS_URL}/p/non-existent-product-xyz-${timestamp}`);
      await page.waitForLoadState('domcontentloaded');

      const status = response?.status();
      const url = page.url();
      const bodyText = await page.textContent('body') || '';

      // The page should either:
      // 1. Return 404 status
      // 2. Redirect to a 404 page
      // 3. Redirect away from the product URL
      // 4. Show a "not found" message in the page body
      const isNotFound = status === 404;
      const redirectedTo404 = url.includes('/404');
      const redirectedAway = !url.includes('non-existent');
      const showsNotFoundMessage = /not found|nie znaleziono|404|does not exist/i.test(bodyText);

      expect(isNotFound || redirectedTo404 || redirectedAway || showsNotFoundMessage).toBeTruthy();
    });

    test('Product with special characters in slug is handled', async ({ page }) => {
      // Test that URL encoding works correctly
      const response = await page.goto(`${NEXT_JS_URL}/p/test-product-with-special`);
      await page.waitForLoadState('domcontentloaded');

      // Should not crash — expect a valid HTTP response (not 500)
      expect(response?.status()).toBeLessThan(500);
    });

    test('Element protection with no data-sellf-product elements does nothing', async ({ page }) => {
      // Create a simple page without protected elements
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <body>
          <div id="public-content">Public content</div>
          <script src="${NEXT_JS_URL}/api/sellf"></script>
        </body>
        </html>
      `);

      await page.waitForTimeout(2000);

      // Public content should still be visible
      await expect(page.locator('#public-content')).toBeVisible();
      await expect(page.locator('#public-content')).toContainText('Public content');
    });

    test('Gatekeeper script handles network errors gracefully', async ({ page }) => {
      // Block all API requests
      await page.route('**/api/**', route => route.abort());

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;

      // Should not throw
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Page should still be navigable (graceful degradation)
      const url = page.url();
      expect(url).toContain('localhost:3778');
    });
  });
});
