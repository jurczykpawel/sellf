/** Scoped template API and header-authenticated private preview acceptance. */
import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_CONFIG, D_LOCALIZED_CONFIG } from '../src/lib/storefront-templates/fixtures';
import { getTestDatabaseContainer } from './helpers/database-container';
import { insertTestApiKey } from './helpers/api-key';

test('template lifecycle with independent keys and an empty browser session', async ({ page, request, baseURL }) => {
  test.setTimeout(180000);
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(getTestDatabaseContainer()).not.toBe('supabase_db_sellf');
  const db = createClient(apiUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const owner = await db.from('admin_users').select('id').eq('user_id', 'dddddddd-0000-4000-a000-000000000000').single();
  expect(owner.error).toBeNull();
  const keys: string[] = [];
  const key = async (scopes: string[]) => {
    const value = `sf_test_${randomBytes(32).toString('hex')}`;
    const inserted = await insertTestApiKey(db, value, { name: 'Template HTTP acceptance', admin_user_id: owner.data!.id, scopes, rate_limit_per_minute: 1000 });
    keys.push(inserted.data!.id); return value;
  };
  try {
    const read = await key(['templates:read']); const write = await key(['templates:write']);
    const activate = await key(['templates:activate']); const product = await key(['products:write']);
    const call = async (path: string, credential: string, data?: unknown, method = 'POST') => {
      const response = await request.fetch(`/api/v1/templates/${path}`, { method: data === undefined ? 'GET' : method, headers: { authorization: `Bearer ${credential}` }, ...(data !== undefined ? { data } : {}) });
      return { status: response.status(), data: await response.json(), headers: response.headers() };
    };
    expect((await request.get('/api/v1/templates/config')).status()).toBe(401);
    for (const credential of [write, activate, product]) expect((await call('config', credential)).status).toBe(403);
    const initial = await call('config', read); expect(initial.status).toBe(200); let revision = initial.data.revision;
    const capabilities = await call('capabilities', read); expect(capabilities.data.limits.requestBytes).toBe(131072);
    const raw = JSON.stringify(DEFAULT_CONFIG);
    const configAtLimit = raw.slice(0, -1) + ' '.repeat(102400 - Buffer.byteLength(raw)) + '}';
    for (const [body, status] of [
      ['{"config":' + configAtLimit + ',"mode":"draft"}', 200],
      ['{"config": ' + configAtLimit + ' ,"mode":"draft"}', 200],
      ['{"config":' + configAtLimit.slice(0, -1) + ' },"mode":"draft"}', 422],
      ['{"mode":"draft",' + ' '.repeat(131072 - Buffer.byteLength('{"mode":"draft","config":' + raw + '}')) + '"config":' + raw + '}', 200],
      [' '.repeat(131073), 422],
    ] as const) {
      const bounded = await request.post('/api/v1/templates/validate', { headers: { authorization: `Bearer ${read}`, 'content-type': 'application/json' }, data: body });
      expect(bounded.status()).toBe(status);
    }
    const encoding = await request.post('/api/v1/templates/validate', { headers: { authorization: `Bearer ${read}`, 'content-type': 'application/json' }, data: Buffer.from([0xff]) });
    expect(encoding.status()).toBe(422); expect(await encoding.json()).toMatchObject({ code: 'INVALID', validation: { errors: [{ code: 'SCHEMA' }] } });
    expect((await call('draft', read, { expectedRevision: revision, config: DEFAULT_CONFIG }, 'PUT')).status).toBe(403);
    expect((await call('publish', write, { expectedRevision: revision })).status).toBe(403);
    const before = await call('config', read);
    expect((await call('draft', write, { expectedRevision: revision, config: DEFAULT_CONFIG, actor: { userId: 'other' } }, 'PUT')).status).toBe(422);
    expect((await call('config', read)).data).toEqual(before.data);
    const baseline = await call('draft', write, { expectedRevision: revision, config: DEFAULT_CONFIG }, 'PUT');
    expect(baseline.status).toBe(200); revision++;
    const drafted = await call('draft', write, { expectedRevision: revision, config: D_LOCALIZED_CONFIG }, 'PUT');
    expect(drafted.status).toBe(200); revision++; expect(drafted.data.revision).toBe(revision);
    const validation = await call('validate', read, { config: D_LOCALIZED_CONFIG, mode: 'draft' });
    expect(validation.data.valid).toBe(true);
    const diff = await call('diff', read, { fromRevision: revision - 1, toRevision: revision });
    expect(diff.data.changes.length).toBeGreaterThan(0); expect(diff.data.validation).toBeDefined();
    expect((await call('preview', product, { revision, locale: 'en', fixture: 'standard' })).status).toBe(403);
    expect((await call('preview', read, { revision, locale: 'en', fixture: '../file' })).status).toBe(422);
    expect((await call('preview', read, { revision, locale: 'en', fixture: 'absent' })).status).toBe(404);
    expect((await call('preview', read, { revision: revision - 1, locale: 'en', fixture: 'standard' })).status).toBe(409);
    const outbound: string[] = []; page.on('request', req => { if (new URL(req.url()).origin !== new URL(baseURL!).origin) outbound.push(req.url()); });
    await page.route('**/*', route => {
      const req = route.request();
      if (new URL(req.url()).origin !== new URL(baseURL!).origin) return route.abort();
      return route.continue({ headers: { ...req.headers(), ...(req.isNavigationRequest() ? { authorization: `Bearer ${read}` } : {}) } });
    });
    expect(await page.context().cookies()).toEqual([]);
    let oldPath = '';
    for (const locale of ['en', 'pl']) {
      const preview = await call('preview', read, { revision, locale, fixture: 'standard' });
      expect(preview.status).toBe(200); expect(preview.data.validation.valid).toBe(true);
      expect(preview.data.previewPath).not.toContain(read); oldPath = preview.data.previewPath;
      expect((await request.get(oldPath)).status()).toBe(404);
      expect((await request.get(oldPath, { headers: { 'x-api-key': read } })).status()).toBe(200);
      expect((await request.get(oldPath, { headers: { authorization: `Bearer ${write}` } })).status()).toBe(404);
      for (const mode of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: mode });
        const response = await page.goto(oldPath);
        expect(response!.status()).toBe(200); expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
        expect(response!.headers()['content-security-policy']).toContain("default-src 'none'");
        expect(await response!.text()).not.toContain(read);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('[data-preview-inert]')).toHaveAttribute('inert', '');
        await expect(page.locator('h1')).toHaveText(locale === 'pl' ? 'Zbuduj swój pierwszy automatyczny raport' : 'Build your first automated report');
        expect(await page.evaluate(() => '__next_f' in window)).toBe(false);
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `/tmp/t1-22-${locale}-${mode}-${width}.png`, fullPage: true });
        }
      }
      const expired = new URL(oldPath, baseURL); expired.searchParams.set('issuedAt', String(Date.now() - 600001));
      await page.goto(expired.toString()); await expect(page.locator('[data-preview-inert]')).toHaveCount(0);
    }
    expect(outbound).toEqual([]); expect(await page.context().cookies()).toEqual([]);
    expect((await call('publish', activate, { expectedRevision: revision })).status).toBe(403);
    const normal = await call('draft', write, { expectedRevision: revision, config: DEFAULT_CONFIG }, 'PUT');
    expect(normal.status).toBe(200); revision++;
    const stale = await call('preview', read, { revision: revision - 1, locale: 'en', fixture: 'standard' });
    expect(stale).toMatchObject({ status: 409, data: { code: 'CONFLICT', currentRevision: revision } });
    await page.goto(oldPath); await expect(page.locator('[data-preview-inert]')).toHaveCount(0);
    const published = await call('publish', activate, { expectedRevision: revision }); expect(published.status).toBe(200); revision++;
    const conflict = await call('publish', activate, { expectedRevision: revision - 1 }); expect(conflict.data.currentRevision).toBe(revision);
    const rolled = await call('rollback', activate, { expectedRevision: revision, targetRevision: initial.data.revision }); expect(rolled.status).toBe(200); revision++;
    const reset = await call('reset', write, { expectedRevision: revision, templateId: 'default', field: 'settings.density' }); expect(reset.status).toBe(200);
    await db.from('api_keys').update({ is_active: false }).eq('id', keys[0]);
    expect((await call('config', read)).status).toBe(401);
    const audits = await db.from('audit_log').select('user_id,new_values').eq('table_name', 'storefront_config');
    expect(audits.error).toBeNull(); expect(JSON.stringify(audits.data)).not.toContain(write);
    expect(audits.data!.some(row => row.user_id === 'dddddddd-0000-4000-a000-000000000000')).toBe(true);
  } finally { await db.from('api_keys').delete().in('id', keys); }
});
