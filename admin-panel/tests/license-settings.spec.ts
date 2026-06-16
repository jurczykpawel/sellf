import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { setAuthSession } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('License Settings', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  const password = 'password123';

  async function loginAsAdmin(page: Page): Promise<void> {
    await acceptAllCookies(page);
    await page.goto('/');
    await setAuthSession(page, adminEmail, password);
  }

  async function gotoSystemSettings(page: Page): Promise<void> {
    await page.goto('/pl/dashboard/settings');
    // License management moved to its own "Licencja" tab (out of "System").
    await page.getByRole('button', { name: /^Licencja$/i }).click();
    await page.waitForSelector('h2:text-matches("Sellf License|Licencja Sellf", "i")');
  }

  test.beforeAll(async () => {
    adminEmail = `test-license-admin-${Date.now()}@example.com`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    await supabaseAdmin.from('admin_users').insert({ user_id: data.user.id });
    await supabaseAdmin.from('integrations_config').upsert({
      id: 1,
      sellf_license: null,
      updated_at: new Date().toISOString(),
    });
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('integrations_config').update({ sellf_license: null }).eq('id', 1);
    const { data } = await supabaseAdmin.auth.admin.listUsers();
    const user = data.users.find((candidate) => candidate.email === adminEmail);
    if (user) await supabaseAdmin.auth.admin.deleteUser(user.id);
  });

  test('shows the product-token input', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);
    await expect(page.locator('input[placeholder="payload.podpis"]')).toBeVisible();
    await expect(page.getByText(/podpisany token licencji produktowej/i)).toBeVisible();
  });

  test('shows a format error for a malformed token', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);
    const input = page.locator('input[placeholder="payload.podpis"]');
    await input.fill('not-a-product-token');
    await expect(page.getByText(/Nieprawidłowy format licencji/i)).toBeVisible();
  });

  test('rejects a structurally valid token that cannot be verified', async ({ page }) => {
    await loginAsAdmin(page);
    await gotoSystemSettings(page);
    const input = page.locator('input[placeholder="payload.podpis"]');
    await input.fill('payload.signature');
    await page.getByRole('button', { name: /Zapisz licencję/i }).click();
    await expect(page.getByRole('main').getByText(/License validation failed/i)).toBeVisible();
  });

  test('clears a stored token', async ({ page }) => {
    await supabaseAdmin.from('integrations_config').update({ sellf_license: 'payload.signature' }).eq('id', 1);
    await loginAsAdmin(page);
    await gotoSystemSettings(page);
    const input = page.locator('input[placeholder="payload.podpis"]');
    await expect(input).toHaveValue('payload.signature');
    await input.clear();
    await page.getByRole('button', { name: /Zapisz licencję/i }).click();
    await expect.poll(async () => {
      const { data } = await supabaseAdmin.from('integrations_config').select('sellf_license').eq('id', 1).single();
      return data?.sellf_license;
    }).toBeNull();
  });
});
