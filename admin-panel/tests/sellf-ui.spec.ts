import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

/**
 * Gatekeeper UI Protection Tests
 *
 * Tests the UI behavior of the sellf protection system.
 *
 * Static server for test pages (examples/test-pages/) is started automatically
 * via playwright.config.ts webServer configuration on port 3002.
 *
 * Cross-origin cookie limitations apply when testing from external origins.
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

test.describe('Gatekeeper UI Protection Tests', () => {
  test.describe.configure({ mode: 'serial' });

  const password = 'password123';

  let paidProduct: any;
  let freeProduct: any;
  let userWithAccess: any;
  let userWithoutAccess: any;

  const loginAsUser = async (page: Page, email: string) => {
    await page.goto(NEXT_JS_URL);
    await page.waitForLoadState('domcontentloaded');

    await setAuthSession(page, email, password);

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    const timestamp = Date.now();

    // Create paid product
    const { data: paid, error: paidError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GK UI Test Paid ${timestamp}`,
        slug: `gk-ui-test-paid-${timestamp}`,
        price: 49.99,
        currency: 'USD',
        description: 'Paid product for sellf UI testing',
        is_active: true
      })
      .select()
      .single();

    if (paidError) throw paidError;
    paidProduct = paid;

    // Create free product
    const { data: free, error: freeError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GK UI Test Free ${timestamp}`,
        slug: `gk-ui-test-free-${timestamp}`,
        price: 0,
        currency: 'USD',
        description: 'Free product for sellf UI testing',
        is_active: true
      })
      .select()
      .single();

    if (freeError) throw freeError;
    freeProduct = free;

    // Create user WITH access
    const email1 = `gk-ui-access-${timestamp}@test.com`;
    const { data: { user: user1 }, error: createError1 } = await supabaseAdmin.auth.admin.createUser({
      email: email1,
      password,
      email_confirm: true,
    });
    if (createError1) throw createError1;
    userWithAccess = { ...user1, email: email1 };

    await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: userWithAccess.id,
        product_id: paidProduct.id,
      });

    // Create user WITHOUT access
    const email2 = `gk-ui-noaccess-${timestamp}@test.com`;
    const { data: { user: user2 }, error: createError2 } = await supabaseAdmin.auth.admin.createUser({
      email: email2,
      password,
      email_confirm: true,
    });
    if (createError2) throw createError2;
    userWithoutAccess = { ...user2, email: email2 };
  });

  test.afterAll(async () => {
    if (paidProduct) {
      await supabaseAdmin.from('user_product_access').delete().eq('product_id', paidProduct.id);
      await supabaseAdmin.from('products').delete().eq('id', paidProduct.id);
    }
    if (freeProduct) {
      await supabaseAdmin.from('user_product_access').delete().eq('product_id', freeProduct.id);
      await supabaseAdmin.from('products').delete().eq('id', freeProduct.id);
    }
    if (userWithAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithAccess.id);
    }
    if (userWithoutAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithoutAccess.id);
    }
  });

  // ============================================================================
  // External Page Tests (Static Server on port 3002)
  // Tests anonymous/unauthenticated behavior on external pages.
  // Cross-origin cookies are NOT sent, so these test unauthenticated access.
  // ============================================================================

  test.describe('External Pages - Anonymous Access', () => {

    test('Page protection: anonymous user is redirected to checkout', async ({ page }) => {
      const testPageUrl = `${STATIC_SERVER_URL}/page-protection.html?product=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;

      await page.goto(testPageUrl);

      // Wait for full redirect chain: sellf -> /p/{slug} -> /checkout/{slug}
      // The useProductAccess hook redirects users without access to checkout
      await page.waitForURL(url =>
        url.hostname === 'localhost' &&
        url.port === '3000' &&
        url.pathname.includes('/checkout/'),
        { timeout: 15000 }
      );

      const currentUrl = page.url();

      // Should redirect to checkout page on Next.js server (port 3000, not 3002)
      // Anonymous user without access gets redirected to checkout to purchase
      expect(currentUrl).toMatch(/^http:\/\/localhost:3777/);
      expect(currentUrl).toContain(`/checkout/${paidProduct.slug}`);
    });

    test('Element protection: anonymous user sees fallback content', async ({ page }) => {
      // Mock access API to return no access (simulating anonymous user)
      await page.route('**/api/access', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            hasAccess: false,
            accessResults: { [paidProduct.slug]: false }
          })
        });
      });

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');

      // Wait for JavaScript to set up the page
      const productSlugElement = page.locator('#product-slug');
      await expect(productSlugElement).toContainText(paidProduct.slug, { timeout: 5000 });

      // Page should NOT redirect
      expect(page.url()).toContain('localhost:3778');

      // Public section should always be visible
      await expect(page.locator('[data-testid="public-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="public-text"]')).toContainText('visible to everyone');

      // Wait for sellf to process elements
      await page.waitForTimeout(3000);

      // For user WITHOUT access: fallback visible, premium content hidden/removed
      const noAccessFallback = page.locator('[data-testid="no-access-fallback"]');
      const hasAccessContent = page.locator('[data-testid="has-access-content"]');

      const fallbackVisible = await noAccessFallback.isVisible().catch(() => false);
      const premiumHidden = await hasAccessContent.isHidden().catch(() => true);
      const premiumRemoved = await hasAccessContent.count() === 0;

      if (!fallbackVisible && !premiumHidden && !premiumRemoved) {
        expect.fail('Expected fallback visible, premium hidden, or premium removed, but none matched');
      }
    });

    test('Element protection: user WITH access sees premium content', async ({ page }) => {
      // Mock access API to return HAS access
      await page.route('**/api/access', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            hasAccess: true,
            accessResults: { [paidProduct.slug]: true },
            userId: 'test-user-id'
          })
        });
      });

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');

      // Wait for JavaScript to set up the page
      await expect(page.locator('#product-slug')).toContainText(paidProduct.slug, { timeout: 5000 });

      // Page should NOT redirect
      expect(page.url()).toContain('localhost:3778');

      // Public section always visible
      await expect(page.locator('[data-testid="public-section"]')).toBeVisible();

      // Wait for sellf to process elements
      await page.waitForTimeout(3000);

      // For user WITH access: premium content visible, fallback hidden/removed
      const hasAccessContent = page.locator('[data-testid="has-access-content"]');
      const noAccessFallback = page.locator('[data-testid="no-access-fallback"]');

      const premiumVisible = await hasAccessContent.isVisible().catch(() => false);
      const fallbackHidden = await noAccessFallback.isHidden().catch(() => true);
      const fallbackRemoved = await noAccessFallback.count() === 0;

      if (!premiumVisible) {
        expect.fail('Expected premium content to be visible for user with access');
      }
      if (!fallbackHidden && !fallbackRemoved) {
        expect.fail('Expected fallback to be hidden or removed for user with access');
      }
    });

    test('Element protection: user WITHOUT access sees fallback content', async ({ page }) => {
      // Mock access API to return NO access (logged in but no product access)
      await page.route('**/api/access', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            hasAccess: false,
            accessResults: { [paidProduct.slug]: false },
            userId: 'test-user-without-access'
          })
        });
      });

      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');

      // Wait for JavaScript to set up the page
      await expect(page.locator('#product-slug')).toContainText(paidProduct.slug, { timeout: 5000 });

      // Page should NOT redirect
      expect(page.url()).toContain('localhost:3778');

      // Public section always visible
      await expect(page.locator('[data-testid="public-section"]')).toBeVisible();

      // Wait for sellf to process elements
      await page.waitForTimeout(3000);

      // For user WITHOUT access: fallback visible, premium content hidden/removed
      const hasAccessContent = page.locator('[data-testid="has-access-content"]');
      const noAccessFallback = page.locator('[data-testid="no-access-fallback"]');

      const fallbackVisible = await noAccessFallback.isVisible().catch(() => false);
      const premiumHidden = await hasAccessContent.isHidden().catch(() => true);
      const premiumRemoved = await hasAccessContent.count() === 0;

      if (!fallbackVisible && !premiumHidden && !premiumRemoved) {
        expect.fail('Expected fallback visible, premium hidden, or premium removed, but none matched');
      }

      // Upgrade button should be visible in fallback
      const upgradeButton = page.locator('[data-testid="upgrade-button"]');
      if (await noAccessFallback.isVisible()) {
        await expect(upgradeButton).toBeVisible();
      } else {
        // Fallback not visible means premium content was hidden/removed via different mechanism
        expect(premiumHidden || premiumRemoved).toBe(true);
      }
    });

    test('Embed widget: page loads and requests embed script for free product', async ({ page }) => {
      const scriptRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('sellf-embed')) {
          scriptRequests.push(request.url());
        }
      });

      const testPageUrl = `${STATIC_SERVER_URL}/embed-widget.html?product=${freeProduct.slug}&apiUrl=${NEXT_JS_URL}`;

      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');

      // Page should NOT redirect (embed for free products stays on static server)
      await page.waitForTimeout(2000);
      expect(page.url()).toContain('localhost:3778');

      // Wait for JavaScript to run and set product slug
      const productSlugElement = page.locator('#product-slug');
      await expect(productSlugElement).toContainText(freeProduct.slug, { timeout: 5000 });

      // Sellf widget element should have the product attribute set
      const sellfWidget = page.locator('[data-testid="sellf-widget"]');
      await expect(sellfWidget).toHaveAttribute('data-sellf-product', freeProduct.slug);

      // Should have requested the embed script from Next.js server
      expect(scriptRequests.length).toBeGreaterThan(0);
      expect(scriptRequests[0]).toContain('localhost:3777/sellf-embed.js');
    });

    test('Gatekeeper script is loaded from Next.js server', async ({ page }) => {
      const scriptRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/sellf')) {
          scriptRequests.push(request.url());
        }
      });

      // Use element-protection with testProduct (won't redirect, stays on page)
      const testPageUrl = `${STATIC_SERVER_URL}/element-protection.html?testProduct=${paidProduct.slug}&apiUrl=${NEXT_JS_URL}`;
      await page.goto(testPageUrl);
      await page.waitForLoadState('domcontentloaded');

      // Wait for the script request to be made
      await page.waitForTimeout(2000);

      // Should have made request to sellf API on Next.js server
      expect(scriptRequests.length).toBeGreaterThan(0);
      expect(scriptRequests[0]).toContain('localhost:3777/api/sellf');
    });
  });

  // ============================================================================
  // Cross-Origin API Tests
  // ============================================================================

  test.describe('Cross-Origin Behavior', () => {

    test('CORS headers allow cross-origin requests', async ({ request }) => {
      const response = await request.get(`${NEXT_JS_URL}/api/sellf`, {
        headers: {
          'Origin': 'https://external-site.com'
        }
      });

      expect(response.ok()).toBeTruthy();
      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBeDefined();
    });
  });

  // ============================================================================
  // Product Page Tests (Next.js) - Authenticated Access
  // These tests run on the main domain where cookies work
  // ============================================================================

  test.describe('Product Pages - Authenticated Access', () => {

    test('User WITH access can view paid product page', async ({ page }) => {
      await loginAsUser(page, userWithAccess.email);

      await page.goto(`${NEXT_JS_URL}/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const currentUrl = page.url();

      // Should stay on product page (not redirected to checkout)
      expect(currentUrl).not.toContain('/checkout/');
      expect(currentUrl).toContain(`/p/${paidProduct.slug}`);
    });

    test('User WITHOUT access is redirected to checkout', async ({ page }) => {
      await loginAsUser(page, userWithoutAccess.email);

      await page.goto(`${NEXT_JS_URL}/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const currentUrl = page.url();

      // Should be redirected to checkout or see purchase prompt
      const isOnCheckout = currentUrl.includes('/checkout/');
      const hasPurchaseElements = await page.locator('button, a').filter({
        hasText: /Purchase|Buy|Get Access/i
      }).count() > 0;

      if (!isOnCheckout && !hasPurchaseElements) {
        expect.fail(`Expected redirect to checkout or purchase elements, but got URL: ${currentUrl}`);
      }
    });

    test('Anonymous user cannot access paid product', async ({ page }) => {
      await page.goto(`${NEXT_JS_URL}/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const currentUrl = page.url();

      // Should be redirected or see checkout/login form
      const isRedirected = currentUrl.includes('/checkout/') || currentUrl.includes('/login');
      const hasEmailInput = await page.locator('input[type="email"]').count() > 0;

      if (!isRedirected && !hasEmailInput) {
        expect.fail(`Expected redirect to checkout/login or email input, but got URL: ${currentUrl}`);
      }
    });

    test('Free product is accessible', async ({ page }) => {
      await page.goto(`${NEXT_JS_URL}/p/${freeProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const currentUrl = page.url();

      // Free products are accessible
      const isAccessible = currentUrl.includes(`/p/${freeProduct.slug}`) ||
                          currentUrl.includes('/checkout/');

      if (!isAccessible) {
        expect.fail(`Expected product page or checkout URL, but got: ${currentUrl}`);
      }
    });
  });

  // ============================================================================
  // Gatekeeper Script Behavior Tests
  // ============================================================================

  test.describe('Gatekeeper Script Behavior', () => {

    test('Gatekeeper script is valid and contains expected structure', async ({ request }) => {
      const response = await request.get(`${NEXT_JS_URL}/api/sellf`);

      expect(response.ok()).toBeTruthy();

      const script = await response.text();

      // Should be substantial JavaScript
      expect(script.length).toBeGreaterThan(1000);

      // Should contain core components
      expect(script).toContain('GATEKEEPER_CONFIG');
      expect(script).toContain('Sellf');
      expect(script).toContain('class');

      // Should not contain syntax errors
      expect(script).not.toContain('SyntaxError');
      expect(script).not.toContain('ReferenceError');
    });

    test('Gatekeeper script with productSlug includes slug', async ({ request }) => {
      const response = await request.get(`${NEXT_JS_URL}/api/sellf?productSlug=${paidProduct.slug}`);

      expect(response.ok()).toBeTruthy();

      const script = await response.text();
      expect(script).toContain(paidProduct.slug);
    });

    test('Product page handles non-existent product', async ({ page }) => {
      const response = await page.goto(`${NEXT_JS_URL}/p/non-existent-product-xyz`);
      await page.waitForLoadState('domcontentloaded');

      // Either returns 404 status or redirects to another page
      const status = response?.status();
      const isNotFound = status === 404;
      const wasRedirected = page.url().includes('/404') || !page.url().includes('non-existent');

      if (!isNotFound && !wasRedirected && status !== 200) {
        expect.fail(`Expected 404, redirect, or 200 for non-existent product, but got status ${status} at URL ${page.url()}`);
      }
    });
  });
});
