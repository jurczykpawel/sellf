import { test, expect, Page } from '@playwright/test';
import { supabaseAdmin, setAuthSession } from './helpers/admin-auth';
import { ProductStateGuard } from './helpers/product-state';

const productGuard = new ProductStateGuard(supabaseAdmin);

test.describe('Access Control (Security)', () => {
  // Enforce single worker
  test.describe.configure({ mode: 'serial' });
  let testProduct: any;
  let userWithAccess: any;
  let userWithoutAccess: any;
  const password = 'TestPassword123!';

  const loginAsUser = async (page: Page, email: string) => {
    await setAuthSession(page, email, password);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  };

  test.beforeAll(async () => {
    await productGuard.save();
    // 1. Create test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Access Control Test ${Date.now()}`,
        slug: `access-test-${Date.now()}`,
        price: 20,
        currency: 'USD',
        description: 'Test product for access control',
        is_active: true
      })
      .select()
      .single();

    if (productError) throw productError;
    testProduct = product;

    // 2. Create user WITH access
    const email1 = `user-with-access-${Date.now()}@test.com`;
    const { data: { user: user1 }, error: createError1 } = await supabaseAdmin.auth.admin.createUser({
      email: email1,
      password,
      email_confirm: true,
    });
    if (createError1) throw createError1;
    userWithAccess = { ...user1, email: email1 };

    // Grant access to product
    await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: userWithAccess.id,
        product_id: testProduct.id,
      });

    // 3. Create user WITHOUT access
    const email2 = `user-no-access-${Date.now()}@test.com`;
    const { data: { user: user2 }, error: createError2 } = await supabaseAdmin.auth.admin.createUser({
      email: email2,
      password,
      email_confirm: true,
    });
    if (createError2) throw createError2;
    userWithoutAccess = { ...user2, email: email2 };
  });

  test.afterEach(async () => {
    await productGuard.restore();
  });

  test.afterAll(async () => {
    await productGuard.restore();
    // Cleanup
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
    if (userWithAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithAccess.id);
    }
    if (userWithoutAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithoutAccess.id);
    }
  });

  test('user WITH access should see protected content', async ({ page }) => {
    await loginAsUser(page, userWithAccess.email);

    // Navigate to product page
    await page.goto(`/p/${testProduct.slug}`);

    // Should stay on the product page (not redirected to checkout)
    await expect(page).toHaveURL(new RegExp(`/p/${testProduct.slug}`), { timeout: 10000 });

    // Positive assertion: the product name should be visible on the access view
    await expect(page.locator('body')).toContainText(testProduct.name, { timeout: 10000 });

    // Negative assertion: should NOT see purchase/checkout prompts
    await expect(page.locator('body')).not.toContainText('Purchase Access');

    // Verify via API that the user actually has access (data-level verification)
    const apiResponse = await page.evaluate(async ({ slug }) => {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ productSlugs: [slug] })
      });
      return await response.json();
    }, { slug: testProduct.slug });

    expect(apiResponse.accessResults[testProduct.slug]).toBe(true);
  });

  test('user WITHOUT access should be redirected to checkout page', async ({ page }) => {
    await loginAsUser(page, userWithoutAccess.email);

    // Navigate to product page
    await page.goto(`/p/${testProduct.slug}`);

    // User without access should be redirected to checkout
    await expect(page).toHaveURL(new RegExp(`/checkout/${testProduct.slug}`), { timeout: 10000 });

    // Verify the checkout page shows the product name and a purchase action
    await expect(page.locator('body')).toContainText(testProduct.name, { timeout: 10000 });
  });

  test('guest (not logged in) should be redirected to checkout', async ({ page }) => {
    // Navigate as guest (no login)
    await page.goto(`/p/${testProduct.slug}`);

    // Guest should be redirected to checkout (same as user without access)
    await expect(page).toHaveURL(new RegExp(`/checkout/${testProduct.slug}`), { timeout: 10000 });

    // Verify the checkout page renders with the correct product context
    await expect(page.locator('body')).toContainText(testProduct.name, { timeout: 10000 });
  });

  test('API /api/access should enforce access control', async ({ page }) => {
    // check_rate_limit function signature has been fixed
    // Test as authenticated user WITH access
    await loginAsUser(page, userWithAccess.email);

    // Call API from browser context (with cookies)
    const response1 = await page.evaluate(async ({ slug }) => {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          productSlugs: [slug]
        })
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await response.json()
      };
    }, { slug: testProduct.slug });

    expect(response1.ok).toBeTruthy();
    expect(response1.body.accessResults).toBeDefined();
    expect(response1.body.accessResults[testProduct.slug]).toBe(true);

    // Test as user WITHOUT access
    await loginAsUser(page, userWithoutAccess.email);

    const response2 = await page.evaluate(async ({ slug }) => {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          productSlugs: [slug]
        })
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await response.json()
      };
    }, { slug: testProduct.slug });

    expect(response2.ok).toBeTruthy();
    expect(response2.body.accessResults[testProduct.slug]).toBe(false);
  });

  test('should prevent privilege escalation via API', async ({ request }) => {
    // Attempt to access without valid token
    const response = await request.post('/api/access', {
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      data: {
        productSlugs: [testProduct.slug]
      }
    });

    // Should either reject with 401 or return explicit false for all products
    if (response.ok()) {
      const body = await response.json();
      // If endpoint allows anonymous requests, it must explicitly deny access
      expect(body.accessResults).toBeDefined();
      expect(body.accessResults[testProduct.slug]).toBe(false);
    } else {
      // Should reject with 401 Unauthorized (not 403 or 500)
      expect(response.status()).toBe(401);
    }
  });
});

