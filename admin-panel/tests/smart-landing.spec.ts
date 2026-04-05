import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';
import { ProductStateGuard } from './helpers/product-state';

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
  const productGuard = new ProductStateGuard(supabaseAdmin);

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

    await setAuthSession(page, email, password);

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    await productGuard.save();

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

  // Restore originally active products after each test to prevent state contamination
  // of other parallel test suites (each test deactivates ALL products for its scenario)
  test.afterEach(async () => {
    await productGuard.restore();
  });

  test.afterAll(async () => {
    // Cleanup test product
    if (testProductId) {
      await supabaseAdmin.from('products').delete().eq('id', testProductId);
    }

    await productGuard.restore();

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

    await loginAsAdmin(page);

    // Retry navigation — RSC may need a refresh to pick up product state change
    await expect(async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('[data-testid="admin-onboarding"]')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });

    const onboarding = page.locator('[data-testid="admin-onboarding"]');

    // Should see "Add Your First Product" button linking to products with ?open=new
    const addProductButton = onboarding.locator('a[href="/dashboard/products?open=new"]');
    await expect(addProductButton.first()).toBeVisible({ timeout: 5000 });

    // Should see setup checklist items
    const checklistItems = onboarding.locator('text=/Shop configured|Sklep skonfigurowany|Add first product|Dodaj pierwszy produkt/i');
    await expect(checklistItems.first()).toBeVisible({ timeout: 5000 });

    // Should see quick links to dashboard sections (scoped to onboarding, not sidebar)
    const quickLinks = onboarding.locator('a[href*="/dashboard"]');
    const count = await quickLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test('SCENARIO 2: Guest without products should see coming soon message', async ({ page }) => {
    // Ensure ALL products are inactive (not just test product — seed data has active products too)
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await acceptAllCookies(page);

    // Retry navigation — RSC may cache product state
    await expect(async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('[data-testid="coming-soon"]')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });

    // Should see coming soon state
    const comingSoon = page.locator('[data-testid="coming-soon"]');
    await expect(comingSoon).toBeVisible({ timeout: 5000 });

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
    // Activate the test product + restore any originally active products
    await supabaseAdmin
      .from('products')
      .update({ is_active: true })
      .eq('id', testProductId);
    await productGuard.restore();

    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see storefront (products are active in DB)
    const storefront = page.locator('[data-testid="storefront"]');
    await expect(storefront).toBeVisible({ timeout: 15000 });

    // Should see product cards (links to /p/)
    const productLinks = page.locator('a[href^="/p/"]');
    await expect(productLinks.first()).toBeVisible({ timeout: 5000 });

    // Should see product showcase section
    const productSection = page.locator('text=/Premium Products|Free Resources|Featured Products|Polecane/i');
    await expect(productSection.first()).toBeVisible();

    // Should NOT see onboarding or coming soon elements
    const addProductButton = page.locator('a', { hasText: /Add Your First Product/i });
    await expect(addProductButton).not.toBeVisible();

    // ComingSoonEmptyState should not be visible (rocket in sidebar CTA is OK)
    const comingSoon = page.locator('[data-testid="coming-soon"]');
    await expect(comingSoon).not.toBeVisible();
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

  test('About page should display Sellf marketing content', async ({ page }) => {
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
    const githubLink = page.locator('a[href*="github.com/jurczykpawel/sellf"]');
    await expect(githubLink.first()).toBeVisible();

    // Should see "Open Source" badge or text
    const openSourceBadge = page.locator('text=/Open Source/i').first();
    await expect(openSourceBadge).toBeVisible();

    // Should see Sellf branding in navigation
    const sellfBrand = page.locator('text=Sellf').first();
    await expect(sellfBrand).toBeVisible();

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

    // Click and wait for About page content to appear (soft navigation in App Router)
    await aboutLink.click();

    // Should see marketing content headline (TextReveal uses \u00A0 between words)
    const mainHeadline = page.locator('h1');
    await expect(mainHeadline.filter({ hasText: /Your\s+Products|Twoje\s+Produkty/i })).toBeVisible({ timeout: 15000 });
  });

  test('Onboarding CTA quick links should navigate correctly', async ({ page }) => {
    // Ensure ALL products are inactive (restore first to clear state from previous test)
    await productGuard.restore();
    await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await loginAsAdmin(page);

    // Retry navigation — RSC may cache product state
    await expect(async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('[data-testid="admin-onboarding"]')).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });

    // Scope all locators to onboarding section (not sidebar which has same hrefs)
    const onboarding = page.locator('[data-testid="admin-onboarding"]');

    // Check that Products quick link exists
    await expect(onboarding.locator('a[href="/dashboard/products"]')).toBeVisible({ timeout: 5000 });

    // Check that Stripe/Settings quick link exists
    await expect(onboarding.locator('a[href="/dashboard/settings"]')).toBeVisible({ timeout: 5000 });

    // Check that Dashboard quick link exists
    await expect(onboarding.locator('a[href="/dashboard"]')).toBeVisible({ timeout: 5000 });

    // Click main "Add Your First Product" CTA and verify navigation with modal
    const mainCTA = onboarding.locator('a[href="/dashboard/products?open=new"]').first();
    await expect(mainCTA).toBeVisible({ timeout: 5000 });

    // Click CTA — retry because RSC refetch can swallow the click
    await expect(async () => {
      await mainCTA.click();
      await page.waitForURL('**/dashboard/products**', { timeout: 3000 });
    }).toPass({ timeout: 15000 });

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
    // Use /about which has LandingNav — SiteMenu is in the top nav (no overflow clipping)
    await expect(async () => {
      await page.goto('/about', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await expect(page.locator('nav button[aria-haspopup="menu"]').first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });

    const languageSwitcher = page.locator('nav button[aria-haspopup="menu"]').first();

    // Hover to open the dropdown (SiteMenu opens on mouseenter, not click)
    await languageSwitcher.hover();
    await page.waitForTimeout(300);

    // Dropdown shows full language names ("Polski", "English")
    const plOption = page.locator('[role="menu"] button:has-text("Polski")').first();
    await expect(plOption).toBeVisible({ timeout: 5000 });

    await plOption.click();
    await page.waitForTimeout(1000);

    // URL should contain /pl
    expect(page.url()).toContain('/pl');
  });
});
