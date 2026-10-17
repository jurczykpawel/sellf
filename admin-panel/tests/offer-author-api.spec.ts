/** Product offer HTTP authoring and private rendered preview acceptance. */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { CORE_TOKENS } from '@/lib/storefront-templates/public-theme';
import { getTestDatabaseContainer } from './helpers/database-container';

test('offer wrappers preserve product revisions and independent template scopes', async ({ page, request, baseURL }) => {
  test.setTimeout(180000);
  expect(getTestDatabaseContainer()).not.toBe('supabase_db_sellf');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const owner = await db.from('admin_users').select('id').eq('user_id', 'dddddddd-0000-4000-a000-000000000000').single();
  expect(owner.error).toBeNull();
  const keys: string[] = [], products: string[] = [];
  const key = async (scope: string) => {
    const value = `sf_test_${randomBytes(32).toString('hex')}`;
    const inserted = await db.from('api_keys').insert({ name: 'Offer HTTP acceptance', key_prefix: value.slice(0, 16), key_hash: createHash('sha256').update(value).digest('hex'), admin_user_id: owner.data!.id, scopes: [scope], rate_limit_per_minute: 1000 }).select('id').single();
    expect(inserted.error).toBeNull(); keys.push(inserted.data!.id); return value;
  };
  try {
    for (let i = 0; i < 2; i++) {
      const row = await db.from('products').insert({ name: `Offer workshop ${i}`, slug: `offer-api-${Date.now()}-${i}`, price: 149, currency: 'PLN', is_active: true, is_listed: true }).select('id').single();
      expect(row.error).toBeNull(); products.push(row.data!.id);
    }
    const [productId, otherId] = products;
    const read = await key('templates:read'), write = await key('templates:write'), activate = await key('templates:activate'), product = await key('products:write');
    const call = async (operation: string, credential: string, data?: unknown, id = productId) => {
      const response = await request.fetch(`/api/v1/products/${id}/offer/${operation}`, { method: operation === 'config' ? 'GET' : operation === 'draft' ? 'PUT' : 'POST', headers: { authorization: `Bearer ${credential}` }, ...(data === undefined ? {} : { data }) });
      return { status: response.status(), data: await response.json(), headers: response.headers() };
    };
    const candidate = JSON.parse(readFileSync('../skills/sellf-template-author/examples/offer.json', 'utf8'));
    expect((await request.get(`/api/v1/products/${productId}/offer/config`)).status()).toBe(401);
    for (const credential of [write, activate, product]) expect((await call('config', credential)).status).toBe(403);
    expect((await call('config', read)).data).toMatchObject({ revision: 0, draft: null, published: null });
    const oversized = await request.post(`/api/v1/products/${productId}/offer/validate`, { headers: { authorization: `Bearer ${read}` }, data: ' '.repeat(1048577) });
    expect(oversized.status()).toBe(422); expect(await oversized.json()).toMatchObject({ code: 'LIMIT' });
    expect((await call('draft', read, { expectedRevision: 0, config: candidate })).status).toBe(403);
    expect((await call('draft', write, { expectedRevision: 0, config: candidate, productId: otherId })).status).toBe(422);
    expect((await call('draft', write, { expectedRevision: 0, config: candidate })).data).toMatchObject({ revision: 1, validation: { valid: true } });
    expect((await call('config', read, undefined, otherId)).data).toMatchObject({ revision: 0, draft: null });
    expect((await call('validate', read, { config: candidate, mode: 'publish' })).data.valid).toBe(true);
    expect((await call('diff', read, { fromRevision: 0, toRevision: 1 })).data.changes.length).toBeGreaterThan(0);
    expect((await call('history', read, { limit: 10 })).data.history.map((row: { revision: number }) => row.revision)).toEqual([1, 0]);
    expect((await call('preview', read, { revision: 0, locale: 'en', fixture: 'published-products' })).status).toBe(409);
    expect((await call('preview', read, { revision: 1, locale: 'en', fixture: '../file' })).status).toBe(422);
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== new URL(baseURL!).origin) return route.abort();
      if (req.isNavigationRequest() && url.pathname.startsWith('/template-preview/')) return route.continue({ headers: { ...req.headers(), authorization: `Bearer ${read}` } });
      if (url.pathname.startsWith('/_next/static/') && ['stylesheet', 'font'].includes(req.resourceType())) return route.continue();
      return route.abort();
    });
    expect(await page.context().cookies()).toEqual([]);
    let oldPath = '';
    for (const locale of ['en', 'pl']) {
      const preview = await call('preview', read, { revision: 1, locale, fixture: 'published-products' });
      expect(preview.status).toBe(200);
      expect(preview.headers['cache-control']).toBe('private, no-store');
      expect(preview.headers['x-robots-tag']).toBe('noindex, nofollow');
      oldPath = preview.data.previewPath;
      expect(oldPath).toContain(`productId=${productId}`); expect(oldPath).not.toContain(read);
      expect((await request.get(oldPath)).status()).toBe(404);
      expect((await request.get(oldPath, { headers: { authorization: `Bearer ${product}` } })).status()).toBe(404);
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        const response = await page.goto(oldPath);
        expect(response!.headers()['cache-control']).toContain('no-store');
        expect(response!.headers()['x-robots-tag']).toBe('noindex, nofollow');
        expect(response!.headers()['content-security-policy']).toContain("default-src 'none'");
        expect(await response!.text()).not.toContain(read);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('[data-preview-inert]')).toHaveAttribute('inert', '');
        await expect(page.locator('h1')).toHaveText(locale === 'pl' ? candidate.content['offer.hero'].pl.heading : candidate.content['offer.hero'].en.heading);
        expect(await page.evaluate(() => '__next_f' in window)).toBe(false);
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: `/tmp/t2-12-${locale}-${scheme}-${width}.png`, fullPage: true });
        }
      }
    }
    expect(await page.context().cookies()).toEqual([]);
    const expired = new URL(oldPath, baseURL); expired.searchParams.set('issuedAt', String(Date.now() - 600001));
    await page.goto(expired.href); await expect(page.locator('[data-preview-inert]')).toHaveCount(0);
    for (const credential of [read, write, product]) expect((await call('publish', credential, { expectedRevision: 1 })).status).toBe(403);
    expect((await call('publish', activate, { expectedRevision: 0 }))).toMatchObject({ status: 409, data: { currentRevision: 1 } });
    expect((await call('publish', activate, { expectedRevision: 1 })).data.revision).toBe(2);
    expect((await call('config', read)).data).toMatchObject({ revision: 2, published: candidate, draft: null });
    await page.goto(oldPath); await expect(page.locator('[data-preview-inert]')).toHaveCount(0);
    expect((await call('rollback', activate, { expectedRevision: 2, targetRevision: 1 }, otherId)).status).toBe(409);
    expect((await call('rollback', activate, { expectedRevision: 0, targetRevision: 1 }, otherId)).status).toBe(404);
    expect((await call('rollback', activate, { expectedRevision: 2, targetRevision: 0 })).data.revision).toBe(3);
    expect((await call('config', read)).data.published).toBeNull();
    expect((await call('reset', write, { expectedRevision: 3, field: 'density' })).data.revision).toBe(4);
    const customAppearance = { ...candidate, tokens: CORE_TOKENS };
    expect((await call('draft', write, { expectedRevision: 4, config: customAppearance })).data.revision).toBe(5);
    expect((await call('validate', read, { config: customAppearance, mode: 'publish' })).data).toMatchObject({ valid: false, errors: expect.arrayContaining([expect.objectContaining({ code: 'ENTITLEMENT' })]) });
    expect((await call('publish', activate, { expectedRevision: 5 })).status).toBe(403);
    expect((await call('config', read)).data).toMatchObject({ revision: 5, published: null });
  } finally {
    await db.from('products').delete().in('id', products);
    await db.from('api_keys').delete().in('id', keys);
  }
});
