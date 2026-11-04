/** Private template key adapters and localized admin entry. */
import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { insertTestApiKey } from './helpers/api-key';
import { createTestAdmin, setAuthSession } from './helpers/admin-auth';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
test('independent license scopes, bounded inputs and EN/PL key entry', async ({ page, request }) => {
  test.setTimeout(180000);
  expect(['localhost', '127.0.0.1']).toContain(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname);
  const owner = await db.from('admin_users').select('id').eq('user_id', 'dddddddd-0000-4000-a000-000000000000').single();
  expect(owner.error).toBeNull();
  const ids: string[] = [];
  const key = async (scopes: string[]) => {
    const value = `sf_test_${randomBytes(32).toString('hex')}`;
    const row = await insertTestApiKey(db, value, { name: 'Template key acceptance', admin_user_id: owner.data!.id, scopes, rate_limit_per_minute: 1000 });
    ids.push(row.data!.id); return value;
  };
  const admin = await createTestAdmin('template-keys');
  const endpoint = '/api/v1/templates/licenses';
  // A well-formed but unsigned key: accepted for storage, verified only in the background.
  const claims = (templateId: string) => Buffer.from(JSON.stringify({ v: 1, kid: 'k', product: 'p', email: 'buyer@example.test', order: 'synthetic-order', tier: 'standard', iat: 1, exp: null, templateId, domain: 'shop.example.test', edition: 'standard' })).toString('base64url');
  const token = `${claims('storefront-a')}.c3ludGhldGlj`;
  const snapshot = await db.from('storefront_config').select('*').single();
  try {
    const read = await key(['templates:read']); const write = await key(['templates:write']);
    const activate = await key(['templates:activate']);
    expect((await request.get(endpoint)).status()).toBe(401);
    for (const credential of [write, activate]) expect((await request.get(endpoint, { headers: { 'x-api-key': credential } })).status()).toBe(403);
    for (const credential of [read, activate]) expect((await request.post(endpoint, { headers: { 'x-api-key': credential }, data: { templateId: 'storefront-a', token } })).status()).toBe(403);
    const response = await request.post(endpoint, { headers: { 'x-api-key': write }, data: { templateId: 'storefront-a', token } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ templateId: 'storefront-a', state: 'unknown', verifiedAt: null });
    expect(response.headers()['cache-control']).toContain('no-store');
    expect((await request.post(endpoint, { headers: { 'x-api-key': write }, data: { templateId: 'storefront-a', token: 'x'.repeat(16384) } })).status()).toBe(422);
    // W148-6: a typo or another template's key never replaces the stored key.
    for (const bad of ['synthetic-private-template-key', `${claims('storefront-b')}.c3ludGhldGlj`]) expect((await request.post(endpoint, { headers: { 'x-api-key': write }, data: { templateId: 'storefront-a', token: bad } })).status()).toBe(422);
    const statuses = await request.get(endpoint, { headers: { authorization: `Bearer ${read}` } });
    expect(statuses.status()).toBe(200); expect(await statuses.text()).not.toContain(token);
    expect((await db.from('storefront_config').select('*').single()).data).toEqual(snapshot.data);
    await setAuthSession(page, admin.email, admin.password);
    for (const locale of ['en', 'pl']) {
      await page.goto(`/${locale}/dashboard/templates`);
      const title = locale === 'en' ? 'Premium template keys' : 'Klucze szablonów premium';
      await page.getByText(title, { exact: true }).click();
      await expect(page.getByLabel(locale === 'en' ? 'Purchase key' : 'Klucz zakupu', { exact: true })).toHaveAttribute('type', 'password');
      for (const mode of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: mode });
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1100 });
          await page.getByText(title, { exact: true }).scrollIntoViewIfNeeded();
          await expect(page.locator('body')).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `/tmp/t2-3-${locale}-${mode === 'dark' ? 'dark-' : ''}${width}.png`, fullPage: true });
        }
      }
    }
    const field = page.getByLabel('Klucz zakupu', { exact: true });
    let posts = 0; page.on('request', req => { if (req.url().endsWith(endpoint) && req.method() === 'POST') posts++; });
    await field.fill('abc');
    await page.getByRole('button', { name: 'Zapisz klucz', exact: true }).click();
    await expect(page.getByText(/To nie wygląda na klucz zakupu szablonu/)).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await field.fill(token);
    await page.getByRole('button', { name: 'Zapisz klucz', exact: true }).click();
    await expect(page.getByText(/Dla tego szablonu jest już zapisany klucz/)).toBeVisible();
    expect(posts).toBe(0);
    const saved = page.waitForResponse(res => res.url().endsWith(endpoint) && res.request().method() === 'POST');
    await page.getByRole('button', { name: 'Zastąp klucz', exact: true }).click();
    expect((await saved).status()).toBe(200); await expect(field).toHaveValue('');
    await expect(page.getByRole('status').filter({ hasText: 'Klucz zapisany.' })).toBeVisible();
  } finally {
    await db.from('api_keys').delete().in('id', ids); await admin.cleanup();
  }
});
