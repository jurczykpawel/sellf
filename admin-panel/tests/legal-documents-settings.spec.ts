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
          style.innerHTML = '#cc-main { display: none !important; }';
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
  };

  // Helper: navigate to settings and activate the "Legal" tab
  // (Settings page uses tabs since the tab refactor; Legal section lives under "legal" tab)
  const gotoLegalSettings = async (page: Page) => {
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('domcontentloaded');
    // Click the "Legal" tab – label is "Legal" (EN) or "Prawne" (PL)
    const legalTab = page.getByRole('button', { name: /^Legal$|^Prawne$/i });
    await expect(legalTab).toBeVisible({ timeout: 20000 });
    await legalTab.click();
    // Wait for the legal section heading to actually render
    await expect(
      page.locator('h2', { hasText: /Legal Documents|Dokumenty prawne/i })
    ).toBeVisible({ timeout: 10000 });
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

  // Reset shared DB state before each test so tests don't bleed into each other
  test.beforeEach(async () => {
    if (shopConfigId) {
      await supabaseAdmin
        .from('shop_config')
        .update({ terms_of_service_url: null, privacy_policy_url: null })
        .eq('id', shopConfigId);
    }
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
    await gotoLegalSettings(page);

    // Should see "Legal Documents" heading
    const legalHeading = page.locator('h2', { hasText: /Legal Documents|Dokumenty prawne/i });
    await expect(legalHeading).toBeVisible({ timeout: 10000 });

    // Should see description text
    const description = page.locator('text=/Configure URLs|Skonfiguruj adresy/i');
    await expect(description).toBeVisible();
  });

  test('Legal documents form shows both URL inputs', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoLegalSettings(page);

    // Find the Legal Documents section - use more specific selector
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    await expect(legalHeading).toBeVisible();

    // Get the card container that contains the legal heading
    const legalSection = legalHeading.locator('..');

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
    await gotoLegalSettings(page);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('..');

    // Get URL inputs
    const urlInputs = legalSection.locator('input[type="url"]');

    // Fill Terms of Service URL (first input)
    await urlInputs.nth(0).fill(TEST_TERMS_URL);
    await expect(urlInputs.nth(0)).toHaveValue(TEST_TERMS_URL);

    // Fill Privacy Policy URL (second input)
    await urlInputs.nth(1).fill(TEST_PRIVACY_URL);
    await expect(urlInputs.nth(1)).toHaveValue(TEST_PRIVACY_URL);

    // Click save button within legal section
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    const toastsBefore = await page.locator('[data-sonner-toast]').count();
    await saveButton.click();

    // Wait for save confirmation toast
    await expect.poll(
      () => page.locator('[data-sonner-toast]').count(),
      { timeout: 10000, message: 'Waiting for save confirmation toast' }
    ).toBeGreaterThan(toastsBefore);

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
    await gotoLegalSettings(page);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('..');
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
    await gotoLegalSettings(page);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('..');
    const urlInputs = legalSection.locator('input[type="url"]');

    // Wait for form to load existing URLs before overwriting
    await expect(urlInputs.nth(0)).toHaveValue(TEST_TERMS_URL, { timeout: 10000 });

    // Update URLs — clear first, then type to ensure React state is updated
    await urlInputs.nth(0).clear();
    await urlInputs.nth(0).fill(UPDATED_TERMS_URL);
    await expect(urlInputs.nth(0)).toHaveValue(UPDATED_TERMS_URL);
    await urlInputs.nth(1).clear();
    await urlInputs.nth(1).fill(UPDATED_PRIVACY_URL);
    await expect(urlInputs.nth(1)).toHaveValue(UPDATED_PRIVACY_URL);

    // Save
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });

    // Count existing toasts before save
    const toastsBefore = await page.locator('[data-sonner-toast]').count();

    await saveButton.click();

    // Wait for a NEW toast to appear (count increases)
    await expect.poll(
      () => page.locator('[data-sonner-toast]').count(),
      { timeout: 10000, message: 'Waiting for save confirmation toast' }
    ).toBeGreaterThan(toastsBefore);

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
    await gotoLegalSettings(page);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('..');
    const urlInputs = legalSection.locator('input[type="url"]');

    // Clear URLs
    await urlInputs.nth(0).fill('');
    await urlInputs.nth(1).fill('');

    // Save
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    const toastsBefore = await page.locator('[data-sonner-toast]').count();
    await saveButton.click();

    // Wait for save confirmation toast
    await expect.poll(
      () => page.locator('[data-sonner-toast]').count(),
      { timeout: 10000, message: 'Waiting for save confirmation toast' }
    ).toBeGreaterThan(toastsBefore);

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
    await gotoLegalSettings(page);

    // Find the Legal Documents section
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('..');

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

    await setAuthSession(page, regularEmail, password);

    await page.waitForTimeout(1000);

    // Try to access settings - should redirect or show error
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('domcontentloaded');
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

    // Inspect the 307 directly instead of letting the browser follow the
    // redirect to an unresolvable host (Chromium throws ERR_NAME_NOT_RESOLVED
    // on `.example.com` and bubbles the failure up to `page.goto`, masking
    // the actual assertion we care about).
    const response = await page.request.get('/terms', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toBe(dbTermsUrl);
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

    const response = await page.request.get('/privacy', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toBe(dbPrivacyUrl);
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
    await page.waitForLoadState('domcontentloaded');
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
    await page.waitForLoadState('domcontentloaded');
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
    // Inspect the 307 directly — page.goto on a redirect to an unresolvable
    // host throws ERR_NAME_NOT_RESOLVED before assertions can run.
    const initialUrl = 'https://initial-test.example.com/terms.pdf';
    await supabaseAdmin
      .from('shop_config')
      .update({ terms_of_service_url: initialUrl })
      .eq('id', shopConfigId);

    const firstResponse = await page.request.get('/terms', { maxRedirects: 0 });
    expect(firstResponse.status()).toBe(307);
    expect(firstResponse.headers()['location']).toBe(initialUrl);

    const updatedUrl = 'https://updated-test.example.com/terms-v2.pdf';
    await supabaseAdmin
      .from('shop_config')
      .update({ terms_of_service_url: updatedUrl })
      .eq('id', shopConfigId);

    const secondResponse = await page.request.get('/terms', { maxRedirects: 0 });
    expect(secondResponse.status()).toBe(307);
    expect(secondResponse.headers()['location']).toBe(updatedUrl);
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
    await page.waitForLoadState('domcontentloaded');
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
    // Login as admin and set URL via UI
    await loginAsAdmin(page);
    await gotoLegalSettings(page);

    // Find the Legal Documents section and set Terms URL
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('..');
    const urlInputs = legalSection.locator('input[type="url"]');

    const uiSetUrl = 'https://ui-set-terms.example.com/terms.pdf';
    await urlInputs.nth(0).fill(uiSetUrl);
    await expect(urlInputs.nth(0)).toHaveValue(uiSetUrl);

    // Save and wait for toast confirmation
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    const toastsBefore = await page.locator('[data-sonner-toast]').count();
    await saveButton.click();
    await expect.poll(
      () => page.locator('[data-sonner-toast]').count(),
      { timeout: 10000, message: 'Waiting for save toast' }
    ).toBeGreaterThan(toastsBefore);

    // Verify DB was updated
    const { data: savedConfig } = await supabaseAdmin
      .from('shop_config')
      .select('terms_of_service_url')
      .eq('id', shopConfigId)
      .single();

    expect(savedConfig?.terms_of_service_url).toBe(uiSetUrl);

    // Inspect the 307 directly — page.goto with an unresolvable host throws.
    const response = await page.request.get('/terms', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toBe(uiSetUrl);
  });

  test('UI-saved URL is used for /privacy redirect', async ({ page }) => {
    // Login as admin and set URL via UI
    await loginAsAdmin(page);
    await gotoLegalSettings(page);

    // Find the Legal Documents section and set Privacy URL
    const legalHeading = page.locator('h2:text-matches("Legal Documents|Dokumenty prawne", "i")');
    const legalSection = legalHeading.locator('..');
    const urlInputs = legalSection.locator('input[type="url"]');

    const uiSetUrl = 'https://ui-set-privacy.example.com/privacy.pdf';
    await urlInputs.nth(1).fill(uiSetUrl);
    await expect(urlInputs.nth(1)).toHaveValue(uiSetUrl);

    // Save and wait for toast confirmation
    const saveButton = legalSection.locator('button', { hasText: /Save|Zapisz/i });
    const toastsBefore = await page.locator('[data-sonner-toast]').count();
    await saveButton.click();
    await expect.poll(
      () => page.locator('[data-sonner-toast]').count(),
      { timeout: 10000, message: 'Waiting for save toast' }
    ).toBeGreaterThan(toastsBefore);

    // Verify DB was updated
    const { data: savedConfig } = await supabaseAdmin
      .from('shop_config')
      .select('privacy_policy_url')
      .eq('id', shopConfigId)
      .single();

    expect(savedConfig?.privacy_policy_url).toBe(uiSetUrl);

    // Inspect the 307 directly — page.goto with an unresolvable host throws.
    const response = await page.request.get('/privacy', { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toBe(uiSetUrl);
  });
});
