/**
 * SECURITY TEST: Open Redirect in ProductAccessView
 *
 * Vulnerability: The return_url parameter is used directly without validation
 * when redirecting after payment success countdown.
 *
 * Attack vector: /p/product?payment=success&return_url=https://evil.com
 */

import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to login via browser
async function loginViaBrowser(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const supabase = createBrowserClient(supabaseUrl, anonKey);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, { email, password, supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY });

  await page.waitForTimeout(500);
}

test.describe('Open Redirect - Product Access View', () => {
  test.describe.configure({ mode: 'serial' });

  let testUserId: string;
  let testUserEmail: string;
  let testProductId: string;
  let testProductSlug: string;
  const password = 'TestPassword123!';

  test.beforeAll(async () => {
    const suffix = Date.now().toString();
    testUserEmail = `open-redirect-test-${suffix}@example.com`;
    testProductSlug = `test-product-${suffix}`;

    // Create test user
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: testUserEmail,
      password,
      email_confirm: true,
    });
    if (userError) throw userError;
    testUserId = userData.user!.id;

    // Create test product
    const { data: productData, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Test Product for Open Redirect',
        slug: testProductSlug,
        description: 'Test product',
        price: 0,
        currency: 'USD',
        is_active: true,
        content_delivery_type: 'content',
        content_config: { content_items: [] },
      })
      .select()
      .single();

    if (productError) throw productError;
    testProductId = productData.id;

    // Grant access to the user
    await supabaseAdmin
      .from('product_accesses')
      .insert({
        product_id: testProductId,
        user_id: testUserId,
      });

    console.log(`Created test user: ${testUserId}`);
    console.log(`Created test product: ${testProductSlug}`);
  });

  test.afterAll(async () => {
    // Cleanup
    if (testProductId && testUserId) {
      await supabaseAdmin
        .from('product_accesses')
        .delete()
        .eq('product_id', testProductId)
        .eq('user_id', testUserId);
    }
    if (testProductId) {
      await supabaseAdmin.from('products').delete().eq('id', testProductId);
    }
    if (testUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testUserId);
    }
  });

  test('SECURITY: Should reject external URLs in return_url', async ({ page }) => {
    // Login first
    await loginViaBrowser(page, testUserEmail, password);

    // Navigate to product with malicious return_url
    const maliciousUrl = `https://evil-phishing-site.com/fake-login`;
    const productUrl = `/pl/p/${testProductSlug}?payment=success&return_url=${encodeURIComponent(maliciousUrl)}`;

    console.log(`\nOpen Redirect Test:`);
    console.log(`  Product URL: ${productUrl}`);
    console.log(`  Malicious return_url: ${maliciousUrl}`);

    // Navigate to the product page
    await page.goto(productUrl);

    // Wait for the countdown to finish (3 seconds) plus some buffer
    await page.waitForTimeout(4000);

    // Check where we ended up
    const currentUrl = page.url();
    console.log(`  Final URL: ${currentUrl}`);

    // Should NOT be redirected to external domain
    const isVulnerable = currentUrl.includes('evil-phishing-site.com');
    console.log(`  Result: ${isVulnerable ? 'VULNERABLE' : 'SECURE'}`);

    expect(isVulnerable).toBe(false);
    expect(currentUrl).not.toContain('evil-phishing-site.com');
  });

  test('SECURITY: Should reject protocol-relative URLs', async ({ page }) => {
    await loginViaBrowser(page, testUserEmail, password);

    const protoRelativeUrl = `//evil.com/phishing`;
    const productUrl = `/pl/p/${testProductSlug}?payment=success&return_url=${encodeURIComponent(protoRelativeUrl)}`;

    console.log(`\nProtocol-relative URL Test:`);
    console.log(`  Malicious return_url: ${protoRelativeUrl}`);

    await page.goto(productUrl);
    await page.waitForTimeout(4000);

    const currentUrl = page.url();
    console.log(`  Final URL: ${currentUrl}`);

    expect(currentUrl).not.toContain('evil.com');
  });

  test('SECURITY: Should reject javascript: URLs', async ({ page }) => {
    await loginViaBrowser(page, testUserEmail, password);

    const jsUrl = `javascript:alert(document.cookie)`;
    const productUrl = `/pl/p/${testProductSlug}?payment=success&return_url=${encodeURIComponent(jsUrl)}`;

    console.log(`\nJavaScript URL Test:`);
    console.log(`  Malicious return_url: ${jsUrl}`);

    await page.goto(productUrl);
    await page.waitForTimeout(4000);

    // Should still be on the product page or a safe location
    const currentUrl = page.url();
    console.log(`  Final URL: ${currentUrl}`);

    expect(currentUrl).not.toContain('javascript:');
  });

  test('Should allow safe relative paths (not block them)', async ({ page }) => {
    await loginViaBrowser(page, testUserEmail, password);

    const safeUrl = `/dashboard`;
    const productUrl = `/pl/p/${testProductSlug}?payment=success&return_url=${encodeURIComponent(safeUrl)}`;

    console.log(`\nSafe relative path Test:`);
    console.log(`  Safe return_url: ${safeUrl}`);

    await page.goto(productUrl);
    await page.waitForTimeout(4000);

    const currentUrl = page.url();
    console.log(`  Final URL: ${currentUrl}`);

    // The important thing is that safe URLs are NOT blocked
    // They should not redirect to evil domains or show errors
    expect(currentUrl).not.toContain('error');
    expect(currentUrl).not.toContain('blocked');
    // Safe URLs should stay on the same domain
    expect(currentUrl).toContain('localhost:3000');
  });
});
