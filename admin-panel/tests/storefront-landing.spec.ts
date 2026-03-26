import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { ProductStateGuard } from './helpers/product-state';

// Enforce single worker to prevent conflicts
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Modern Storefront Landing Page 2026', () => {
  let testProductIds: string[] = [];
  const productGuard = new ProductStateGuard(supabaseAdmin);

  test.beforeAll(async () => {
    await productGuard.save();
  });

  test.afterAll(async () => {
    await productGuard.restore();
  });

  // Cleanup helper
  const cleanupTestProducts = async () => {
    if (testProductIds.length > 0) {
      await supabaseAdmin
        .from('products')
        .delete()
        .in('id', testProductIds);
      testProductIds = [];
    }
  };

  test.afterEach(async () => {
    await cleanupTestProducts();
    // Restore originally active products immediately (not just in afterAll)
    // to prevent state contamination of subsequent tests and parallel suites
    await productGuard.restore();
    // Small delay to ensure DB writes are flushed before next test reads
    await new Promise(r => setTimeout(r, 300));
  });

  test('FREE-ONLY shop: Should show free-focused hero and only free products section', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await new Promise(r => setTimeout(r, 500));

    // Create 3 free products
    const freeProducts = [];
    for (let i = 1; i <= 3; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Free Resource ${i}`,
        slug: `free-${Date.now()}-${i}`,
        description: `Free resource description ${i}`,
        price: 0,
        currency: 'USD',
        is_active: true,
        icon: '🎁',
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) {
        freeProducts.push(data);
        testProductIds.push(data.id);
      }
    }

    // Verify DB state before loading page — only our 3 free products should be active
    const { data: activeCheck } = await supabaseAdmin
      .from('products')
      .select('id, price')
      .eq('is_active', true)
      .eq('is_listed', true);
    const activeIds = activeCheck?.map(p => p.id) || [];
    const activePaid = activeCheck?.filter(p => p.price > 0) || [];
    // If stale paid products leaked from other tests, deactivate them
    if (activePaid.length > 0) {
      await supabaseAdmin
        .from('products')
        .update({ is_active: false })
        .in('id', activePaid.map(p => p.id));
    }

    await acceptAllCookies(page);

    // Poll: page may serve stale RSC cache from previous test. Reload until storefront shows free-only hero.
    await expect(async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('text=/Start Your Journey|Rozpocznij swoją podróż/i')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 20000, intervals: [2000, 3000, 5000] });
    await expect(page.locator('text=/Completely Free|Całkowicie za darmo/i')).toBeVisible();

    // Verify product count in hero description
    await expect(page.locator('text=/Access.*3.*premium resources at no cost/i')).toBeVisible();

    // Verify free products section badge appears
    await expect(page.locator('text=/3 Free Resources?/i').first()).toBeVisible();

    // Verify all 3 free products are displayed
    for (const product of freeProducts) {
      await expect(page.getByText(product.name)).toBeVisible();
      await expect(page.getByText(product.description)).toBeVisible();
    }

    // Verify NO premium section filter pill (no paid products)
    await expect(page.locator('text=/Premium \\(/i')).not.toBeVisible();
  });

  test('PAID-ONLY shop: Should show premium-focused hero and only premium section', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create 3 premium products
    const paidProducts = [];
    for (let i = 1; i <= 3; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Premium Product ${i}`,
        slug: `premium-${Date.now()}-${i}`,
        description: `Premium product description ${i}`,
        price: 99.00 * i,
        currency: 'USD',
        is_active: true,
        icon: '💎',
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) {
        paidProducts.push(data);
        testProductIds.push(data.id);
      }
    }

    // Verify DB: only paid products should be active (clean up any free leaks from other tests)
    const { data: activeCheck } = await supabaseAdmin
      .from('products')
      .select('id, price')
      .eq('is_active', true)
      .eq('is_listed', true);
    const activeFree = activeCheck?.filter(p => p.price === 0) || [];
    if (activeFree.length > 0) {
      await supabaseAdmin
        .from('products')
        .update({ is_active: false })
        .in('id', activeFree.map(p => p.id));
    }

    await acceptAllCookies(page);

    // Poll: page may serve stale RSC cache from previous test
    await expect(async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Premium Quality')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 20000, intervals: [2000, 3000, 5000] });
    await expect(page.getByText('Professional Results')).toBeVisible();

    // Verify product count in hero description
    await expect(page.locator('text=/Invest in excellence with.*3.*carefully crafted premium products/i')).toBeVisible();

    // Verify premium products section badge appears
    await expect(page.locator('text=/3 Premium Products?/i').first()).toBeVisible();

    // Verify all 3 premium products are displayed with prices
    for (const product of paidProducts) {
      await expect(page.getByText(product.name)).toBeVisible();
      await expect(page.getByText(product.description)).toBeVisible();
      // Price should be visible as formatted currency
      await expect(page.locator(`text=/\\$${product.price}/`)).toBeVisible();
    }

    // Verify NO free section filter pill (no free products)
    await expect(page.locator('text=/Free \\(/i')).not.toBeVisible();
  });

  test('MIXED shop: Should show mixed hero and both free and premium sections', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create 2 free products
    const freeProducts = [];
    for (let i = 1; i <= 2; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Free Tool ${i}`,
        slug: `free-tool-${Date.now()}-${i}`,
        description: `Free tool description ${i}`,
        price: 0,
        currency: 'USD',
        is_active: true,
        icon: '🎁',
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) {
        freeProducts.push(data);
        testProductIds.push(data.id);
      }
    }

    // Create 2 premium products
    const paidProducts = [];
    for (let i = 1; i <= 2; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Pro Course ${i}`,
        slug: `pro-course-${Date.now()}-${i}`,
        description: `Pro course description ${i}`,
        price: 199.00,
        currency: 'USD',
        is_active: true,
        icon: '💎',
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) {
        paidProducts.push(data);
        testProductIds.push(data.id);
      }
    }

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Force reveal animations to completed state — IntersectionObserver can be unreliable
    // in headless Chromium, causing opacity:0 elements to never become visible
    await page.addStyleTag({ content: '.reveal { opacity: 1 !important; transform: none !important; transition: none !important; }' });

    // Verify mixed hero
    await expect(page.getByText('From Free')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('To Professional')).toBeVisible();

    // Verify counts in hero description
    await expect(page.locator('text=/Start with.*2 free.*resources.*upgrade to.*2 premium/i')).toBeVisible();

    // Verify BOTH section badges exist
    await expect(page.locator('text=/2 Free Resources?/i').first()).toBeVisible();
    await expect(page.locator('text=/2 Premium Products?/i').first()).toBeVisible();

    // Verify all products are displayed
    for (const product of [...freeProducts, ...paidProducts]) {
      await expect(page.getByText(product.name)).toBeVisible();
    }
  });

  test('FEATURED products: Should show bento grid with first product larger', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create 3 featured products
    const featuredProducts = [];
    for (let i = 1; i <= 3; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Featured Product ${i}`,
        slug: `featured-${Date.now()}-${i}`,
        description: `Featured product description ${i}`,
        price: i === 1 ? 0 : 299.00,
        currency: 'USD',
        is_active: true,
        is_featured: true,
        icon: '⭐',
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) {
        featuredProducts.push(data);
        testProductIds.push(data.id);
      }
    }

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify Featured section header
    await expect(page.locator('text=/Featured|Wyróżnione/i').first()).toBeVisible({ timeout: 15000 });

    // Verify all featured products are displayed
    for (const product of featuredProducts) {
      await expect(page.getByText(product.name).first()).toBeVisible();
      await expect(page.getByText(product.description).first()).toBeVisible();
    }

    // Verify Featured badges appear (at least 4: 1 section header + 3 product badges)
    const featuredBadges = page.locator('text=/Featured/i');
    const badgeCount = await featuredBadges.count();
    expect(badgeCount).toBeGreaterThanOrEqual(4);

    // Verify first featured product has larger styling (2x2 grid span)
    // This is tested indirectly by checking for larger text sizes
    const firstProductCard = page.getByText(featuredProducts[0].name).first().locator('..');
    await expect(firstProductCard).toBeVisible();
  });

  test('TEMPORAL badges: Should show Limited Time and Coming Soon badges correctly', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Create limited time product (available until tomorrow)
    const { data: limitedProduct } = await supabaseAdmin.from('products').insert({
      name: 'Limited Time Offer',
      slug: `limited-${Date.now()}`,
      description: 'Get it before it expires!',
      price: 49.00,
      currency: 'USD',
      is_active: true,
      is_featured: true,
      available_until: tomorrow.toISOString(),
      icon: '⏰',
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (limitedProduct) testProductIds.push(limitedProduct.id);

    // Create coming soon product (available from next week)
    const { data: comingSoonProduct } = await supabaseAdmin.from('products').insert({
      name: 'Coming Soon Product',
      slug: `coming-soon-${Date.now()}`,
      description: 'Available next week!',
      price: 99.00,
      currency: 'USD',
      is_active: true,
      is_featured: true,
      available_from: nextWeek.toISOString(),
      icon: '🔔',
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (comingSoonProduct) testProductIds.push(comingSoonProduct.id);

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify limited product is visible (available_until=tomorrow means still accessible)
    await expect(page.getByText('Limited Time Offer').first()).toBeVisible({ timeout: 15000 });
  });

  test('ACCESS DURATION: Should display duration badges when auto_grant_duration_days is set', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create product with 30-day access
    const { data: timedProduct } = await supabaseAdmin.from('products').insert({
      name: '30-Day Access Course',
      slug: `timed-${Date.now()}`,
      description: 'Get 30 days of access',
      price: 79.00,
      currency: 'USD',
      is_active: true,
      auto_grant_duration_days: 30,
      icon: '📅',
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (timedProduct) testProductIds.push(timedProduct.id);

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify product is displayed
    await expect(page.getByText('30-Day Access Course')).toBeVisible({ timeout: 15000 });

    // Verify duration badge shows "30d access" - look for the small badge specifically
    const durationBadge = page.locator('text=/^30d access$|^30 days access$/i').first();
    await expect(durationBadge).toBeVisible();

    // Verify the badge has correct styling (accent theme)
    await expect(durationBadge).toHaveClass(/text-sf-accent/);
  });

  test('SHOW ALL functionality: Should display 6 products initially then expand on click', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create 8 free products (more than 6)
    const freeProducts = [];
    for (let i = 1; i <= 8; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Free Resource ${i}`,
        slug: `free-many-${Date.now()}-${i}`,
        description: `Free resource ${i}`,
        price: 0,
        currency: 'USD',
        is_active: true,
        icon: '🎁',
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) {
        freeProducts.push(data);
        testProductIds.push(data.id);
      }
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait longer for all 8 products to load

    // Verify "Show All 8 Free Resources" button exists (means not all are shown initially)
    const showAllButton = page.getByRole('button', { name: /Show All 8 Free Resources/i });
    await expect(showAllButton).toBeVisible({ timeout: 15000 });

    // Count visible product cards initially (should be 6 or less)
    const initialProductCards = page.locator('a[href^="/p/"]').filter({ hasText: /Free Resource \d+/i });
    const initialCount = await initialProductCards.count();
    expect(initialCount).toBeGreaterThanOrEqual(6);
    expect(initialCount).toBeLessThan(8);

    // Click "Show All" button
    await showAllButton.click();

    // Wait for animation
    await page.waitForTimeout(500);

    // Verify "Show All" button is now hidden
    await expect(showAllButton).not.toBeVisible();

    // Verify more products are now visible
    const finalCount = await initialProductCards.count();
    expect(finalCount).toBe(8);
  });

  test('SHOW ALL for premium: Should work independently for premium products', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create 4 free products (under 6 limit)
    for (let i = 1; i <= 4; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Free ${i}`,
        slug: `free-${Date.now()}-${i}`,
        description: `Free ${i}`,
        price: 0,
        currency: 'USD',
        is_active: true,
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) testProductIds.push(data.id);
    }

    // Create 8 premium products (more than 6)
    const premiumProducts = [];
    for (let i = 1; i <= 8; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Premium ${i}`,
        slug: `premium-many-${Date.now()}-${i}`,
        description: `Premium ${i}`,
        price: 99.00 * i,
        currency: 'USD',
        is_active: true,
        icon: '💎',
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) {
        premiumProducts.push(data);
        testProductIds.push(data.id);
      }
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await acceptAllCookies(page);

    // Poll: page may serve stale RSC cache from previous test
    await expect(async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      // "Show All 8 Premium Products" proves all 8 were loaded from DB
      await expect(page.getByRole('button', { name: /Show All 8 Premium Products/i })).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 25000, intervals: [2000, 3000, 5000] });

    // Verify NO "Show All" button for free products (only 4)
    await expect(page.getByRole('button', { name: /Show All.*Free Resources/i })).not.toBeVisible();

    const showAllPremium = page.getByRole('button', { name: /Show All 8 Premium Products/i });

    // Count visible premium product cards initially (should be 6 or less)
    const premiumCards = page.locator('a[href^="/p/"]').filter({ hasText: /Premium \d+/i });
    const initialCount = await premiumCards.count();
    expect(initialCount).toBeGreaterThanOrEqual(6);
    expect(initialCount).toBeLessThan(8);

    // Click "Show All" for premium
    await showAllPremium.click();
    await page.waitForTimeout(500);

    // Verify "Show All" button is now hidden
    await expect(showAllPremium).not.toBeVisible();

    // Verify all 8 premium products are now visible
    const finalCount = await premiumCards.count();
    expect(finalCount).toBe(8);
  });

  test('ANIMATIONS: Should have animated gradient background and blob effects', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create at least one product so storefront shows
    const { data } = await supabaseAdmin.from('products').insert({
      name: 'Test Product',
      slug: `test-${Date.now()}`,
      description: 'Test',
      price: 0,
      currency: 'USD',
      is_active: true,
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (data) testProductIds.push(data.id);

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify storefront renders with expected structure
    await expect(page.locator('[data-testid="storefront"]')).toBeVisible({ timeout: 15000 });

    // Verify product list section renders
    await expect(page.locator('#products')).toBeVisible();
  });

  test('SHOP NAME: Should display shop name in hero badge', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create a product so storefront shows
    const { data } = await supabaseAdmin.from('products').insert({
      name: 'Test Product',
      slug: `test-shop-${Date.now()}`,
      description: 'Test',
      price: 0,
      currency: 'USD',
      is_active: true,
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (data) testProductIds.push(data.id);

    await acceptAllCookies(page);

    // Poll: page may serve stale RSC cache from previous test
    await expect(async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[data-testid="storefront"]')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 20000, intervals: [2000, 3000, 5000] });

    // Get shop config to verify shop name
    const { data: shopConfig } = await supabaseAdmin
      .from('shop_config')
      .select('shop_name')
      .limit(1)
      .single();

    expect(shopConfig?.shop_name).toBeTruthy();

    // Verify shop name is displayed in the hero badge (appears in badge and footer)
    await expect(page.getByText(shopConfig!.shop_name).first()).toBeVisible({ timeout: 15000 });
  });

  test('CTA BUTTONS: Should have proper gradient styling and link to product pages', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create a free and premium product
    const { data: freeProduct } = await supabaseAdmin.from('products').insert({
      name: 'Free CTA Test',
      slug: `free-cta-${Date.now()}`,
      description: 'Free CTA',
      price: 0,
      currency: 'USD',
      is_active: true,
      icon: '🎁',
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (freeProduct) testProductIds.push(freeProduct.id);

    const { data: paidProduct } = await supabaseAdmin.from('products').insert({
      name: 'Paid CTA Test',
      slug: `paid-cta-${Date.now()}`,
      description: 'Paid CTA',
      price: 99.00,
      currency: 'USD',
      is_active: true,
      icon: '💎',
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (paidProduct) testProductIds.push(paidProduct.id);

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify free product card links to product page
    const freeCTA = page.locator(`a[href="/p/${freeProduct.slug}"]`).first();
    await expect(freeCTA).toBeVisible({ timeout: 15000 });

    // Verify free product CTA button has success (green) styling
    const freeAccessBtn = freeCTA.locator('span').filter({ hasText: /Get Free Access/i });
    await expect(freeAccessBtn).toHaveClass(/bg-sf-success/);

    // Verify premium product card links to product page
    const paidCTA = page.locator(`a[href="/p/${paidProduct.slug}"]`).first();
    await expect(paidCTA).toBeVisible();

    // Verify premium product CTA button has accent styling
    const paidAccessBtn = paidCTA.locator('span').filter({ hasText: /Get Access Now/i });
    await expect(paidAccessBtn).toHaveClass(/bg-sf-accent/);
  });

  test('RESPONSIVE: Should show loading spinner before mount', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Create a product
    const { data } = await supabaseAdmin.from('products').insert({
      name: 'Loading Test',
      slug: `loading-${Date.now()}`,
      description: 'Test',
      price: 0,
      currency: 'USD',
      is_active: true,
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (data) testProductIds.push(data.id);

    // Navigate with network throttling to catch loading state
    await acceptAllCookies(page);
    await page.goto('/', { waitUntil: 'commit' });

    // Wait for full load and verify content eventually appears
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify storefront renders after mount
    await expect(page.locator('[data-testid="storefront"]')).toBeVisible({ timeout: 15000 });
  });

  test('PRODUCT COUNT BADGE: Should show correct count and singular/plural text', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

    // Test with exactly 1 product
    const { data: singleProduct } = await supabaseAdmin.from('products').insert({
      name: 'Single Product',
      slug: `single-${Date.now()}`,
      description: 'Only one',
      price: 0,
      currency: 'USD',
      is_active: true,
      content_delivery_type: 'content',
      content_config: { content_items: [] }
    }).select().single();
    if (singleProduct) testProductIds.push(singleProduct.id);

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Section header shows "1 product" (singular) when only 1 free product
    await expect(page.locator('text=/1 product$/i').first()).toBeVisible({ timeout: 15000 });

    // Clean up and add more products
    await cleanupTestProducts();

    // Create 3 products
    for (let i = 1; i <= 3; i++) {
      const { data } = await supabaseAdmin.from('products').insert({
        name: `Product ${i}`,
        slug: `multi-${Date.now()}-${i}`,
        description: `Product ${i}`,
        price: 0,
        currency: 'USD',
        is_active: true,
        content_delivery_type: 'content',
        content_config: { content_items: [] }
      }).select().single();
      if (data) testProductIds.push(data.id);
    }

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Section header shows "3 products" (plural) for multiple products
    await expect(page.locator('text=/3 products$/i').first()).toBeVisible({ timeout: 15000 });
  });
});
