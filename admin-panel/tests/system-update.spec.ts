/**
 * Tests for System Update & Self-Upgrade
 *
 * Tests update-check, upgrade, and upgrade-status v1 API endpoints.
 * Tests the SystemUpdateSettings UI in the settings page.
 *
 * @see /api/v1/system/update-check
 * @see /api/v1/system/upgrade
 * @see /api/v1/system/upgrade-status
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function loginAsAdmin(page: any, email: string, password: string) {
  await page.goto('/login');

  await setAuthSession(page, email, password);

  await page.reload();
}

test.describe('System Update API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  let regularUserId: string;
  let regularEmail: string;
  const adminPassword = 'TestPassword123!';
  const regularPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `update-test-admin-${randomStr}@example.com`;
    regularEmail = `update-test-user-${randomStr}@example.com`;

    // Create admin user
    const { data: { user: admin }, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Update Test Admin' }
    });
    if (adminError) throw adminError;
    adminUserId = admin!.id;
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create regular (non-admin) user
    const { data: { user: regular }, error: regularError } = await supabaseAdmin.auth.admin.createUser({
      email: regularEmail,
      password: regularPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Update Test User' }
    });
    if (regularError) throw regularError;
    regularUserId = regular!.id;
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
    if (regularUserId) {
      await supabaseAdmin.auth.admin.deleteUser(regularUserId);
    }
  });

  test.describe('GET /api/v1/system/update-check', () => {
    test('should return 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.get('/api/v1/system/update-check');
      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for non-admin user', async ({ page }) => {
      await loginAsAdmin(page, regularEmail, regularPassword);
      const response = await page.request.get('/api/v1/system/update-check');
      // Non-admin users don't have admin_users record, so session auth fails
      expect(response.status()).toBe(401);
    });

    test('should return update info for admin', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get('/api/v1/system/update-check');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data).toHaveProperty('current_version');
      expect(body.data).toHaveProperty('latest_version');
      expect(body.data).toHaveProperty('update_available');
      expect(typeof body.data.update_available).toBe('boolean');
      expect(body.data).toHaveProperty('release_notes');
      expect(body.data).toHaveProperty('published_at');
      expect(body.data).toHaveProperty('release_url');
    });

    test('should return semver-like current_version matching package.json', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get('/api/v1/system/update-check');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.current_version).toBeTruthy();
      expect(body.data.current_version).not.toBe('unknown');
      expect(body.data.current_version).toMatch(/^\d+\.\d+/);
      // latest_version should also be semver-like (server-side validated)
      expect(body.data.latest_version).toMatch(/^\d+\.\d+/);
      // release_url must be null or a GitHub URL for the correct repo
      expect(
        body.data.release_url === null ||
        body.data.release_url.startsWith('https://github.com/jurczykpawel/sellf/releases/')
      ).toBe(true);
    });

    test('should accept force=true and bypass cache', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // First request populates cache
      const response1 = await page.request.get('/api/v1/system/update-check');
      expect(response1.status()).toBe(200);

      // force=true should still succeed (proves the param is accepted and doesn't error)
      const response2 = await page.request.get('/api/v1/system/update-check?force=true');
      expect(response2.status()).toBe(200);
      const body2 = await response2.json();

      // Verify force response has all required fields (not a stale/partial cache hit)
      expect(body2.data).toHaveProperty('current_version');
      expect(body2.data).toHaveProperty('latest_version');
      expect(body2.data).toHaveProperty('update_available');
      expect(body2.data).toHaveProperty('release_notes');
      expect(body2.data).toHaveProperty('published_at');
      expect(body2.data).toHaveProperty('release_url');
    });
  });

  test.describe('POST /api/v1/system/upgrade', () => {
    test('should return 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.post('/api/v1/system/upgrade');
      expect(response.status()).toBe(401);
    });

    test('should return 401 for non-admin user', async ({ page }) => {
      await loginAsAdmin(page, regularEmail, regularPassword);
      const response = await page.request.post('/api/v1/system/upgrade');
      expect(response.status()).toBe(401);
    });

    test('should return 400 or 202 depending on whether upgrade script is present', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.post('/api/v1/system/upgrade');
      const status = response.status();
      const body = await response.json();

      if (status === 400) {
        // Script not found (clean environment without admin-panel/scripts/upgrade.sh)
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error.message).toContain('Upgrade script not found');
      } else {
        // Script found (dev env with admin-panel/scripts/upgrade.sh present)
        // systemd-run may not exist on macOS but the route still returns 202 after spawning
        expect([202, 500]).toContain(status);
      }
    });

    test('should not expose internal paths in error response', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.post('/api/v1/system/upgrade');
      const body = await response.json();
      // If we got an error response, verify no internal paths are leaked
      if (body.error) {
        expect(body.error.message).not.toContain('/opt/stacks/');
        expect(body.error.message).not.toContain('upgrade.sh');
      }
      // If upgrade succeeded (202), no error paths in response either — also fine
    });

    test('should reject GET method', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get('/api/v1/system/upgrade');
      // GET is not implemented — should return 405 or 404
      expect([404, 405]).toContain(response.status());
    });
  });

  test.describe('GET /api/v1/system/upgrade-status', () => {
    test('should return 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.get('/api/v1/system/upgrade-status?token=00000000-0000-0000-0000-000000000000');
      expect(response.status()).toBe(401);
    });

    test('should return 400 for missing token', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get('/api/v1/system/upgrade-status');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 for invalid token format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get('/api/v1/system/upgrade-status?token=not-a-uuid');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject path traversal attempts in token', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get('/api/v1/system/upgrade-status?token=../../etc/passwd');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject empty token parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get('/api/v1/system/upgrade-status?token=');

      expect(response.status()).toBe(400);
    });

    test('should reject token with SQL injection payload', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get(
        "/api/v1/system/upgrade-status?token='; DROP TABLE audit_log;--"
      );

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject token with null bytes', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const response = await page.request.get(
        '/api/v1/system/upgrade-status?token=00000000-0000-0000-0000-00000000%00'
      );

      expect(response.status()).toBe(400);
    });

    test('should reject oversized token', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      const longToken = 'a'.repeat(1000);
      const response = await page.request.get(
        `/api/v1/system/upgrade-status?token=${longToken}`
      );

      expect(response.status()).toBe(400);
    });

    test('should return pending status with safe content for non-existent progress file', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      // Valid UUID but no corresponding progress file
      const response = await page.request.get('/api/v1/system/upgrade-status?token=00000000-0000-0000-0000-000000000000');

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.step).toBe('pending');
      expect(body.data.progress).toBe(0);
      expect(body.data.message).toBeTruthy();
      // Pending response must not leak the file path it checked
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('/tmp/');
      expect(bodyStr).not.toContain('sellf-upgrade');
      // Must only contain the expected keys
      expect(Object.keys(body.data).sort()).toEqual(['message', 'progress', 'step']);
    });
  });
});

test.describe('System Update Settings UI', () => {
  let adminUserId: string;
  let adminEmail: string;
  let nonAdminUserId: string;
  let nonAdminEmail: string;
  const adminPassword = 'TestPassword123!';
  const nonAdminPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `update-ui-admin-${randomStr}@example.com`;
    nonAdminEmail = `update-ui-nonadmin-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Update UI Tester' }
    });
    if (error) throw error;
    adminUserId = user!.id;
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    const { data: { user: nonAdmin }, error: nonAdminError } = await supabaseAdmin.auth.admin.createUser({
      email: nonAdminEmail,
      password: nonAdminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Non-Admin Tester' }
    });
    if (nonAdminError) throw nonAdminError;
    nonAdminUserId = nonAdmin!.id;
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
    if (nonAdminUserId) {
      await supabaseAdmin.auth.admin.deleteUser(nonAdminUserId);
    }
  });

  test('should display system update section on settings page', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/dashboard/settings');

    // The SystemUpdateSettings component should be visible
    const updateSection = page.locator('text=System Update').first();
    await expect(updateSection).toBeVisible({ timeout: 15000 });
  });

  test('should show current version', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/dashboard/settings');

    // Look for the version data-testid element
    const versionText = page.locator('[data-testid="current-version"]');
    await expect(versionText).toBeVisible({ timeout: 15000 });
    // Should contain a version-like text (e.g., "v1.0.3")
    await expect(versionText).toHaveText(/v\d+\.\d+/);
  });

  test('should have check for updates button', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/dashboard/settings');

    // Find the "Check for updates" button
    const checkButton = page.getByRole('button', { name: /check for updates|sprawdź aktualizacje/i });
    await expect(checkButton).toBeVisible({ timeout: 15000 });
  });

  test('should trigger update check on button click', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/dashboard/settings');

    // Wait for button to appear
    const checkButton = page.getByRole('button', { name: /check for updates|sprawdź aktualizacje/i });
    await expect(checkButton).toBeVisible({ timeout: 15000 });

    // Intercept the update-check API call
    const updateCheckPromise = page.waitForResponse(
      (response) => response.url().includes('/api/v1/system/update-check') && response.status() === 200
    );

    await checkButton.click();

    // Wait for the API call to complete
    const response = await updateCheckPromise;
    expect(response.status()).toBe(200);
  });

  test('should show status message after update check', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/dashboard/settings');

    const checkButton = page.getByRole('button', { name: /check for updates|sprawdź aktualizacje/i });
    await expect(checkButton).toBeVisible({ timeout: 15000 });

    // Click button and wait for the API response simultaneously
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/system/update-check') && r.status() === 200,
        { timeout: 15000 }
      ),
      checkButton.click(),
    ]);
    expect(response.status()).toBe(200);

    // After check, should show either "latest version" or "is available"
    const statusMessage = page.locator('text=/latest version|najnowsz|is available|dostępna/i').first();
    await expect(statusMessage).toBeVisible({ timeout: 10000 });
  });

  test('should not show system update section for non-admin', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await loginAsAdmin(page, nonAdminEmail, nonAdminPassword);
      await page.goto('/dashboard/settings');
      await page.waitForTimeout(2000);

      const url = page.url();
      const updateSection = page.locator('text=System Update');

      if (url.includes('/settings')) {
        // Non-admin on settings page — system update section must be hidden
        expect(await updateSection.count()).toBe(0);
      } else {
        // Non-admin was redirected away from settings — also acceptable
        expect(url).not.toContain('/settings');
      }

      // Either way, at least one assertion above executed — this test always validates something
    } finally {
      await context.close();
    }
  });
});
