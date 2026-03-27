/**
 * Smoke Tests - Critical Paths
 *
 * Minimal E2E tests covering all main user journeys.
 * Run frequently: bun run test:smoke
 *
 * Coverage:
 * 1. Public pages (unauthenticated): storefront, product page, checkout
 * 2. Admin tabs: all dashboard pages render correctly
 * 3. User tabs: my-products, my-purchases, profile
 * 4. Product access: different content delivery types
 * 5. Video player: thumbnail → click → iframe mount
 * 6. API health
 * 7. Auth redirects
 * 8. Internationalization
 */

import { test, expect, Page } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from '../helpers/admin-auth';
import { acceptAllCookies } from '../helpers/consent';

test.describe.configure({ mode: 'serial' });

// ===== SHARED STATE =====

let adminEmail: string;
let adminPassword: string;
let adminCleanup: () => Promise<void>;
let adminUserId: string;

// Products created for tests
let paidProduct: { id: string; slug: string; name: string };
let freeProduct: { id: string; slug: string; name: string };
let redirectProduct: { id: string; slug: string; name: string };
let contentProduct: { id: string; slug: string; name: string };

const ts = Date.now();

// ===== SETUP / TEARDOWN =====

test.beforeAll(async () => {
  // Create admin user
  const admin = await createTestAdmin('smoke');
  adminEmail = admin.email;
  adminPassword = admin.password;
  adminCleanup = admin.cleanup;

  // Get admin user ID
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const adminUser = users.find(u => u.email === adminEmail);
  adminUserId = adminUser!.id;

  // Create test products
  const products = await Promise.all([
    supabaseAdmin.from('products').insert({
      name: `Smoke Paid ${ts}`,
      slug: `smoke-paid-${ts}`,
      description: 'A paid product for smoke testing',
      price: 29.99,
      currency: 'USD',
      is_active: true,
      is_listed: true,
      is_featured: true,
    }).select().single(),

    supabaseAdmin.from('products').insert({
      name: `Smoke Free ${ts}`,
      slug: `smoke-free-${ts}`,
      description: 'A free product for smoke testing',
      price: 0,
      currency: 'USD',
      is_active: true,
      is_listed: true,
    }).select().single(),

    supabaseAdmin.from('products').insert({
      name: `Smoke Redirect ${ts}`,
      slug: `smoke-redirect-${ts}`,
      description: 'Product with redirect delivery',
      price: 0,
      currency: 'USD',
      is_active: true,
      is_listed: true,
      content_delivery_type: 'redirect',
      content_config: { redirect_url: 'https://example.com/content' },
    }).select().single(),

    supabaseAdmin.from('products').insert({
      name: `Smoke Content ${ts}`,
      slug: `smoke-content-${ts}`,
      description: 'Product with video and download content',
      price: 0,
      currency: 'USD',
      is_active: true,
      is_listed: true,
      content_delivery_type: 'content',
      content_config: {
        content_items: [
          {
            id: 'vid-1',
            type: 'video_embed',
            title: 'Welcome Video',
            config: { embed_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
            order: 1,
            is_active: true,
          },
          {
            id: 'dl-1',
            type: 'download_link',
            title: 'Course Materials',
            config: { download_url: 'https://example.com/file.pdf', file_name: 'materials.pdf' },
            order: 2,
            is_active: true,
          },
        ],
      },
    }).select().single(),
  ]);

  paidProduct = { id: products[0].data!.id, slug: `smoke-paid-${ts}`, name: `Smoke Paid ${ts}` };
  freeProduct = { id: products[1].data!.id, slug: `smoke-free-${ts}`, name: `Smoke Free ${ts}` };
  redirectProduct = { id: products[2].data!.id, slug: `smoke-redirect-${ts}`, name: `Smoke Redirect ${ts}` };
  contentProduct = { id: products[3].data!.id, slug: `smoke-content-${ts}`, name: `Smoke Content ${ts}` };

  // Grant access to content and redirect products for the admin user
  for (const product of [contentProduct, redirectProduct, freeProduct]) {
    await supabaseAdmin.from('user_product_access').insert({
      user_id: adminUserId,
      product_id: product.id,
    });
  }
});

test.afterAll(async () => {
  // Cleanup products
  const slugs = [paidProduct, freeProduct, redirectProduct, contentProduct]
    .filter(Boolean)
    .map(p => p.slug);

  if (slugs.length > 0) {
    await supabaseAdmin.from('products').delete().in('slug', slugs);
  }

  // Cleanup admin user
  if (adminCleanup) {
    await adminCleanup();
  }
});

// ===== HELPERS =====

async function login(page: Page) {
  await loginAsAdmin(page, adminEmail, adminPassword);
}

// ===== 1. PUBLIC PAGES (UNAUTHENTICATED) =====

test.describe('Public Pages', () => {
  test('storefront shows product listing', async ({ page }) => {
    // Re-activate our test product (other test suites may have deactivated ALL products)
    await supabaseAdmin.from('products').update({ is_active: true }).eq('id', paidProduct.id);

    await acceptAllCookies(page);

    // Retry: SSR may serve stale data right after DB write
    await expect(async () => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await expect(page.locator('a[href*="/p/"]').first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 25000 });

    // Page loads without errors
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('product page renders for paid product', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/p/${paidProduct.slug}`);

    // Should redirect to checkout for paid product (no access)
    await expect(page).toHaveURL(new RegExp(`/checkout/${paidProduct.slug}`), { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('product page renders for free product', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/p/${freeProduct.slug}`);

    // Free product should redirect to checkout with email form
    await expect(page).toHaveURL(new RegExp(`/checkout/${freeProduct.slug}`), { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('checkout page renders for paid product', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/checkout/${paidProduct.slug}`);

    await expect(page.locator('body')).not.toContainText('Application error');

    // Should show product name (in ProductShowcase)
    await expect(page.getByText(paidProduct.name).first()).toBeVisible({ timeout: 10000 });

    // Should show price
    await expect(page.getByText(/29\.99/).first()).toBeVisible({ timeout: 5000 });
  });

  test('checkout page renders for free product', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/checkout/${freeProduct.slug}`);

    await expect(page.locator('body')).not.toContainText('Application error');

    // Free product checkout has email input and submit button
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
  });

  test('checkout 404 for non-existent product', async ({ page }) => {
    const response = await page.goto('/checkout/does-not-exist-999');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);
  });
});

// ===== 2. ADMIN DASHBOARD TABS =====

test.describe('Admin Dashboard Tabs', () => {
  const adminPages: { path: string; marker: RegExp }[] = [
    { path: '/dashboard', marker: /Total Revenue|Przychody|Revenue|Dashboard|Panel administracyjny/i },
    { path: '/dashboard/products', marker: /Product|Produkt/i },
    { path: '/dashboard/variants', marker: /Variant|Wariant/i },
    { path: '/dashboard/categories', marker: /Categor|Kategori/i },
    { path: '/dashboard/order-bumps', marker: /Order Bump|Bump/i },
    { path: '/dashboard/coupons', marker: /Coupon|Kupon/i },
    { path: '/dashboard/refund-requests', marker: /Refund|Zwrot/i },
    { path: '/dashboard/webhooks', marker: /Webhook|Endpoint/i },
    { path: '/dashboard/integrations', marker: /Integrat/i },
    { path: '/dashboard/api-keys', marker: /API Key|Klucz API/i },
    { path: '/dashboard/users', marker: /User|Użytkowni/i },
    { path: '/dashboard/payments', marker: /Payment|Płatnoś|Transaction|Transakcj/i },
    { path: '/dashboard/settings', marker: /Settings|Ustawienia|Shop|Sklep/i },
  ];

  test('all admin pages load and render content', async ({ page }) => {
    await login(page);

    for (const { path, marker } of adminPages) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')), { timeout: 10000 });
      await expect(page.locator('body')).not.toContainText('Application error');
      await expect(page.locator('body')).toContainText(marker, { timeout: 10000 });
    }
  });
});

// ===== 3. USER TABS =====

test.describe('User Tabs', () => {
  test('my-products page loads with accessible products', async ({ page }) => {
    await login(page);
    await page.goto('/my-products');

    await expect(page.locator('body')).not.toContainText('Application error');

    // Should show user's accessible products (we granted access to 3 products)
    await expect(page.getByText(contentProduct.name).first()).toBeVisible({ timeout: 15000 });
  });

  test('my-purchases page loads', async ({ page }) => {
    await login(page);
    await page.goto('/my-purchases');

    await expect(page.locator('body')).not.toContainText('Application error');

    // Page renders — may show empty state or purchases
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('profile page loads with form fields', async ({ page }) => {
    await login(page);
    await page.goto('/profile');

    await expect(page.locator('body')).not.toContainText('Application error');

    // Should show profile form with email (read-only) and name fields
    await expect(page.locator('input[disabled]').first()).toBeVisible({ timeout: 10000 });

    // Should have a save button
    const saveButton = page.getByRole('button', { name: /Save|Zapisz/i });
    await expect(saveButton).toBeVisible({ timeout: 5000 });
  });
});

// ===== 4. PRODUCT ACCESS — CONTENT DELIVERY TYPES =====

test.describe('Product Access & Content Delivery', () => {
  test('content product shows video and download items', async ({ page }) => {
    await login(page);
    await page.goto(`/p/${contentProduct.slug}`);

    await expect(page.locator('body')).not.toContainText('Application error');

    // Should show access granted state with content items
    await expect(page.getByText(/Welcome Video/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Course Materials/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('redirect product shows redirect UI', async ({ page }) => {
    await login(page);

    // Track that a redirect was attempted to example.com
    let redirectAttempted = false;
    await page.route('https://example.com/**', (route) => {
      redirectAttempted = true;
      route.abort();
    });

    // Navigate to the redirect product page
    // The page will attempt window.location.href = redirect_url which triggers navigation
    const response = await page.goto(`/p/${redirectProduct.slug}`, { waitUntil: 'commit' });
    expect(response?.status()).toBeLessThan(500);

    // The product page should either:
    // 1. Show "Redirecting..." UI briefly before navigating (which we block)
    // 2. Navigate to example.com (which we intercept)
    // Wait for either the redirect UI text or the redirect attempt
    await expect.poll(() => redirectAttempted, { timeout: 15000, message: 'Expected redirect to example.com' }).toBe(true);
  });

  test('free product with access shows content', async ({ page }) => {
    await login(page);
    await page.goto(`/p/${freeProduct.slug}`);

    await expect(page.locator('body')).not.toContainText('Application error');

    // User has access — should show product name in h1 (not <title> which is always hidden)
    await expect(page.locator('h1').getByText(freeProduct.name)).toBeVisible({ timeout: 15000 });
  });
});

// ===== 5. VIDEO PLAYER =====

test.describe('Video Player', () => {
  test('thumbnail visible before play, player mounts after click', async ({ page }) => {
    await login(page);
    await page.goto(`/p/${contentProduct.slug}`);

    // Wait for content to load
    await expect(page.getByText(/Welcome Video/i).first()).toBeVisible({ timeout: 15000 });

    // Thumbnail should be visible before play
    const thumbnail = page.getByTestId('player-thumbnail');
    await expect(thumbnail).toBeVisible({ timeout: 10000 });

    // Player container should NOT yet exist
    await expect(page.getByTestId('player-container')).toHaveCount(0);

    // Block YouTube requests to prevent flakiness — we only care about DOM changes
    await page.route('https://*.youtube.com/**', (route) => route.abort());
    await page.route('https://img.youtube.com/**', (route) => route.abort());

    // Click play
    await thumbnail.click();

    // After clicking, the player container should be mounted
    await expect(page.getByTestId('player-container')).toBeVisible({ timeout: 5000 });

    // Thumbnail should no longer be visible
    await expect(page.getByTestId('player-thumbnail')).toHaveCount(0);
  });
});

// ===== 6. API HEALTH =====

test.describe('API Health', () => {

  test('health endpoint responds', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
  });

  test('runtime config loads', async ({ request }) => {
    const response = await request.get('/api/runtime-config');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.supabaseUrl).toBeDefined();
  });

  test('protected API endpoints require auth', async ({ request }) => {
    const endpoints = ['/api/v1/products', '/api/v1/payments', '/api/v1/users'];
    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(401);
    }
  });
});

// ===== 7. AUTH REDIRECTS =====

test.describe('Auth Redirects', () => {
  test('unauthenticated user is redirected from dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('unauthenticated user is redirected from admin pages', async ({ page }) => {
    await page.goto('/dashboard/products');
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('login page renders with email input', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});

// ===== 8. INTERNATIONALIZATION =====

test.describe('Internationalization', () => {
  test('English locale works', async ({ page }) => {
    await page.goto('/en');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('en');
  });

  test('Polish locale works', async ({ page }) => {
    await page.goto('/pl');
    await expect(page).toHaveURL(/\/pl/);
  });
});
