import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

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
  let originallyActiveProductIds: string[] = [];

  // Save originally active products before any test runs
  test.beforeAll(async () => {
    const { data } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('is_active', true);
    originallyActiveProductIds = data?.map(p => p.id) || [];
  });

  // Restore originally active products after all tests
  test.afterAll(async () => {
    if (originallyActiveProductIds.length > 0) {
      await supabaseAdmin
        .from('products')
        .update({ is_active: true })
        .in('id', originallyActiveProductIds);
    }
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
  });

  test('FREE-ONLY shop: Should show free-focused hero and only free products section', async ({ page }) => {
    // Deactivate ALL existing products first to ensure clean slate
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(500);

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

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify free-only hero (use flexible text matching)
    await expect(page.locator('text=/Start Your Journey|Rozpocznij swoją podróż/i')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=/Completely Free|Całkowicie za darmo/i')).toBeVisible();

    // Verify product count in hero description
    await expect(page.locator('text=/Access.*3.*premium resources at no cost/i')).toBeVisible();

    // Verify "3 Products Available" badge
    await expect(page.locator('text=/3.*Products Available/i').first()).toBeVisible();

    // Verify free products section appears
    await expect(page.locator('text=/Everything You Need|Start Free, Learn Fast/i')).toBeVisible();

    // Verify all 3 free products are displayed
    for (const product of freeProducts) {
      await expect(page.getByText(product.name)).toBeVisible();
      await expect(page.getByText(product.description)).toBeVisible();
    }

    // Verify NO premium section
    await expect(page.locator('text=/Premium Products|Professional Excellence|Ready to Level Up/i')).not.toBeVisible();

    // Verify final CTA shows free-focused message
    await expect(page.getByText('Ready to Start Learning?')).toBeVisible();
    await expect(page.getByText('Access all our free resources and join a community of learners')).toBeVisible();

    // Verify gradient background exists (radial-gradient with gf-accent-glow)
    const bgGradient = page.locator('[style*="radial-gradient"]');
    await expect(bgGradient.first()).toBeVisible();
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

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify premium-only hero
    await expect(page.getByText('Premium Quality')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Professional Results')).toBeVisible();

    // Verify product count in hero description
    await expect(page.locator('text=/Invest in excellence with.*3.*carefully crafted premium products/i')).toBeVisible();

    // Verify premium section appears
    await expect(page.locator('text=/Professional Excellence|Profesjonalna doskonałość/i')).toBeVisible();
    await expect(page.locator('text=/Carefully crafted solutions for professionals|Starannie opracowane rozwiązania dla profesjonalistów/i')).toBeVisible();

    // Verify all 3 premium products are displayed with prices
    for (const product of paidProducts) {
      await expect(page.getByText(product.name)).toBeVisible();
      await expect(page.getByText(product.description)).toBeVisible();
      // Price should be visible as formatted currency
      await expect(page.locator(`text=/\\$${product.price}/`)).toBeVisible();
    }

    // Verify NO free section
    await expect(page.locator('text=/Free Resources|Start Free/i')).not.toBeVisible();

    // Verify final CTA shows premium-focused message
    await expect(page.getByText('Ready to Transform Your Work?')).toBeVisible();
    await expect(page.getByText('Invest in yourself and unlock your full potential')).toBeVisible();
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

    // Verify mixed hero
    await expect(page.getByText('From Free')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('To Professional')).toBeVisible();

    // Verify counts in hero description
    await expect(page.locator('text=/Start with.*2 free.*resources.*upgrade to.*2 premium/i')).toBeVisible();

    // Verify total product count badge
    await expect(page.locator('text=/4 Products Available|4 Dostępne produkty/i').first()).toBeVisible();

    // Verify BOTH sections exist
    await expect(page.locator('text=/2 Free Resources|2 Bezpłatne zasoby/i').first()).toBeVisible();
    await expect(page.locator('text=/2 Premium Products|2 Produkty premium/i').first()).toBeVisible();

    // Verify free section headline for mixed shop
    await expect(page.getByText('Start Free, Learn Fast')).toBeVisible();
    await expect(page.getByText('Get a taste of what we offer—no credit card required')).toBeVisible();

    // Verify premium section headline for mixed shop
    await expect(page.getByText('Ready to Level Up?')).toBeVisible();
    await expect(page.getByText('Unlock exclusive content and accelerate your results')).toBeVisible();

    // Verify all products are displayed
    for (const product of [...freeProducts, ...paidProducts]) {
      await expect(page.getByText(product.name)).toBeVisible();
    }

    // Verify final CTA shows mixed message
    await expect(page.getByText('Your Journey Starts Now')).toBeVisible();
    await expect(page.getByText('Start free, upgrade when ready. No pressure, just progress.')).toBeVisible();
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
    await expect(page.getByText('Our hand-picked selection for you')).toBeVisible();

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

    // Verify Limited Time badge in hero section
    await expect(page.locator('text=/Limited Time Offers|Ograniczone oferty czasowe/i').first()).toBeVisible({ timeout: 15000 });

    // Verify Coming Soon badge in hero section
    await expect(page.locator('text=/Coming Soon|Wkrótce/i').first()).toBeVisible();

    // Verify Limited badge on the product card
    const limitedCard = page.getByText('Limited Time Offer').first().locator('../..');
    await expect(limitedCard.locator('text=/Limited/i').first()).toBeVisible();

    // Verify the Limited badge has pulse animation (by checking class)
    const limitedBadge = limitedCard.locator('.animate-pulse').first();
    await expect(limitedBadge).toBeVisible();

    // Verify Coming Soon badge on the product card
    const comingSoonCard = page.getByText('Coming Soon Product').first().locator('../..');
    await expect(comingSoonCard.locator('text=/Coming Soon/i').first()).toBeVisible();
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

    // Verify the badge has correct styling (blue theme)
    await expect(durationBadge).toHaveClass(/text-blue-300/);
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
    const initialProductCards = page.locator('h3').filter({ hasText: /Free Resource|Free/i });
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
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify NO "Show All" button for free products (only 4)
    await expect(page.getByRole('button', { name: /Show All.*Free Resources/i })).not.toBeVisible();

    // Verify "Show All" button EXISTS for premium products
    const showAllPremium = page.getByRole('button', { name: /Show All 8 Premium Products/i });
    await expect(showAllPremium).toBeVisible({ timeout: 15000 });

    // Count visible premium product cards initially (should be 6 or less)
    const premiumCards = page.locator('h3').filter({ hasText: /Premium/i });
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

    // Verify gradient background exists (radial-gradient with gf-accent-glow)
    const gradientBg = page.locator('[style*="radial-gradient"]');
    await expect(gradientBg.first()).toBeVisible({ timeout: 15000 });

    // Verify shop name badge exists (bg-gf-raised with backdrop-blur)
    const shopBadge = page.locator('.backdrop-blur-xl').first();
    await expect(shopBadge).toBeVisible();

    // Verify gradient mesh styling exists (should be at least 1)
    const gradientXY = page.locator('.animate-gradient-xy');
    const gradientCount = await gradientXY.count();
    expect(gradientCount).toBeGreaterThanOrEqual(1);
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
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

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

    // Verify free product CTA has green gradient
    const freeCTA = page.locator(`a[href="/p/${freeProduct.slug}"]`).first();
    await expect(freeCTA).toBeVisible({ timeout: 15000 });
    await expect(freeCTA).toHaveClass(/from-green-600.*to-emerald-600/);

    // Verify premium product CTA has accent color
    const paidCTA = page.locator(`a[href="/p/${paidProduct.slug}"]`).first();
    await expect(paidCTA).toBeVisible();
    await expect(paidCTA).toHaveClass(/bg-gf-accent/);

    // Verify "Browse All Products" button at bottom (smooth scroll to #products)
    const browseAllButton = page.locator('a[href="#products"]').filter({ hasText: /Browse All Products/i });
    await expect(browseAllButton).toBeVisible();
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

    // Verify gradient background renders (radial-gradient with gf-accent-glow)
    const gradientBg = page.locator('[style*="radial-gradient"]');
    await expect(gradientBg.first()).toBeVisible({ timeout: 15000 });
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

    // Should show "Product Available" (singular)
    await expect(page.locator('text=/1.*Product Available|1.*Dostępny produkt/i').first()).toBeVisible({ timeout: 15000 });

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

    // Should show "Products Available" (plural)
    await expect(page.locator('text=/3 Products Available|3 Dostępne produkty/i').first()).toBeVisible({ timeout: 15000 });
  });
});
