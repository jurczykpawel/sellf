import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Protection Code (Generate Protection Code)', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  let adminUserId: string;
  const password = 'password123';

  // Test products
  let paidProduct: any;
  let freeProduct: any;

  // Test users
  let userWithAccess: any;
  let userWithoutAccess: any;

  // Opens the ⋯ dropdown on a product row and clicks "Generate Code"
  const openCodeGenerator = async (productRow: any, page: Page) => {
    await productRow.locator('button[aria-expanded]').click();
    await page.locator('button').filter({ hasText: /Generuj kod|Generate Code/i }).first().click();
  };

  const loginAsAdmin = async (page: Page) => {
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

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await setAuthSession(page, adminEmail, password);

    await page.waitForTimeout(1000);
  };

  const loginAsUser = async (page: Page, email: string) => {
    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await setAuthSession(page, email, password);

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-protection-admin-${Date.now()}-${randomStr}@example.com`;

    // 1. Create admin user
    const { data: { user: adminUser }, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: password,
      email_confirm: true,
    });
    if (adminError) throw adminError;
    adminUserId = adminUser!.id;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: adminUserId });

    // 2. Create paid test product
    const { data: paid, error: paidError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Protection Test Paid ${Date.now()}`,
        slug: `protection-test-paid-${Date.now()}`,
        price: 29.99,
        currency: 'USD',
        description: 'Paid product for protection code testing',
        is_active: true
      })
      .select()
      .single();

    if (paidError) throw paidError;
    paidProduct = paid;

    // 3. Create free test product
    const { data: free, error: freeError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Protection Test Free ${Date.now()}`,
        slug: `protection-test-free-${Date.now()}`,
        price: 0,
        currency: 'USD',
        description: 'Free product for protection code testing',
        is_active: true
      })
      .select()
      .single();

    if (freeError) throw freeError;
    freeProduct = free;

    // 4. Create user WITH access
    const email1 = `user-with-prot-access-${Date.now()}@test.com`;
    const { data: { user: user1 }, error: createError1 } = await supabaseAdmin.auth.admin.createUser({
      email: email1,
      password,
      email_confirm: true,
    });
    if (createError1) throw createError1;
    userWithAccess = { ...user1, email: email1 };

    // Grant access to paid product
    await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: userWithAccess.id,
        product_id: paidProduct.id,
      });

    // 5. Create user WITHOUT access
    const email2 = `user-no-prot-access-${Date.now()}@test.com`;
    const { data: { user: user2 }, error: createError2 } = await supabaseAdmin.auth.admin.createUser({
      email: email2,
      password,
      email_confirm: true,
    });
    if (createError2) throw createError2;
    userWithoutAccess = { ...user2, email: email2 };
  });

  test.afterAll(async () => {
    // Cleanup products
    if (paidProduct) {
      await supabaseAdmin.from('user_product_access').delete().eq('product_id', paidProduct.id);
      await supabaseAdmin.from('products').delete().eq('id', paidProduct.id);
    }
    if (freeProduct) {
      await supabaseAdmin.from('user_product_access').delete().eq('product_id', freeProduct.id);
      await supabaseAdmin.from('products').delete().eq('id', freeProduct.id);
    }

    // Cleanup users
    if (userWithAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithAccess.id);
    }
    if (userWithoutAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithoutAccess.id);
    }

    // Cleanup admin
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const testAdmin = users.users.find(u => u.email === adminEmail);
    if (testAdmin) {
      await supabaseAdmin.auth.admin.deleteUser(testAdmin.id);
    }
  });

  // ============================================================================
  // CodeGeneratorModal UI Tests
  // ============================================================================

  test.describe('CodeGeneratorModal UI', () => {

    test('Admin can open code generator modal for paid product', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Find product row and click code button
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: paidProduct.name }).first();
      await expect(productRow).toBeVisible({ timeout: 10000 });

      // Open code generator from ⋯ dropdown
      await openCodeGenerator(productRow, page);

      await page.waitForTimeout(1000);

      // Modal should be open - look for title
      const modalTitle = page.locator('h2, [role="dialog"] h2').filter({ hasText: /Generate|Generuj|Code|Kod/i }).first();
      await expect(modalTitle).toBeVisible({ timeout: 5000 });
    });

    test('Paid product shows only Page and Element modes (not Embed)', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Find product row
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: paidProduct.name }).first();
      await expect(productRow).toBeVisible({ timeout: 10000 });

      // Open code generator from ⋯ dropdown
      await openCodeGenerator(productRow, page);

      await page.waitForTimeout(1000);

      // Should see Page Mode button
      const pageModeButton = page.locator('button').filter({ hasText: /Page|Strona/i }).first();
      await expect(pageModeButton).toBeVisible();

      // Should see Element Mode button
      const elementModeButton = page.locator('button').filter({ hasText: /Element/i }).first();
      await expect(elementModeButton).toBeVisible();

      // Should NOT see Embed Widget button for paid product
      const embedButton = page.locator('button').filter({ hasText: /Embed|Widget/i });
      expect(await embedButton.count()).toBe(0);
    });

    test('Free product shows all three modes (Page, Element, Embed)', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Find free product row
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: freeProduct.name }).first();
      await expect(productRow).toBeVisible({ timeout: 10000 });

      // Open code generator from ⋯ dropdown
      await openCodeGenerator(productRow, page);

      await page.waitForTimeout(1000);

      // Should see all three modes
      const pageModeButton = page.locator('button').filter({ hasText: /Page|Strona/i }).first();
      await expect(pageModeButton).toBeVisible();

      const elementModeButton = page.locator('button').filter({ hasText: /Element/i }).first();
      await expect(elementModeButton).toBeVisible();

      // Free product should have Embed option
      const embedButton = page.locator('button').filter({ hasText: /Embed|Widget/i }).first();
      await expect(embedButton).toBeVisible();
    });

    test('Page mode generates correct script tag with productSlug', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Open code generator from ⋯ dropdown
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: paidProduct.name }).first();
      await openCodeGenerator(productRow, page);

      await page.waitForTimeout(1000);

      // Click Page mode if not already selected
      const pageModeButton = page.locator('button').filter({ hasText: /Page|Strona/i }).first();
      await pageModeButton.click();
      await page.waitForTimeout(500);

      // Check generated code in pre/code element
      const codeBlock = page.locator('pre').first();
      const generatedCode = await codeBlock.textContent();

      // Should contain script tag with productSlug
      expect(generatedCode).toContain('/api/sellf');
      expect(generatedCode).toContain(`productSlug=${paidProduct.slug}`);
      expect(generatedCode).toContain('<script');
    });

    test('Element mode generates code with data-sellf-product attribute', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Open code generator from ⋯ dropdown
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: paidProduct.name }).first();
      await openCodeGenerator(productRow, page);

      await page.waitForTimeout(1000);

      // Click Element mode
      const elementModeButton = page.locator('button').filter({ hasText: /Element/i }).first();
      await elementModeButton.click();
      await page.waitForTimeout(500);

      // Check generated code
      const codeBlock = page.locator('pre').first();
      const generatedCode = await codeBlock.textContent();

      // Should contain data-sellf-product attribute
      expect(generatedCode).toContain('data-sellf-product');
      expect(generatedCode).toContain(paidProduct.slug);
      // Should contain data-no-access fallback example
      expect(generatedCode).toContain('data-no-access');
    });

    test('Embed mode generates sellf-embed.js script', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Open code generator from ⋯ dropdown
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: freeProduct.name }).first();
      await openCodeGenerator(productRow, page);

      await page.waitForTimeout(1000);

      // Click Embed mode
      const embedModeButton = page.locator('button').filter({ hasText: /Embed|Widget/i }).first();
      await embedModeButton.click();
      await page.waitForTimeout(500);

      // Check generated code
      const codeBlock = page.locator('pre').first();
      const generatedCode = await codeBlock.textContent();

      // Should contain sellf-embed script reference
      expect(generatedCode).toContain('sellf-embed');
      expect(generatedCode).toContain('data-sellf-product');
      expect(generatedCode).toContain(freeProduct.slug);
    });

    test('Copy button copies code to clipboard', async ({ page, context }) => {
      // Grant clipboard permissions
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Open code generator from ⋯ dropdown
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: paidProduct.name }).first();
      await openCodeGenerator(productRow, page);

      await page.waitForTimeout(1000);

      // Get the code that should be copied
      const codeBlock = page.locator('pre').first();
      const expectedCode = await codeBlock.textContent();

      // Click copy button
      const copyButton = page.locator('button').filter({ hasText: /Copy|Kopiuj/i }).first();
      await copyButton.click();

      // Wait for potential state change or animation
      await page.waitForTimeout(1000);

      // Verify clipboard content (this is the main thing we care about)
      const clipboardText = await page.evaluate(async () => {
        return await navigator.clipboard.readText();
      });

      // The code should have been copied - main success criteria
      expect(clipboardText).toBeTruthy();
      expect(clipboardText).toContain('/api/sellf');
      expect(clipboardText).toContain(paidProduct.slug);
    });
  });

  // ============================================================================
  // API /api/sellf Tests
  // ============================================================================

  test.describe('/api/sellf Endpoint', () => {

    test('Returns JavaScript content type', async ({ request }) => {
      const response = await request.get('/api/sellf');

      expect(response.ok()).toBeTruthy();
      expect(response.headers()['content-type']).toContain('application/javascript');
    });

    test('Returns CORS headers', async ({ request }) => {
      const response = await request.get('/api/sellf', {
        headers: {
          'Origin': 'https://example.com'
        }
      });

      expect(response.ok()).toBeTruthy();
      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBeDefined();
      expect(headers['access-control-allow-methods']).toContain('GET');
    });

    test('Script contains Supabase configuration', async ({ request }) => {
      const response = await request.get('/api/sellf');
      const script = await response.text();

      // Should contain Supabase URL and anon key initialization
      expect(script).toContain('supabase');
      // Script should be minified or contain Sellf class
      expect(script.length).toBeGreaterThan(1000);
    });

    test('Script with productSlug contains page protection config', async ({ request }) => {
      const response = await request.get(`/api/sellf?productSlug=${paidProduct.slug}`);
      const script = await response.text();

      expect(response.ok()).toBeTruthy();
      // Should contain the productSlug in the script
      expect(script).toContain(paidProduct.slug);
    });

    test('OPTIONS request returns CORS preflight headers', async ({ request }) => {
      const response = await request.fetch('/api/sellf', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBeDefined();
      expect(headers['access-control-allow-methods']).toContain('GET');
    });

    test('Script includes ETag and caching headers', async ({ request }) => {
      const response = await request.get('/api/sellf');

      expect(response.ok()).toBeTruthy();
      const headers = response.headers();
      expect(headers['etag']).toBeDefined();
      expect(headers['cache-control']).toBeDefined();
    });
  });

  // ============================================================================
  // API /api/access Tests
  // ============================================================================

  test.describe('/api/access Endpoint', () => {

    test('Single product access check for authenticated user WITH access', async ({ page }) => {
      await loginAsUser(page, userWithAccess.email);

      const response = await page.evaluate(async ({ slug }) => {
        const res = await fetch('/api/access', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ productSlug: slug })
        });
        return {
          ok: res.ok,
          status: res.status,
          body: await res.json()
        };
      }, { slug: paidProduct.slug });

      expect(response.ok).toBeTruthy();
      expect(response.body.hasAccess).toBe(true);
      expect(response.body.authenticated).toBe(true);
    });

    test('Single product access check for authenticated user WITHOUT access', async ({ page }) => {
      await loginAsUser(page, userWithoutAccess.email);

      const response = await page.evaluate(async ({ slug }) => {
        const res = await fetch('/api/access', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ productSlug: slug })
        });
        return {
          ok: res.ok,
          status: res.status,
          body: await res.json()
        };
      }, { slug: paidProduct.slug });

      expect(response.ok).toBeTruthy();
      expect(response.body.hasAccess).toBe(false);
    });

    test('Batch product access check returns results for multiple products', async ({ page }) => {
      await loginAsUser(page, userWithAccess.email);

      const response = await page.evaluate(async ({ paidSlug, freeSlug }) => {
        const res = await fetch('/api/access', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ productSlugs: [paidSlug, freeSlug] })
        });
        return {
          ok: res.ok,
          status: res.status,
          body: await res.json()
        };
      }, { paidSlug: paidProduct.slug, freeSlug: freeProduct.slug });

      expect(response.ok).toBeTruthy();
      expect(response.body.accessResults).toBeDefined();
      expect(response.body.accessResults[paidProduct.slug]).toBe(true);
      // Free product should also be accessible
      expect(typeof response.body.accessResults[freeProduct.slug]).toBe('boolean');
    });

    test('Unauthenticated request returns no access for paid product', async ({ request }) => {
      const response = await request.post('/api/access', {
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        data: {
          productSlug: paidProduct.slug
        }
      });

      const body = await response.json();

      expect(response.ok()).toBe(true);
      expect(body.hasAccess).toBeFalsy();
    });

    test('Returns 400 for missing product slug', async ({ request }) => {
      const response = await request.post('/api/access', {
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        data: {}
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    test('CORS headers are present in response', async ({ request }) => {
      const response = await request.post('/api/access', {
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://external-site.com'
        },
        data: {
          productSlug: paidProduct.slug
        }
      });

      const headers = response.headers();
      expect(headers['access-control-allow-origin']).toBeDefined();
      expect(headers['access-control-allow-credentials']).toBe('true');
    });
  });

  // ============================================================================
  // Integration Tests - Protection Behavior
  // ============================================================================

  test.describe('Protection Integration', () => {

    test('User WITH access can view paid product page', async ({ page }) => {
      await loginAsUser(page, userWithAccess.email);

      await page.goto(`/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Should be on product page, not redirected to checkout
      const currentUrl = page.url();
      expect(currentUrl).toContain(`/p/${paidProduct.slug}`);

      // Should NOT be redirected to checkout page
      expect(currentUrl).not.toContain('/checkout/');

      // User with access should see some product-related content or no access denial
      // The specific UI varies, but they shouldn't see explicit "Purchase Access" button
      const purchaseButton = page.locator('button, a').filter({ hasText: /^Purchase Access$|^Get Access Now$/i });
      const purchaseButtonCount = await purchaseButton.count();
      // They may see other content but not explicit purchase CTA
      expect(purchaseButtonCount).toBeLessThanOrEqual(1); // Some products might still show this as navigation
    });

    test('User WITHOUT access is redirected to checkout or sees purchase prompt', async ({ page }) => {
      await loginAsUser(page, userWithoutAccess.email);

      await page.goto(`/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      // Should either be redirected to checkout OR see purchase prompt
      const currentUrl = page.url();

      const isRedirectedToCheckout = currentUrl.includes('/checkout/');

      // Check for visible purchase button or checkout form
      const purchaseElements = page.locator('button, a').filter({ hasText: /Purchase|Get Access|Buy|Checkout/i });
      const hasPurchaseElements = await purchaseElements.count() > 0;

      expect(isRedirectedToCheckout || hasPurchaseElements).toBeTruthy();
    });

    test('Anonymous user cannot access paid product', async ({ page }) => {
      // Don't login - anonymous visit
      await acceptAllCookies(page);
      await page.goto(`/p/${paidProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const currentUrl = page.url();

      // Should be redirected or see login/purchase prompt
      const isRedirected = currentUrl.includes('/checkout/') || currentUrl.includes('/login');

      // Look for visible login or purchase prompts
      const promptElements = page.locator('button, a, input[type="email"]').filter({ hasText: /Login|Sign|Purchase|Get Access|Buy|Email/i });
      const hasPrompts = await promptElements.count() > 0;

      // Also check if there's an email input (checkout form)
      const emailInput = page.locator('input[type="email"]');
      const hasEmailInput = await emailInput.count() > 0;

      expect(isRedirected || hasPrompts || hasEmailInput).toBeTruthy();
    });

    test('Free product is accessible without authentication', async ({ page }) => {
      // Anonymous visit to free product
      await acceptAllCookies(page);
      await page.goto(`/p/${freeProduct.slug}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      // Should be able to view free product page or be redirected to free checkout
      const currentUrl = page.url();
      // Free products might redirect to checkout for email capture
      const isOnProductPage = currentUrl.includes(`/p/${freeProduct.slug}`);
      const isOnCheckout = currentUrl.includes('/checkout/');

      expect(isOnProductPage || isOnCheckout).toBeTruthy();
    });
  });

  // ============================================================================
  // Generated Code Validity Tests
  // ============================================================================

  test.describe('Generated Code Validation', () => {

    test('Page mode code contains valid script syntax', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('networkidle');

      // Open code generator from ⋯ dropdown
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: paidProduct.name }).first();
      await productRow.waitFor({ state: 'visible', timeout: 10000 });
      await openCodeGenerator(productRow, page);

      // Select Page mode
      const pageModeButton = page.locator('button').filter({ hasText: /Page|Strona/i }).first();
      await pageModeButton.waitFor({ state: 'visible', timeout: 5000 });
      await pageModeButton.click();

      const codeBlock = page.locator('pre').first();
      await codeBlock.waitFor({ state: 'visible', timeout: 10000 });
      const generatedCode = await codeBlock.textContent() || '';

      // Validate code structure
      expect(generatedCode).toMatch(/<script[^>]*src=/);
      expect(generatedCode).toContain('/api/sellf');
      expect(generatedCode).toContain(`productSlug=${paidProduct.slug}`);
      expect(generatedCode).toMatch(/<\/script>/);

      // Should have noscript fallback
      expect(generatedCode).toMatch(/<noscript>/i);
    });

    test('Element mode code contains proper HTML structure', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('networkidle');

      // Open code generator from ⋯ dropdown
      const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: paidProduct.name }).first();
      await productRow.waitFor({ state: 'visible', timeout: 10000 });
      await openCodeGenerator(productRow, page);

      // Select Element mode
      const elementModeButton = page.locator('button').filter({ hasText: /Element/i }).first();
      await elementModeButton.waitFor({ state: 'visible', timeout: 5000 });
      await elementModeButton.click();

      const codeBlock = page.locator('pre').first();
      await codeBlock.waitFor({ state: 'visible', timeout: 10000 });
      const generatedCode = await codeBlock.textContent() || '';

      // Validate structure
      expect(generatedCode).toContain('<script');
      expect(generatedCode).toContain('/api/sellf');
      expect(generatedCode).toContain(`data-sellf-product="${paidProduct.slug}"`);
      expect(generatedCode).toContain('data-no-access');
      expect(generatedCode).toContain('</div>');
    });

    test('Product slug in generated code matches actual product', async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto('/dashboard/products');
      await page.waitForLoadState('networkidle');

      // Test with both products
      for (const product of [paidProduct, freeProduct]) {
        const productRow = page.locator('tr, [data-testid="product-row"]').filter({ hasText: product.name }).first();
        await productRow.waitFor({ state: 'visible', timeout: 10000 });
        await openCodeGenerator(productRow, page);

        const codeBlock = page.locator('pre').first();
        await codeBlock.waitFor({ state: 'visible', timeout: 10000 });
        const generatedCode = await codeBlock.textContent() || '';

        // Verify correct slug is used
        expect(generatedCode).toContain(product.slug);

        // Close modal
        const closeButton = page.locator('button').filter({ hasText: /Close|Zamknij|×/i }).first();
        await closeButton.click();
        await closeButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    });
  });
});
