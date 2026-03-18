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

// Test licenses for localhost (generated with scripts/generate-license.js using v2 key)
// These licenses are for 'localhost' domain to match NEXT_PUBLIC_SITE_URL=http://localhost:3000
const TEST_LICENSES = {
  unlimited: 'SF-localhost-UNLIMITED-MEQCIGNN8RHvZ36XfI6d9nbL6QkW6-ygvmxiFkIqpUoledckAiBfxPhyxkNoQBRghX8fOs3H2HoAoqigXT_1-g-EaBqwqg',
  expired: 'SF-localhost-20251231-MEQCIHVQYmrREUupC_Bj-8de11HrYjzo6E0c3LKEwDWmatZfAiA3Peoc58ZEmuFb3hYUWHyq4p7Kp2C2mlBfr97oE04xQg',
  future: 'SF-localhost-20301231-MEYCIQCWjuZ-TYJIG_c6Lp6X02QtRF5U7HTcMT4e7xs37GDP9wIhAO4EoCyihqxyj43uKFMxR39JhfbEBoo3ilFkPZe2KVfh',
  invalid: 'INVALID-LICENSE-FORMAT',
  wrongPrefix: 'XX-localhost-UNLIMITED-signature',
  tooShort: 'SF-test',
};

test.describe('License Settings', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  const password = 'password123';

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

  const clickSystemTab = async (page: Page) => {
    await page.getByRole('button', { name: /^System$/i }).click();
    await page.waitForSelector('h2:text-matches("Sellf License|Licencja Sellf", "i")', { timeout: 10000 });
  };

  const gotoSystemSettings = async (page: Page) => {
    await page.goto('/pl/dashboard/settings');
    await page.waitForLoadState('domcontentloaded');
    await clickSystemTab(page);
  };

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-license-admin-${Date.now()}-${randomStr}@example.com`;

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

    // Ensure integrations_config row exists and clear any existing license
    await supabaseAdmin
      .from('integrations_config')
      .upsert({ id: 1, sellf_license: null, updated_at: new Date().toISOString() });
  });

  test.afterAll(async () => {
    // Clear license
    await supabaseAdmin
      .from('integrations_config')
      .update({ sellf_license: null })
      .eq('id', 1);

    // Delete test user
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const testUser = users.users.find(u => u.email === adminEmail);
    if (testUser) {
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
  });

  test('Admin can access license settings on settings page', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Should see Sellf License section (matches both EN and PL)
    const licenseHeading = page.locator('h2', { hasText: /Sellf License|Licencja Sellf/i });
    await expect(licenseHeading).toBeVisible({ timeout: 10000 });

    // Should see license key input (placeholder contains "SF-" prefix)
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await expect(licenseInput).toBeVisible();

    // Should see "How licensing works" section
    const howItWorks = page.locator('text=/How licensing works|Jak działa licencjonowanie/i');
    await expect(howItWorks).toBeVisible();
  });

  test('Can enter unlimited license and see parsed details', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Enter unlimited license
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await licenseInput.fill(TEST_LICENSES.unlimited);

    // Should see license details section
    const detailsSection = page.locator('text=/License Details|Szczegóły licencji/i');
    await expect(detailsSection).toBeVisible();

    // Should show domain
    const domainText = page.getByText('localhost', { exact: true });
    await expect(domainText).toBeVisible();

    // Should show "Never" for unlimited
    const neverText = page.locator('text=/Never|Nigdy/i');
    await expect(neverText).toBeVisible();
  });

  test('Can enter time-limited license and see formatted expiry date', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Enter future license (2030-12-31)
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await licenseInput.fill(TEST_LICENSES.future);

    // Should see formatted date (2030-12-31)
    const dateText = page.locator('text=/2030-12-31/');
    await expect(dateText).toBeVisible();

    // Should show domain
    const domainText = page.getByText('localhost', { exact: true });
    await expect(domainText).toBeVisible();
  });

  test('Invalid license format shows error message', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Enter invalid license
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await licenseInput.fill(TEST_LICENSES.invalid);

    // Should show invalid format error
    const errorText = page.locator('text=/Invalid license format|Nieprawidłowy format licencji/i');
    await expect(errorText).toBeVisible({ timeout: 10000 });
  });

  test('License with wrong prefix shows error', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Enter license with wrong prefix
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await licenseInput.fill(TEST_LICENSES.wrongPrefix);

    // Should show invalid format error
    const errorText = page.locator('text=/Invalid license format|Nieprawidłowy format licencji/i');
    await expect(errorText).toBeVisible({ timeout: 10000 });
  });

  test('Too short license shows error', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Enter too short license
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await licenseInput.fill(TEST_LICENSES.tooShort);

    // Should show invalid format error
    const errorText = page.locator('text=/Invalid license format|Nieprawidłowy format licencji/i');
    await expect(errorText).toBeVisible({ timeout: 10000 });
  });

  test('Can save license successfully', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Enter valid license
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await licenseInput.fill(TEST_LICENSES.unlimited);

    // Click save button
    const saveButton = page.locator('button', { hasText: /Save License|Zapisz licencję/i });
    await saveButton.click();

    // Wait for success message
    const successMessage = page.locator('text=/saved successfully|zapisana pomyślnie/i');
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    // Verify in database
    await expect.poll(async () => {
      const { data } = await supabaseAdmin
        .from('integrations_config')
        .select('sellf_license')
        .eq('id', 1)
        .single();
      return data?.sellf_license;
    }, { timeout: 10000 }).toBe(TEST_LICENSES.unlimited);
  });

  test('Saved license persists after page refresh', async ({ page }) => {
    // First save a license
    await supabaseAdmin
      .from('integrations_config')
      .update({ sellf_license: TEST_LICENSES.future })
      .eq('id', 1);

    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Should see the saved license details
    const domainText = page.getByText('localhost', { exact: true });
    await expect(domainText).toBeVisible();

    // Should see the expiry date
    const dateText = page.locator('text=/2030-12-31/');
    await expect(dateText).toBeVisible();

    // Refresh page
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await clickSystemTab(page);

    // License should still be visible
    await expect(domainText).toBeVisible();
    await expect(dateText).toBeVisible();
  });

  test('Expired license still displays correctly (expiry shown)', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Enter expired license (2025-12-31)
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await licenseInput.fill(TEST_LICENSES.expired);

    // Should show the expiry date (even if expired)
    const dateText = page.locator('text=/2025-12-31/');
    await expect(dateText).toBeVisible({ timeout: 10000 });

    // Should show domain
    const domainText = page.getByText('localhost', { exact: true });
    await expect(domainText).toBeVisible();
  });

  test('Can clear license by emptying input and saving', async ({ page }) => {
    // First set a license
    await supabaseAdmin
      .from('integrations_config')
      .update({ sellf_license: TEST_LICENSES.unlimited })
      .eq('id', 1);

    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Wait for the saved license to load into the input before clearing
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await expect(licenseInput).toHaveValue(/SF-/, { timeout: 10000 });

    // Clear the license input
    await licenseInput.clear();

    // Confirm license details section disappeared (proves state updated)
    const detailsSection = page.locator('text=/License Details|Szczegóły licencji/i');
    await expect(detailsSection).not.toBeVisible({ timeout: 10000 });

    // Click save button
    const saveButton = page.locator('button', { hasText: /Save License|Zapisz licencję/i });
    await saveButton.click();

    // Wait for success toast (use license-specific text to avoid matching stale toasts)
    const successMessage = page.locator('text=/License saved|Licencja zapisana/i');
    await expect(successMessage).toBeVisible({ timeout: 10000 });

    // Verify in database
    await expect.poll(async () => {
      const { data } = await supabaseAdmin
        .from('integrations_config')
        .select('sellf_license')
        .eq('id', 1)
        .single();
      return data?.sellf_license;
    }, { timeout: 10000 }).toBeNull();
  });

  test('Signature is partially displayed (truncated)', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);

    // Enter valid license
    const licenseInput = page.locator('input[placeholder*="SF-"]');
    await licenseInput.fill(TEST_LICENSES.unlimited);

    // Signature should be truncated with "..." in the details section
    const signatureSpan = page.locator('span.font-mono.text-sf-muted', { hasText: '...' });
    await expect(signatureSpan).toBeVisible();

    // Full signature should NOT be visible (truncated for security/UI)
    const fullSignature = page.locator(`text=${TEST_LICENSES.unlimited.split('-').slice(3).join('-')}`);
    await expect(fullSignature).not.toBeVisible();
  });
});
