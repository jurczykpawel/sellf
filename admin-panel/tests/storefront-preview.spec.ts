/** Private session preview and history acceptance. Requires the exclusive local DB slot. */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { checkAccessibility } from './helpers/axe';
import { D_LOCALIZED_CONFIG, DEFAULT_CONFIG } from '../src/lib/storefront-templates/fixtures';
const sql = (input: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_sellf', 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' }).trim();
const literal = (value: unknown) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const stateQuery = `SELECT jsonb_build_array((SELECT to_jsonb(c) FROM storefront_config c),(SELECT jsonb_agg(to_jsonb(h) ORDER BY revision) FROM storefront_config_history h),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE table_name='storefront_config'),(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM products p),(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'')) FROM user_product_access a));`;
test('private preview matrix and history rollback', async ({ page, browser }) => {
  test.setTimeout(180000);
  const before = sql(stateQuery); const [original] = JSON.parse(before);
  const admin = await createTestAdmin('template-preview');
  const member = await createTestUser('template-preview-member');
  const userId = sql(`SELECT id FROM auth.users WHERE email='${admin.email}';`);
  try {
    await setAuthSession(page, admin.email, admin.password);
    await acceptAllCookies(page);
    const drafted = await supabaseAdmin.rpc('mutate_storefront_config', { expected_revision: original.revision, operation: 'draft', validated_config: D_LOCALIZED_CONFIG, actor_user_id: userId, actor_method: 'session' });
    expect(drafted.error).toBeNull(); expect(drafted.data).toMatchObject({ success: true });
    const revision = original.revision + 1;
    const url = `/admin/templates/preview?revision=${revision}&locale=en&fixture=standard`;
    const requests: string[] = []; page.on('request', request => requests.push(request.url()));
    for (const locale of ['en', 'pl']) for (const mode of ['light', 'dark'] as const) for (const fixture of ['standard', 'empty', 'long', 'unavailable', 'published-products']) {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
      const response = await page.goto(`/admin/templates/preview?revision=${revision}&locale=${locale}&fixture=${fixture}`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['cache-control']).toBe('private, no-store');
      expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
      expect(response?.headers()['content-security-policy']).toContain("default-src 'none'");
      expect(Date.parse(response!.headers()['x-preview-expires-at']) - Date.now()).toBeLessThanOrEqual(600000);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('[data-template]')).toHaveAttribute('data-template', 'd');
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveText(locale === 'pl' ? 'Zbuduj swój pierwszy automatyczny raport' : 'Build your first automated report');
      expect(await page.locator('script,form,a[href],button:not([disabled]),input:not([disabled]),select:not([disabled])').count()).toBe(0);
      await expect(page.locator('.sf-public-theme')).toHaveCSS('font-family', /Geist/i);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => { const family = getComputedStyle(document.querySelector('.sf-public-theme')!).fontFamily.split(',')[0]; return document.fonts.check(`16px ${family}`); })).toBe(true);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (fixture === 'standard' && (width === 390 || width === 1440)) await page.screenshot({ path: `/tmp/t1-19-preview-${locale}-${mode}-${width}.png`, fullPage: true });
      }
      await page.evaluate(() => { document.body.style.zoom = '2'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => { document.body.style.zoom = ''; });
      if (fixture === 'standard') {
        await checkAccessibility(page);
        const summary = page.locator('summary').first(); await summary.focus(); await summary.press('Enter');
        await expect(summary.locator('..')).toHaveAttribute('open', '');
      }
    }
    expect(requests.filter(url => /stripe|checkout|grant|experiment|\/api\/(?!storefront\/preview-font)/i.test(url))).toEqual([]);
    const anonymous = await browser.newContext();
    expect([307, 403]).toContain((await anonymous.request.get(url, { maxRedirects: 0 })).status()); await anonymous.close();
    const memberPage = await browser.newPage(); await setAuthSession(memberPage, member.email, member.password);
    expect((await memberPage.goto(url))?.status()).toBe(403); await memberPage.close();
    expect((await page.request.get(url.replace(`revision=${revision}`, 'revision=9007199254740992'))).status()).toBe(422);
    expect((await page.request.get(url.replace('fixture=standard', 'fixture=absent'))).status()).toBe(404);
    for (const locale of ['en', 'pl']) {
      await page.goto(`${locale === 'pl' ? '/pl' : ''}/admin/templates/history`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(locale === 'pl' ? 'Historia sklepu' : 'Storefront history');
      await expect(page.getByRole('link', { name: locale === 'pl' ? 'Otwórz podgląd' : 'Open preview', exact: true })).toBeVisible();
      await expect(page.getByText(locale === 'pl' ? 'Opublikowana teraz' : 'Published now', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: locale === 'pl' ? 'Opublikuj tę wersję' : 'Publish this version', exact: true })).toBeVisible();
      expect(await page.locator('time').first().textContent()).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
      await checkAccessibility(page);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `/tmp/t1-19-history-${locale}-${width}.png`, fullPage: true, style: "nextjs-portal { display: none }" });
      }
    }
    await page.goto('/en/admin/templates/history');
    await page.getByRole('button', { name: 'Compare', exact: true }).last().click();
    await expect(page.getByText('Default → Process storefront', { exact: true })).toBeVisible();
    const draftDefault = await supabaseAdmin.rpc('mutate_storefront_config', { expected_revision: revision, operation: 'draft', validated_config: DEFAULT_CONFIG, actor_user_id: userId, actor_method: 'session' });
    expect(draftDefault.data).toMatchObject({ success: true });
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.getByText(`· #${revision + 1}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Publish this version', exact: true }).first().click();
    await expect(page.getByRole('status')).toContainText(`Published as revision ${revision + 2}`);
    expect((await page.request.get(url)).status()).toBe(409);
    await expect(page.getByText('Published now', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore this version', exact: true })).toBeVisible();
    for (const locale of ['en', 'pl']) {
      await page.goto(`/${locale}/admin/templates/history`);
      await expect(page.getByText(`· #${revision + 2}`, { exact: true })).toBeVisible();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: `/tmp/t1-19-history-${locale}-${width}.png`, fullPage: true, style: 'nextjs-portal { display: none }' });
      }
    }
    await page.goto('/en/admin/templates/history');
    await expect(page.getByText(`· #${revision + 2}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Publish this version', exact: true }).last().click();
    await expect(page.getByRole('alert').filter({ hasText: 'Your current plan' })).toBeVisible();
    expect(sql('SELECT revision FROM storefront_config;')).toBe(String(revision + 2));
    await page.getByRole('button', { name: 'Publish this version', exact: true }).first().click();
    await expect(page.getByRole('status')).toContainText(`Published as revision ${revision + 4}`);
    await page.getByRole('button', { name: 'Restore this version', exact: true }).last().click();
    await expect(page.getByRole('status')).toContainText(`Published as revision ${revision + 5}`);
    expect(sql(`SELECT restored_from FROM storefront_config_history WHERE revision=${revision + 5};`)).toBe(String(original.revision));
  } finally {
    sql(`BEGIN;
      UPDATE storefront_config c SET revision=b.revision,draft=b.draft,published=b.published,updated_at=b.updated_at,updated_by=b.updated_by FROM jsonb_populate_record(NULL::storefront_config,${literal(original)}) b WHERE c.id=true;
      DELETE FROM storefront_config_history WHERE revision>${original.revision};
      DELETE FROM audit_log WHERE table_name='storefront_config' AND (new_values->>'revision')::bigint>${original.revision};
      DELETE FROM application_rate_limits WHERE identifier IN ('user:${userId}','user:${member.userId}');
      COMMIT;`);
    await admin.cleanup(); await member.cleanup();
    expect(sql(stateQuery)).toBe(before);
  }
});
