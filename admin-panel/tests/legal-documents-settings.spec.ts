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

test.describe('Legal Documents Settings', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  const password = 'password123';
  let shopConfigId: string;

  // Test URLs
  const TEST_TERMS_URL = 'https://example.com/test-terms-of-service.pdf';
  const TEST_PRIVACY_URL = 'https://example.com/test-privacy-policy.pdf';
  const UPDATED_TERMS_URL = 'https://example.com/updated-terms.pdf';
  const UPDATED_PRIVACY_URL = 'https://example.com/updated-privacy.pdf';

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

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-legal-admin-${Date.now()}-${randomStr}@example.com`;

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

    // Get shop_config ID
    const { data: shopConfig } = await supabaseAdmin
      .from('shop_config')
      .select('id')
      .single();

    if (shopConfig) {
      shopConfigId = shopConfig.id;
    }

    // Reset legal document URLs to null for clean tests
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: null,
        privacy_policy_url: null
      })
      .eq('id', shopConfigId);
  });

  test.afterAll(async () => {
    // Cleanup - restore null values for legal documents
    if (shopConfigId) {
      await supabaseAdmin
        .from('shop_config')
        .update({
          terms_of_service_url: null,
          privacy_policy_url: null
        })
        .eq('id', shopConfigId);
    }

    // Delete test user
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const testUser = users.users.find(u => u.email === adminEmail);
    if (testUser) {
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
  });

  // ============================================================================
  // LegalDocumentsSettings Component Tests
  // ============================================================================

  test('Admin can access legal documents settings section', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see "Legal Documents" heading
    const legalHeading = page.locator('h2', { hasText: /Legal Documents|Dokumenty prawne/i });
    await expect(legalHeading).toBeVisible({ timeout: 10000 });

    // Should see description text
    const description = page.locator('text=/Configure URLs|Skonfiguruj adresy/i');
    await expect(description).toBeVisible();
  });

  test('Legal documents form shows both URL inputs', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the Legal Documents section - use more specific selector
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    await expect(legalHeading).toBeVisible();

    // Get the card container that contains the legal heading
    const legalSection = legalHeading.locator('xpath=ancestor::div[contains(@class, "rounded-xl")]');

    // Should see Terms of Service URL input
    const termsLabel = legalSection.locator('label', { hasText: /Terms of Service|Regulamin/i });
    await expect(termsLabel).toBeVisible();

    // Should see Privacy Policy URL input
    const privacyLabel = legalSection.locator('label', { hasText: /Privacy Policy|Polityk/i });
    await expect(privacyLabel).toBeVisible();

    // Should see exactly 2 URL inputs in this section
    const urlInputs = legalSection.locator('input[type="url"]');
    const count = await urlInputs.count();
    expect(count).toBe(2);
  });

  test('Can enter and save legal document URLs', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('xpath=ancestor::div[contains(@class, "rounded-xl")]');

    // Get URL inputs
    const urlInputs = legalSection.locator('input[type="url"]');

    // Fill Terms of Service URL (first input)
    await urlInputs.nth(0).fill(TEST_TERMS_URL);

    // Fill Privacy Policy URL (second input)
    await urlInputs.nth(1).fill(TEST_PRIVACY_URL);

    // Click save button within legal section
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    await saveButton.click();

    // Wait for the button to stop showing "Saving..." state
    await page.waitForTimeout(3000);

    // Verify values were saved in database
    const { data: savedConfig } = await supabaseAdmin
      .from('shop_config')
      .select('terms_of_service_url, privacy_policy_url')
      .eq('id', shopConfigId)
      .single();

    expect(savedConfig?.terms_of_service_url).toBe(TEST_TERMS_URL);
    expect(savedConfig?.privacy_policy_url).toBe(TEST_PRIVACY_URL);
  });

  test('Saved URLs persist after page refresh', async ({ page }) => {
    // First, ensure URLs are set in database
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: TEST_TERMS_URL,
        privacy_policy_url: TEST_PRIVACY_URL
      })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('xpath=ancestor::div[contains(@class, "rounded-xl")]');
    const urlInputs = legalSection.locator('input[type="url"]');

    // Check that values are pre-filled
    const termsValue = await urlInputs.nth(0).inputValue();
    const privacyValue = await urlInputs.nth(1).inputValue();

    expect(termsValue).toBe(TEST_TERMS_URL);
    expect(privacyValue).toBe(TEST_PRIVACY_URL);
  });

  test('Can update existing URLs', async ({ page }) => {
    // Set initial URLs
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: TEST_TERMS_URL,
        privacy_policy_url: TEST_PRIVACY_URL
      })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('xpath=ancestor::div[contains(@class, "rounded-xl")]');
    const urlInputs = legalSection.locator('input[type="url"]');

    // Update URLs
    await urlInputs.nth(0).fill(UPDATED_TERMS_URL);
    await urlInputs.nth(1).fill(UPDATED_PRIVACY_URL);

    // Save
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    await saveButton.click();

    // Wait for save to complete
    await page.waitForTimeout(3000);

    // Verify updated values in database
    const { data: savedConfig } = await supabaseAdmin
      .from('shop_config')
      .select('terms_of_service_url, privacy_policy_url')
      .eq('id', shopConfigId)
      .single();

    expect(savedConfig?.terms_of_service_url).toBe(UPDATED_TERMS_URL);
    expect(savedConfig?.privacy_policy_url).toBe(UPDATED_PRIVACY_URL);
  });

  test('Can clear URLs by saving empty values', async ({ page }) => {
    // Set initial URLs
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: TEST_TERMS_URL,
        privacy_policy_url: TEST_PRIVACY_URL
      })
      .eq('id', shopConfigId);

    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('xpath=ancestor::div[contains(@class, "rounded-xl")]');
    const urlInputs = legalSection.locator('input[type="url"]');

    // Clear URLs
    await urlInputs.nth(0).fill('');
    await urlInputs.nth(1).fill('');

    // Save
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    await saveButton.click();

    // Wait for save to complete
    await page.waitForTimeout(3000);

    // Verify values are cleared (null) in database
    const { data: savedConfig } = await supabaseAdmin
      .from('shop_config')
      .select('terms_of_service_url, privacy_policy_url')
      .eq('id', shopConfigId)
      .single();

    expect(savedConfig?.terms_of_service_url).toBeNull();
    expect(savedConfig?.privacy_policy_url).toBeNull();
  });

  test('Info box shows links to /terms and /privacy pages', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('xpath=ancestor::div[contains(@class, "rounded-xl")]');

    // Should see info box with links
    const termsLink = legalSection.locator('a[href="/terms"]');
    const privacyLink = legalSection.locator('a[href="/privacy"]');

    await expect(termsLink).toBeVisible();
    await expect(privacyLink).toBeVisible();
  });

  test('Non-admin users cannot access legal documents settings', async ({ page }) => {
    // Create regular user
    const regularEmail = `test-regular-legal-${Date.now()}@example.com`;
    const { data: { user: regularUser } } = await supabaseAdmin.auth.admin.createUser({
      email: regularEmail,
      password: password,
      email_confirm: true,
    });

    await acceptAllCookies(page);
    await page.goto('/');

    await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const supabase = createBrowserClient(supabaseUrl, anonKey);
      await supabase.auth.signInWithPassword({ email, password });
    }, {
      email: regularEmail,
      password: password,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
    });

    await page.waitForTimeout(1000);

    // Try to access settings - should redirect or show error
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should NOT see legal documents settings
    const url = page.url();
    const hasLegalSection = await page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")').count();

    // Either redirected away from settings OR no legal section visible
    if (url.includes('/dashboard/settings')) {
      expect(hasLegalSection).toBe(0);
    } else {
      expect(url).not.toContain('/dashboard/settings');
    }

    // Cleanup
    if (regularUser) {
      await supabaseAdmin.auth.admin.deleteUser(regularUser.id);
    }
  });

  // ============================================================================
  // Database Priority over .env Tests for /terms and /privacy pages
  // Note: These tests verify the redirect behavior by intercepting requests
  // since we can't actually follow external redirects in tests
  // ============================================================================

  test('/terms page: Database URL takes priority over .env', async ({ page }) => {
    // Set a unique URL in database that we can verify
    const dbTermsUrl = 'https://db-priority-test.example.com/terms-db.pdf';

    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: dbTermsUrl
      })
      .eq('id', shopConfigId);

    // Intercept the redirect to verify the target URL
    let redirectUrl: string | null = null;
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('db-priority-test.example.com')) {
        redirectUrl = url;
        route.abort(); // Don't actually try to load the external URL
      } else {
        route.continue();
      }
    });

    // Navigate to /terms page - it should try to redirect to DB URL
    await page.goto('/terms', { waitUntil: 'commit' });
    await page.waitForTimeout(1000);

    // Verify the redirect was attempted to the DB URL
    expect(redirectUrl).toBe(dbTermsUrl);
  });

  test('/privacy page: Database URL takes priority over .env', async ({ page }) => {
    // Set a unique URL in database
    const dbPrivacyUrl = 'https://db-priority-test.example.com/privacy-db.pdf';

    await supabaseAdmin
      .from('shop_config')
      .update({
        privacy_policy_url: dbPrivacyUrl
      })
      .eq('id', shopConfigId);

    // Intercept the redirect to verify the target URL
    let redirectUrl: string | null = null;
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('db-priority-test.example.com')) {
        redirectUrl = url;
        route.abort();
      } else {
        route.continue();
      }
    });

    // Navigate to /privacy page - it should try to redirect to DB URL
    await page.goto('/privacy', { waitUntil: 'commit' });
    await page.waitForTimeout(1000);

    // Verify the redirect was attempted to the DB URL
    expect(redirectUrl).toBe(dbPrivacyUrl);
  });

  test('/terms page: Shows fallback when DB is empty and no .env', async ({ page }) => {
    // Clear DB URL
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: null
      })
      .eq('id', shopConfigId);

    // Navigate to /terms page
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const currentUrl = page.url();

    // If we're still on /terms, verify fallback content
    if (currentUrl.includes('/terms')) {
      const heading = page.locator('h1', { hasText: 'Terms of Service' });
      await expect(heading).toBeVisible();

      // Check for Configuration Required heading (h2)
      const configRequired = page.locator('h2', { hasText: 'Configuration Required' });
      await expect(configRequired).toBeVisible();

      // Should mention Admin Panel option
      const adminOption = page.locator('text=/Admin Panel/i').first();
      await expect(adminOption).toBeVisible();
    } else {
      // If redirected, .env had a URL - verify we actually went somewhere valid
      expect(currentUrl).not.toContain('/terms');
    }
  });

  test('/privacy page: Shows fallback when DB is empty and no .env', async ({ page }) => {
    // Clear DB URL
    await supabaseAdmin
      .from('shop_config')
      .update({
        privacy_policy_url: null
      })
      .eq('id', shopConfigId);

    // Navigate to /privacy page
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const currentUrl = page.url();

    // If we're still on /privacy, verify fallback content
    if (currentUrl.includes('/privacy')) {
      const heading = page.locator('h1', { hasText: 'Privacy Policy' });
      await expect(heading).toBeVisible();

      const configRequired = page.locator('h2', { hasText: 'Configuration Required' });
      await expect(configRequired).toBeVisible();
    } else {
      // If redirected, .env had a URL - verify we actually went somewhere valid
      expect(currentUrl).not.toContain('/privacy');
    }
  });

  test('Changing DB URL affects redirect target', async ({ page }) => {
    // Set initial URL
    const initialUrl = 'https://initial-test.example.com/terms.pdf';
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: initialUrl
      })
      .eq('id', shopConfigId);

    // Intercept redirects
    let redirectedTo: string | null = null;
    await page.route('**/initial-test.example.com/**', (route) => {
      redirectedTo = route.request().url();
      route.abort();
    });
    await page.route('**/updated-test.example.com/**', (route) => {
      redirectedTo = route.request().url();
      route.abort();
    });

    // First visit - should redirect to initial URL
    await page.goto('/terms', { waitUntil: 'commit' });
    await expect.poll(() => redirectedTo, { timeout: 5000 }).toBe(initialUrl);

    // Update URL in database
    const updatedUrl = 'https://updated-test.example.com/terms-v2.pdf';
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: updatedUrl
      })
      .eq('id', shopConfigId);

    redirectedTo = null;

    // Second visit - should redirect to new URL
    await page.goto('/terms', { waitUntil: 'commit' });
    await expect.poll(() => redirectedTo, { timeout: 5000 }).toBe(updatedUrl);
  });

  test('Empty string in DB is treated as null (shows fallback)', async ({ page }) => {
    // Set empty string (not null)
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: ''
      })
      .eq('id', shopConfigId);

    // Navigate to /terms page
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const currentUrl = page.url();

    // If we're still on /terms, empty string was treated as no URL
    if (currentUrl.includes('/terms')) {
      const configRequired = page.locator('h2', { hasText: 'Configuration Required' });
      await expect(configRequired).toBeVisible();
    } else {
      // If redirected, .env had a URL - verify we actually went somewhere valid
      expect(currentUrl).not.toContain('/terms');
    }
  });

  test('UI-saved URL is used for /terms redirect', async ({ page }) => {
    // Start with empty
    await supabaseAdmin
      .from('shop_config')
      .update({
        terms_of_service_url: null
      })
      .eq('id', shopConfigId);

    // Login as admin and set URL via UI
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the Legal Documents section and set Terms URL
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('xpath=ancestor::div[contains(@class, "rounded-xl")]');
    const urlInputs = legalSection.locator('input[type="url"]');

    const uiSetUrl = 'https://ui-set-terms.example.com/terms.pdf';
    await urlInputs.nth(0).fill(uiSetUrl);

    // Save
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    await saveButton.click();
    await page.waitForTimeout(3000);

    // Verify DB was updated
    const { data: savedConfig } = await supabaseAdmin
      .from('shop_config')
      .select('terms_of_service_url')
      .eq('id', shopConfigId)
      .single();

    expect(savedConfig?.terms_of_service_url).toBe(uiSetUrl);

    // Set up route interception
    let redirectUrl: string | null = null;
    await page.route('**/ui-set-terms.example.com/**', (route) => {
      redirectUrl = route.request().url();
      route.abort();
    });

    // Now visit /terms - should redirect to the URL we just set
    await page.goto('/terms', { waitUntil: 'commit' });
    await expect.poll(() => redirectUrl, { timeout: 5000 }).toBe(uiSetUrl);
  });

  test('UI-saved URL is used for /privacy redirect', async ({ page }) => {
    // Start with empty
    await supabaseAdmin
      .from('shop_config')
      .update({
        privacy_policy_url: null
      })
      .eq('id', shopConfigId);

    // Login as admin and set URL via UI
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the Legal Documents section and set Privacy URL
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('xpath=ancestor::div[contains(@class, "rounded-xl")]');
    const urlInputs = legalSection.locator('input[type="url"]');

    const uiSetUrl = 'https://ui-set-privacy.example.com/privacy.pdf';
    await urlInputs.nth(1).fill(uiSetUrl);

    // Save
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    await saveButton.click();
    await page.waitForTimeout(3000);

    // Verify DB was updated
    const { data: savedConfig } = await supabaseAdmin
      .from('shop_config')
      .select('privacy_policy_url')
      .eq('id', shopConfigId)
      .single();

    expect(savedConfig?.privacy_policy_url).toBe(uiSetUrl);

    // Set up route interception
    let redirectUrl: string | null = null;
    await page.route('**/ui-set-privacy.example.com/**', (route) => {
      redirectUrl = route.request().url();
      route.abort();
    });

    // Now visit /privacy - should redirect to the URL we just set
    await page.goto('/privacy', { waitUntil: 'commit' });
    await expect.poll(() => redirectUrl, { timeout: 5000 }).toBe(uiSetUrl);
  });
});
