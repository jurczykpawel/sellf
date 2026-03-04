/**
 * E2E UI Tests for API Keys Management
 *
 * Tests the admin UI for managing API keys:
 * - Create, list, rotate, revoke API keys
 * - Verify UI states and interactions
 */

import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';

// Enforce single worker for database state consistency
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('API Keys Management UI', () => {
  let adminEmail: string;
  let adminUserId: string;
  let adminId: string;
  const adminPassword = 'TestPassword123!';

  // Login helper
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

    await setAuthSession(page, adminEmail, adminPassword);

    await page.waitForTimeout(500);
  };

  // Helper to fill the name field in create modal
  const fillKeyName = async (page: Page, name: string) => {
    // The input has placeholder like "e.g., Production API Key, MCP Server"
    const nameInput = page.locator('input[type="text"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(name);
  };

  test.beforeAll(async () => {
    // Create admin user
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `api-keys-ui-test-${Date.now()}-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'API Keys UI Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // Make user an admin
    const { data: admin } = await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: adminUserId })
      .select('id')
      .single();

    adminId = admin!.id;

    // Clean up any existing keys for this admin
    await supabaseAdmin
      .from('api_keys')
      .delete()
      .eq('admin_user_id', adminId);
  });

  test.afterAll(async () => {
    // Cleanup all keys for this admin
    if (adminId) {
      const { data: keys } = await supabaseAdmin
        .from('api_keys')
        .select('id')
        .eq('admin_user_id', adminId);

      if (keys) {
        for (const key of keys) {
          await supabaseAdmin.from('api_key_audit_log').delete().eq('api_key_id', key.id);
          await supabaseAdmin.from('api_keys').delete().eq('id', key.id);
        }
      }
    }

    // Cleanup admin user
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test('should display empty state when no API keys exist', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    // Wait for page load
    await expect(page.locator('h1')).toContainText(/API Keys/i, { timeout: 10000 });

    // Should show empty state
    await expect(page.getByText(/No API keys/i)).toBeVisible({ timeout: 10000 });

    // Create button should be visible
    await expect(page.getByRole('button', { name: /Create/i })).toBeVisible();
  });

  test('should create a new API key with default settings', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    // Click create button
    await page.getByRole('button', { name: /Create/i }).click();

    // Modal should open
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });

    // Fill in name
    await fillKeyName(page, 'Test Key Default');

    // Submit - find button inside modal
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: /Create/i }).click();

    // Should show success modal with the key
    await expect(page.getByRole('heading', { name: /API Key Created/i })).toBeVisible({ timeout: 15000 });

    // Key should be visible (masked by default)
    const keyInput = page.locator('input[readonly]').first();
    await expect(keyInput).toBeVisible();

    // Get key value
    const keyValue = await keyInput.inputValue();
    expect(keyValue).toMatch(/^sf_live_/);

    // Close modal
    await page.getByRole('button', { name: /Done/i }).click();

    // Key should appear in the list
    await expect(page.getByText('Test Key Default')).toBeVisible({ timeout: 5000 });
  });

  test('should create API key with custom scopes', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    await page.getByRole('button', { name: /Create/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });

    // Fill name
    await fillKeyName(page, 'Limited Scope Key');

    // Click "Read Only" preset button to unselect Full Access
    await page.getByRole('button', { name: 'Read Only' }).click();

    // Submit
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: /Create/i }).click();

    // Close success modal
    await expect(page.getByRole('heading', { name: /API Key Created/i })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Done/i }).click();

    // Verify key in list
    await expect(page.getByText('Limited Scope Key')).toBeVisible({ timeout: 5000 });
  });

  test('should copy API key to clipboard', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    await page.getByRole('button', { name: /Create/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await fillKeyName(page, 'Copy Test Key');

    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: /Create/i }).click();

    await expect(page.getByRole('heading', { name: /API Key Created/i })).toBeVisible({ timeout: 15000 });

    // Click copy button (has Copy icon)
    const copyButton = page.locator('button').filter({ has: page.locator('svg.lucide-copy') });
    await copyButton.click();

    // Should show copied confirmation (toast)
    await expect(page.getByText(/Copied/i)).toBeVisible({ timeout: 5000 });

    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/^sf_live_/);

    await page.getByRole('button', { name: /Done/i }).click();
  });

  test('should toggle key visibility in secret modal', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    await page.getByRole('button', { name: /Create/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await fillKeyName(page, 'Visibility Test Key');

    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: /Create/i }).click();

    await expect(page.getByRole('heading', { name: /API Key Created/i })).toBeVisible({ timeout: 15000 });

    // Key should be masked by default (type=password)
    const keyInput = page.locator('input[type="password"]').first();
    await expect(keyInput).toBeVisible();

    // Click eye icon to show (EyeOff is shown when password is hidden)
    const eyeButton = page.locator('button').filter({ has: page.locator('svg.lucide-eye') });
    await eyeButton.click();

    // Now should be visible as text
    await expect(page.locator('input[type="text"][readonly]').first()).toBeVisible();

    await page.getByRole('button', { name: /Done/i }).click();
  });

  test('should display list of API keys with correct info', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    // Should show keys we created
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Table should have headers
    await expect(page.locator('th').filter({ hasText: /Name/i })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: /Key/i })).toBeVisible();
    await expect(page.locator('th').filter({ hasText: /Status/i })).toBeVisible();

    // Should show our keys
    await expect(page.getByText('Test Key Default')).toBeVisible();

    // Should show key prefix with ellipsis
    await expect(page.locator('code').filter({ hasText: /sf_live_.*\.\.\./ }).first()).toBeVisible();

    // Should show Active status badge (green)
    await expect(page.locator('span').filter({ hasText: /Active/i }).first()).toBeVisible();
  });

  test('should rotate API key with grace period', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    // Find a key row and click rotate button
    const keyRow = page.locator('tr').filter({ hasText: 'Test Key Default' });
    await expect(keyRow).toBeVisible({ timeout: 10000 });

    // Click rotate button (RotateCw icon)
    const rotateButton = keyRow.locator('button').filter({ has: page.locator('svg.lucide-rotate-cw') });
    await rotateButton.click();

    // Confirmation modal should appear
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/24 hours/i)).toBeVisible();

    // Confirm rotation
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: /Rotate/i }).click();

    // Should show new key
    await expect(page.getByRole('heading', { name: /API Key Created/i })).toBeVisible({ timeout: 15000 });

    // New key should be visible
    const keyInput = page.locator('input[readonly]').first();
    const newKey = await keyInput.inputValue();
    expect(newKey).toMatch(/^sf_live_/);

    await page.getByRole('button', { name: /Done/i }).click();

    // New key should appear with "(rotated)" suffix in the table
    await expect(page.locator('table').getByText(/\(rotated\)/i)).toBeVisible({ timeout: 5000 });
  });

  test('should revoke API key', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    // First create a key to revoke
    await page.getByRole('button', { name: /Create/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await fillKeyName(page, 'Key To Revoke');

    const createModal = page.getByRole('dialog');
    await createModal.getByRole('button', { name: /Create/i }).click();
    await expect(page.getByRole('heading', { name: /API Key Created/i })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Done/i }).click();

    // Wait for key to appear in list
    await expect(page.getByText('Key To Revoke')).toBeVisible({ timeout: 5000 });

    // Find the key and click revoke button (Trash2 icon)
    const keyRow = page.locator('tr').filter({ hasText: 'Key To Revoke' });
    const revokeButton = keyRow.locator('button').filter({ has: page.locator('svg.lucide-trash-2') });
    await revokeButton.click();

    // Confirmation modal should appear
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Confirm revocation
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: /Revoke/i }).click();

    // Wait for success toast
    await expect(page.getByText(/revoked|success/i)).toBeVisible({ timeout: 10000 });

    // Key should now show as revoked (red badge)
    await expect(page.locator('span').filter({ hasText: /Revoked/i })).toBeVisible({ timeout: 5000 });
  });

  test('should open edit modal with pre-populated fields', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');
    await page.waitForLoadState('networkidle');

    // Find the original "Test Key Default" row (exclude the "(rotated)" copy if rotation ran earlier)
    const keyRow = page.locator('tr')
      .filter({ hasText: 'Test Key Default' })
      .filter({ hasNotText: '(rotated)' });
    await expect(keyRow).toBeVisible({ timeout: 10000 });

    const editButton = keyRow.locator('button').filter({ has: page.locator('svg.lucide-pencil') });
    await editButton.click();

    // Edit modal should open with "Edit" title (not "Create")
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('dialog').getByText(/Edit API Key/i)).toBeVisible();

    // Name field should be pre-populated with the current key name
    const nameInput = page.getByRole('dialog').locator('input[type="text"]').first();
    await expect(nameInput).toHaveValue('Test Key Default');

    // Close without saving
    await page.getByRole('dialog').getByRole('button', { name: /Cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });
  });

  test('should edit API key name', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    // Create a dedicated key for editing
    await page.getByRole('button', { name: /Create/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    await fillKeyName(page, 'Key To Edit');
    await page.getByRole('dialog').getByRole('button', { name: /Create/i }).click();
    await expect(page.getByRole('heading', { name: /API Key Created/i })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Done/i }).click();
    await expect(page.getByText('Key To Edit')).toBeVisible({ timeout: 5000 });

    // Click edit on the newly created key
    const keyRow = page.locator('tr').filter({ hasText: 'Key To Edit' });
    const editButton = keyRow.locator('button').filter({ has: page.locator('svg.lucide-pencil') });
    await editButton.click();

    // Clear name and type new one
    const nameInput = page.getByRole('dialog').locator('input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Key To Edit (renamed)');

    // Save
    await page.getByRole('dialog').getByRole('button', { name: /Save/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

    // Updated name should be visible in table, old name gone
    await expect(page.getByText('Key To Edit (renamed)')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('tr').filter({ hasText: 'Key To Edit' }).filter({ hasNot: page.getByText('renamed') })).not.toBeVisible();
  });

  test('should show correct status badges', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    // Wait for table
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Should have Active keys
    const activeCount = await page.locator('span').filter({ hasText: /^Active$/ }).count();
    expect(activeCount).toBeGreaterThan(0);

    // Should have Revoked key - from previous test
    const revokedCount = await page.locator('span').filter({ hasText: /^Revoked$/ }).count();
    expect(revokedCount).toBeGreaterThan(0);
  });

  test('should access API keys page directly', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/api-keys');

    // Should be on API keys page with title
    await expect(page).toHaveURL(/\/dashboard\/api-keys/);
    await expect(page.locator('h1')).toContainText(/API Keys/i, { timeout: 10000 });

    // Page loaded successfully - should have Create button
    await expect(page.getByRole('button', { name: /Create/i })).toBeVisible({ timeout: 5000 });
  });
});
