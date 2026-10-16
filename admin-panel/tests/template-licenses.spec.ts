/** Private template key adapters and localized admin entry. */
import { createHash, randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
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
    const row = await db.from('api_keys').insert({ name: 'Template key acceptance', key_prefix: value.slice(0, 16), key_hash: createHash('sha256').update(value).digest('hex'), admin_user_id: owner.data!.id, scopes, rate_limit_per_minute: 1000 }).select('id').single();
    expect(row.error).toBeNull(); ids.push(row.data!.id); return value;
  };
  const read = await key(['templates:read']); const write = await key(['templates:write']);
  const activate = await key(['templates:activate']);
  const admin = await createTestAdmin('template-keys');
  const endpoint = '/api/v1/templates/licenses';
  const token = 'synthetic-private-template-key';
  const snapshot = await db.from('storefront_config').select('*').single();
  try {
    expect((await request.get(endpoint)).status()).toBe(401);
    for (const credential of [write, activate]) expect((await request.get(endpoint, { headers: { 'x-api-key': credential } })).status()).toBe(403);
    for (const credential of [read, activate]) expect((await request.post(endpoint, { headers: { 'x-api-key': credential }, data: { templateId: 'storefront-a', token } })).status()).toBe(403);
    const response = await request.post(endpoint, { headers: { 'x-api-key': write }, data: { templateId: 'storefront-a', token } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ templateId: 'storefront-a', state: 'unknown', verifiedAt: null });
    expect(response.headers()['cache-control']).toContain('no-store');
    expect((await request.post(endpoint, { headers: { 'x-api-key': write }, data: { templateId: 'storefront-a', token: 'x'.repeat(16384) } })).status()).toBe(422);
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
    await field.fill(token);
    const saved = page.waitForResponse(res => res.url().endsWith(endpoint) && res.request().method() === 'POST');
    await page.getByRole('button', { name: 'Zapisz klucz', exact: true }).click();
    expect((await saved).status()).toBe(200); await expect(field).toHaveValue('');
    await expect(page.getByRole('status').filter({ hasText: 'Klucz zapisany.' })).toBeVisible();
  } finally {
    await db.from('api_keys').delete().in('id', ids); await admin.cleanup();
  }
});
