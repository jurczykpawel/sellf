import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Smart Landing Page', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  let regularUserEmail: string;
  const password = 'password123';
  let testProductId: string;
  let originallyActiveProductIds: string[] = [];

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

    await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const supabase = createBrowserClient(supabaseUrl, anonKey);
      await supabase.auth.signInWithPassword({ email, password });
    }, {
      email: adminEmail,
      password: password,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
    });

    await page.waitForTimeout(1000);
  };

  const loginAsUser = async (page: Page, email: string) => {
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

    await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const supabase = createBrowserClient(supabaseUrl, anonKey);
      await supabase.auth.signInWithPassword({ email, password });
    }, {
      email,
      password: password,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
    });

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    // Save originally active products before any test runs
    const { data: activeProducts } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('is_active', true);
    originallyActiveProductIds = activeProducts?.map(p => p.id) || [];

    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-smart-admin-${Date.now()}-${randomStr}@example.com`;
    regularUserEmail = `test-smart-user-${Date.now()}-${randomStr}@example.com`;

    // Create admin user
    const { data: { user: adminUser }, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: password,
      email_confirm: true,
    });
    if (adminError) throw adminError;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: adminUser!.id });

    // Create regular user
    const { data: { user: regularUser }, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: regularUserEmail,
      password: password,
      email_confirm: true,
    });
    if (userError) throw userError;

    // Create a test product (inactive initially for testing empty state)
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Smart Landing Test Product',
        slug: `smart-test-${Date.now()}`,
        price: 9900,
        currency: 'USD',
        description: 'Test product for smart landing',
        is_active: false, // Start inactive
      })
      .select()
      .single();

    if (productError) throw productError;
    testProductId = product.id;
  });

  test.afterAll(async () => {
    // Cleanup test product
    if (testProductId) {
      await supabaseAdmin.from('products').delete().eq('id', testProductId);
    }

    // Restore originally active products
    if (originallyActiveProductIds.length > 0) {
      await supabaseAdmin
        .from('products')
        .update({ is_active: true })
        .in('id', originallyActiveProductIds);
    }

    // Delete users by email
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const testUsers = users.users.filter(u =>
      u.email === adminEmail || u.email === regularUserEmail
    );

    for (const user of testUsers) {
      await supabaseAdmin.auth.admin.deleteUser(user.id);
    }
  });

  test('SCENARIO 1: Admin without products should see onboarding CTA', async ({ page }) => {
    // Ensure ALL products are inactive (not just test product)
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all

    await page.waitForTimeout(1000);

    await loginAsAdmin(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Debug: log page content
    const bodyText = await page.locator('body').textContent();
    console.log('Page contains:', bodyText?.substring(0, 500));

    // Check if we see admin onboarding
    const hasOnboarding = await page.locator('[data-testid="admin-onboarding"]').count();
    console.log('Has admin onboarding:', hasOnboarding);

    // Take screenshot for debugging
    await page.screenshot({ path: 'test-results/scenario1-debug.png' });

    // Should see admin onboarding
    const onboarding = page.locator('[data-testid="admin-onboarding"]');
    await expect(onboarding).toBeVisible({ timeout: 15000 });

    // Should see "Add Your First Product" button (EN or PL) - should link to products with ?open=new
    const addProductButton = page.locator('a[href="/dashboard/products?open=new"], a:has-text("Add Your First Product"), a:has-text("Dodaj pierwszy produkt")');
    await expect(addProductButton.first()).toBeVisible({ timeout: 10000 });

    // Should see setup checklist items
    const checklistItems = page.locator('text=/Shop configured|Sklep skonfigurowany|Add first product|Dodaj pierwszy produkt/i');
    await expect(checklistItems.first()).toBeVisible({ timeout: 10000 });

    // Should see quick links to dashboard sections
    const quickLinks = page.locator('a[href*="/dashboard"]');
    const count = await quickLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test('SCENARIO 2: Guest without products should see coming soon message', async ({ page }) => {
    // Ensure no active products
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .eq('id', testProductId);

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see coming soon state
    const comingSoon = page.locator('[data-testid="coming-soon"]');
    await expect(comingSoon).toBeVisible({ timeout: 10000 });

    // Should see large rocket emoji (the main animated one, not in marketing links)
    const rocket = comingSoon.locator('.text-8xl', { hasText: '🚀' });
    await expect(rocket).toBeVisible();

    // Should see subtitle about checking back soon
    const subtitle = comingSoon.locator('text=/Check back soon|Wróć wkrótce/i');
    await expect(subtitle).toBeVisible();

    // Should NOT see admin onboarding elements
    const addProductButton = page.locator('a', { hasText: /Add Your First Product/i });
    await expect(addProductButton).not.toBeVisible();
  });

  test('SCENARIO 3: User with active products should see storefront', async ({ page }) => {
    // Activate the test product
    await supabaseAdmin
      .from('products')
      .update({ is_active: true })
      .eq('id', testProductId);

    await page.waitForTimeout(1000);

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see storefront
    const storefront = page.locator('[data-testid="storefront"]');
    await expect(storefront).toBeVisible({ timeout: 10000 });

    // Should see product cards (links to /p/)
    const productLinks = page.locator('a[href^="/p/"]');
    await expect(productLinks.first()).toBeVisible({ timeout: 5000 });

    // Should see product showcase section
    const productSection = page.locator('text=/Premium Products|Free Resources|Featured Products|Polecane/i');
    await expect(productSection.first()).toBeVisible();

    // Should NOT see onboarding or coming soon elements
    const addProductButton = page.locator('a', { hasText: /Add Your First Product/i });
    await expect(addProductButton).not.toBeVisible();

    const rocket = page.locator('text=🚀');
    await expect(rocket).not.toBeVisible();
  });

  test('SCENARIO 4: Admin with active products should see storefront (not onboarding)', async ({ page }) => {
    // Ensure product is active
    await supabaseAdmin
      .from('products')
      .update({ is_active: true })
      .eq('id', testProductId);

    await loginAsAdmin(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Even as admin, should see storefront when products exist
    const storefront = page.locator('[data-testid="storefront"]');
    await expect(storefront).toBeVisible({ timeout: 10000 });

    // Should see product cards (links to /p/)
    const productLinks = page.locator('a[href^="/p/"]');
    await expect(productLinks.first()).toBeVisible({ timeout: 5000 });

    // Should NOT see onboarding
    const setupProgress = page.locator('text=/Setup Progress/i');
    await expect(setupProgress).not.toBeVisible();
  });

  test('About page should display GateFlow marketing content', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see main headline (TextReveal uses \u00A0 between words, so match with \s)
    const mainHeadline = page.locator('h1');
    await expect(mainHeadline.filter({ hasText: /Your\s+Products|Twoje\s+Produkty/i })).toBeVisible({ timeout: 10000 });
    await expect(mainHeadline.filter({ hasText: /Your\s+Rules|Twoje\s+Zasady/i })).toBeVisible();

    // Should see "Self-Hosted" in subtitle
    const subtitle = page.locator('text=/Self-hosted/i').first();
    await expect(subtitle).toBeVisible();

    // Should see GitHub link in navigation or CTA section
    const githubLink = page.locator('a[href*="github.com/jurczykpawel/gateflow"]');
    await expect(githubLink.first()).toBeVisible();

    // Should see "Open Source" badge or text
    const openSourceBadge = page.locator('text=/Open Source/i').first();
    await expect(openSourceBadge).toBeVisible();

    // Should see GateFlow branding in navigation
    const gateflowBrand = page.locator('text=GateFlow').first();
    await expect(gateflowBrand).toBeVisible();

    // Should see "Start Free Demo" or similar CTA
    const ctaButton = page.locator('a', { hasText: /Start Free Demo|Get Started/i }).first();
    await expect(ctaButton).toBeVisible();
  });

  test('Navigation sidebar should include About link', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Look for About link in sidebar
    const aboutLink = page.locator('aside a[href="/about"]');
    await expect(aboutLink).toBeVisible({ timeout: 10000 });

    // Click it and verify navigation
    await aboutLink.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should be on about page
    expect(page.url()).toContain('/about');

    // Should see marketing content headline (TextReveal uses \u00A0 between words)
    const mainHeadline = page.locator('h1');
    await expect(mainHeadline.filter({ hasText: /Your\s+Products|Twoje\s+Produkty/i })).toBeVisible({ timeout: 10000 });
  });

  test('Onboarding CTA quick links should navigate correctly', async ({ page }) => {
    // Ensure ALL products are inactive
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await page.waitForTimeout(1000);

    await loginAsAdmin(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify quick links exist in onboarding component (not sidebar)
    const onboardingSection = page.locator('div.max-w-4xl, div:has-text("Setup Progress")');

    // Check that Products quick link exists
    const productsLink = onboardingSection.locator('a[href="/dashboard/products"]').first();
    await expect(productsLink).toBeVisible({ timeout: 5000 });

    // Check that Stripe/Settings quick link exists
    const stripeLink = onboardingSection.locator('a[href="/dashboard/settings"]').first();
    await expect(stripeLink).toBeVisible({ timeout: 5000 });

    // Check that Dashboard quick link exists
    const dashboardLink = onboardingSection.locator('a[href="/dashboard"]').first();
    await expect(dashboardLink).toBeVisible({ timeout: 5000 });

    // Click main "Add Your First Product" CTA and verify navigation with modal
    const mainCTA = page.locator('a[href="/dashboard/products?open=new"]').first();
    await expect(mainCTA).toBeVisible({ timeout: 10000 });

    await mainCTA.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should navigate to products page with ?open=new param
    expect(page.url()).toContain('/dashboard/products');
    expect(page.url()).toContain('open=new');
  });

  test('Storefront should link to /products catalog', async ({ page }) => {
    // Ensure product is active
    await supabaseAdmin
      .from('products')
      .update({ is_active: true })
      .eq('id', testProductId);

    await page.waitForTimeout(1000);

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify storefront is shown
    const storefront = page.locator('[data-testid="storefront"]');
    await expect(storefront).toBeVisible({ timeout: 10000 });

    // Verify product links exist (which effectively shows products catalog)
    const productLinks = page.locator('a[href^="/p/"]');
    await expect(productLinks.first()).toBeVisible();
  });

  test('Language switching should work on all landing page variants', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Language switcher must be present on the landing page
    const languageSwitcher = page.locator('button[aria-label*="language" i], button:has-text("EN"), button:has-text("PL")').first();
    await expect(languageSwitcher).toBeVisible({ timeout: 10000 });

    // Switch to Polish
    await languageSwitcher.click();
    await page.waitForTimeout(500);

    const plOption = page.locator('button:has-text("PL"), a:has-text("PL")').first();
    await expect(plOption).toBeVisible({ timeout: 5000 });

    await plOption.click();
    await page.waitForTimeout(1000);

    // URL should contain /pl
    expect(page.url()).toContain('/pl');
  });
});