test.describe('Access Control - Inactive Product', () => {
  test.describe.configure({ mode: 'serial' });

  let testProduct: any;
  let userWithAccess: any;
  const password = 'TestPassword123!';

  const loginAsUser = async (page: Page, email: string) => {
    await setAuthSession(page, email, password);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  };

  test.beforeAll(async () => {
    await productGuard.save();
    // Create test product (initially ACTIVE)
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Inactive Product Test ${Date.now()}`,
        slug: `inactive-test-${Date.now()}`,
        price: 30,
        currency: 'USD',
        description: 'Test product for inactive access control',
        is_active: true
      })
      .select()
      .single();

    if (productError) throw productError;
    testProduct = product;

    // Create user WITH access
    const email1 = `inactive-user-${Date.now()}@test.com`;
    const { data: { user: user1 }, error: createError1 } = await supabaseAdmin.auth.admin.createUser({
      email: email1,
      password,
      email_confirm: true,
    });
    if (createError1) throw createError1;
    userWithAccess = { ...user1, email: email1 };

    // Grant access to product
    await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: userWithAccess.id,
        product_id: testProduct.id,
      });
  });

  test.afterEach(async () => {
    await productGuard.restore();
  });

  test.afterAll(async () => {
    await productGuard.restore();
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
    if (userWithAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithAccess.id);
    }
  });

  test('user should have access to ACTIVE product', async ({ page }) => {
    await loginAsUser(page, userWithAccess.email);

    const response = await page.evaluate(async ({ slug }) => {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ productSlugs: [slug] })
      });
      return await response.json();
    }, { slug: testProduct.slug });

    expect(response.accessResults[testProduct.slug]).toBe(true);
  });

  test('user should STILL have access after product is DEACTIVATED', async ({ page }) => {
    // Deactivate the product
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .eq('id', testProduct.id);

    await loginAsUser(page, userWithAccess.email);

    const response = await page.evaluate(async ({ slug }) => {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ productSlugs: [slug] })
      });
      return await response.json();
    }, { slug: testProduct.slug });

    // ✅ User should STILL have access even though product is inactive
    expect(response.accessResults[testProduct.slug]).toBe(true);
  });

  test('user should LOSE access when access_expires_at passes', async ({ page }) => {
    // First login (takes ~2 seconds), THEN set expiration
    await loginAsUser(page, userWithAccess.email);

    // Set access to expire in 3 seconds (after login is complete)
    const expiresIn3Seconds = new Date(Date.now() + 3000).toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('user_product_access')
      .update({ access_expires_at: expiresIn3Seconds })
      .eq('user_id', userWithAccess.id)
      .eq('product_id', testProduct.id);

    if (updateError) {
      console.error('Failed to update access_expires_at:', updateError);
      throw updateError;
    }

    // First check - user should still have access (not expired yet)
    const responseBefore = await page.evaluate(async ({ slug }) => {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ productSlugs: [slug] })
      });
      return await response.json();
    }, { slug: testProduct.slug });

    expect(responseBefore.accessResults[testProduct.slug]).toBe(true);

    // Wait for expiration (4 seconds to be safe)
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Second check - user should NOT have access (expired)
    const responseAfter = await page.evaluate(async ({ slug }) => {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ productSlugs: [slug] })
      });
      return await response.json();
    }, { slug: testProduct.slug });

    // ❌ User should NOT have access - temporal access expired
    expect(responseAfter.accessResults[testProduct.slug]).toBe(false);
  });

  test('user should LOSE access when product is DELETED', async ({ page }) => {
    // Re-grant access (remove expiry)
    await supabaseAdmin
      .from('user_product_access')
      .update({ access_expires_at: null })
      .eq('user_id', userWithAccess.id)
      .eq('product_id', testProduct.id);

    // Delete the product
    await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', testProduct.id);

    await loginAsUser(page, userWithAccess.email);

    const response = await page.evaluate(async ({ slug }) => {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ productSlugs: [slug] })
      });
      return await response.json();
    }, { slug: testProduct.slug });

    // ❌ User should NOT have access - product was deleted
    expect(response.accessResults[testProduct.slug]).toBe(false);

    // Mark as deleted so afterAll doesn't try to delete again
    testProduct = null;
  });
});

test.describe('Element Protection - data-has-access / data-no-access visibility', () => {
  test.describe.configure({ mode: 'serial' });

  let testProduct: any;
  let userWithAccess: any;
  let userWithoutAccess: any;
  const password = 'TestPassword123!';

  const loginAsUser = async (page: Page, email: string) => {
    await setAuthSession(page, email, password);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  };

  test.beforeAll(async () => {
    await productGuard.save();
    // Create test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Element Protection Test ${Date.now()}`,
        slug: `element-test-${Date.now()}`,
        price: 10,
        currency: 'USD',
        description: 'Test product for element protection',
        is_active: true
      })
      .select()
      .single();

    if (productError) throw productError;
    testProduct = product;

    // Create user WITH access
    const email1 = `elem-user-with-${Date.now()}@test.com`;
    const { data: { user: user1 }, error: createError1 } = await supabaseAdmin.auth.admin.createUser({
      email: email1,
      password,
      email_confirm: true,
    });
    if (createError1) throw createError1;
    userWithAccess = { ...user1, email: email1 };

    // Grant access
    await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: userWithAccess.id,
        product_id: testProduct.id,
      });

    // Create user WITHOUT access
    const email2 = `elem-user-without-${Date.now()}@test.com`;
    const { data: { user: user2 }, error: createError2 } = await supabaseAdmin.auth.admin.createUser({
      email: email2,
      password,
      email_confirm: true,
    });
    if (createError2) throw createError2;
    userWithoutAccess = { ...user2, email: email2 };
  });

  test.afterEach(async () => {
    await productGuard.restore();
  });

  test.afterAll(async () => {
    await productGuard.restore();
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
    if (userWithAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithAccess.id);
    }
    if (userWithoutAccess) {
      await supabaseAdmin.auth.admin.deleteUser(userWithoutAccess.id);
    }
  });

  test('user WITH access should see data-has-access and NOT see data-no-access', async ({ page }) => {
    await loginAsUser(page, userWithAccess.email);

    // Create a test page with element protection
    const testPageContent = `
      <!DOCTYPE html>
      <html>
      <head><title>Element Protection Test</title></head>
      <body>
        <div data-sellf-product="${testProduct.slug}" data-testid="protected-section">
          <div data-has-access data-testid="has-access-content">
            <h2>Premium Content - You have access!</h2>
          </div>
          <div data-no-access data-testid="no-access-fallback">
            <h2>You need access to see this content</h2>
          </div>
        </div>
        <script src="/api/sellf"></script>
      </body>
      </html>
    `;

    // Navigate to test page served by http-server
    await page.goto(`/api/test-page/element-protection?testProduct=${testProduct.slug}`);

    // Wait for sellf to process
    await page.waitForTimeout(3000);

    // User WITH access should see data-has-access content
    const hasAccessContent = page.locator('[data-testid="has-access-content"]');
    const noAccessContent = page.locator('[data-testid="no-access-fallback"]');

    // data-has-access should be visible
    await expect(hasAccessContent).toBeVisible({ timeout: 10000 });

    // data-no-access should be hidden
    await expect(noAccessContent).not.toBeVisible();
  });

  test('user WITHOUT access should see data-no-access and NOT see data-has-access', async ({ page }) => {
    await loginAsUser(page, userWithoutAccess.email);

    // Navigate to test page
    await page.goto(`/api/test-page/element-protection?testProduct=${testProduct.slug}`);

    // Wait for sellf to process
    await page.waitForTimeout(3000);

    const hasAccessContent = page.locator('[data-testid="has-access-content"]');
    const noAccessContent = page.locator('[data-testid="no-access-fallback"]');

    // data-no-access should be visible for user without access
    await expect(noAccessContent).toBeVisible({ timeout: 10000 });

    // data-has-access should be hidden
    await expect(hasAccessContent).not.toBeVisible();
  });

  test('anonymous user should see data-no-access fallback', async ({ page }) => {
    // No login - anonymous user

    await page.goto(`/api/test-page/element-protection?testProduct=${testProduct.slug}`);

    // Wait for sellf to process
    await page.waitForTimeout(3000);

    const hasAccessContent = page.locator('[data-testid="has-access-content"]');
    const noAccessContent = page.locator('[data-testid="no-access-fallback"]');

    // Anonymous user should see no-access fallback
    await expect(noAccessContent).toBeVisible({ timeout: 10000 });

    // data-has-access should be hidden
    await expect(hasAccessContent).not.toBeVisible();
  });
});
