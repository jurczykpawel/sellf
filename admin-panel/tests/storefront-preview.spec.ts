import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';
/** Private session preview and history acceptance. Requires the exclusive local DB slot. */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { checkAccessibility } from './helpers/axe';
import { D_LOCALIZED_CONFIG, DEFAULT_CONFIG } from '../src/lib/storefront-templates/fixtures';
const sql = (input: string) => execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' }).trim();
const literal = (value: unknown) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const stateQuery = `SELECT jsonb_build_array((SELECT to_jsonb(c) FROM storefront_config c),(SELECT jsonb_agg(to_jsonb(h) ORDER BY revision) FROM storefront_config_history h),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE table_name='storefront_config'),(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM products p),(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'')) FROM user_product_access a));`;
test('private preview matrix and history rollback', async ({ page, browser }) => {
  test.setTimeout(180000);
  const before = sql(stateQuery); const [original, originalHistory] = JSON.parse(before);
  const admin = await createTestAdmin('template-preview');
  const member = await createTestUser('template-preview-member');
  const userId = sql(`SELECT id FROM auth.users WHERE email='${admin.email}';`);
  try {
    sql(`BEGIN; UPDATE storefront_config SET draft=NULL,published=${literal(DEFAULT_CONFIG)}; DELETE FROM storefront_config_history; INSERT INTO storefront_config_history(revision,operation,draft,published) VALUES (${original.revision},'publish',NULL,${literal(DEFAULT_CONFIG)}); COMMIT;`);
    await setAuthSession(page, admin.email, admin.password);
    await acceptAllCookies(page);
    const drafted = await supabaseAdmin.rpc('mutate_storefront_config', { expected_revision: original.revision, operation: 'draft', validated_config: D_LOCALIZED_CONFIG, actor_user_id: userId, actor_method: 'session' });
    expect(drafted.error).toBeNull(); expect(drafted.data).toMatchObject({ success: true });
    const revision = original.revision + 1;
    const url = `/template-preview/${revision}?locale=en&fixture=standard`;
    const requests: string[] = []; page.on('request', request => requests.push(request.url()));
    for (const locale of ['en', 'pl']) for (const mode of ['light', 'dark'] as const) for (const fixture of ['standard', 'empty', 'long', 'unavailable', 'published-products']) {
      await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
      const response = await page.goto(`/template-preview/${revision}?locale=${locale}&fixture=${fixture}`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['cache-control']).toMatch(process.env.T119_RELEASE ? /no-store/ : /no-store|no-cache, must-revalidate/);
      expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
      expect(response?.headers()['content-security-policy']).toContain("default-src 'none'");
      expect(Date.parse(response!.headers()['x-preview-expires-at']) - Date.now()).toBeLessThanOrEqual(600000);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('[data-template]')).toHaveAttribute('data-template', 'd');
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveText(locale === 'pl' ? 'Zbuduj swój pierwszy automatyczny raport' : 'Build your first automated report');
      await expect(page.locator('[data-preview-inert]')).toHaveAttribute('inert', '');
      expect(response?.headers()['content-security-policy']).not.toContain('script-src');
      expect(await page.evaluate(() => '__next_f' in window)).toBe(false);
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
        expect(await page.locator('[data-preview-inert] a[href]').count()).toBeGreaterThan(0);
      }
    }
    expect(requests.filter(url => /stripe|checkout|grant|experiment|\/api\/(?!storefront\/preview-font)/i.test(url))).toEqual([]);
    const anonymous = await browser.newContext();
    expect([307, 404]).toContain((await anonymous.request.get(url, { maxRedirects: 0 })).status()); await anonymous.close();
    const memberPage = await browser.newPage(); await setAuthSession(memberPage, member.email, member.password);
    expect((await memberPage.goto(url))?.status()).toBe(404); await memberPage.close();
    for (const invalid of [url.replace(`/${revision}?`, '/9007199254740992?'), url.replace('fixture=standard', 'fixture=absent'), `${url}&issuedAt=${Date.now() - 600001}`, `${url}&issuedAt=${Date.now() + 60000}`]) {
      const rejected = await page.request.get(invalid);
      expect(await rejected.text()).toContain('Preview unavailable');
      expect(await rejected.text()).not.toContain('data-preview-inert');
    }
    for (const locale of ['en', 'pl']) {
      await page.goto(`${locale === 'pl' ? '/pl' : ''}/admin/templates/history`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(locale === 'pl' ? 'Historia sklepu' : 'Storefront history');
      await expect(page.getByRole('link', { name: locale === 'pl' ? 'Otwórz podgląd' : 'Open preview', exact: true })).toBeVisible({ timeout: 15000 });
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
    expect(await (await page.request.get(url)).text()).toContain('Preview unavailable');
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
    // Keep a genuinely different current draft while comparing an older version.
    const keptDraft = await supabaseAdmin.rpc('mutate_storefront_config', { expected_revision: revision + 2, operation: 'draft', validated_config: D_LOCALIZED_CONFIG, actor_user_id: userId, actor_method: 'session' });
    expect(keptDraft.data).toMatchObject({ success: true });
    const preservedDraft = sql('SELECT row_to_json(c) FROM storefront_config c;');
    await page.goto('/en/admin/templates/history');
    await expect(page.getByText(`· #${revision + 3}`, { exact: true })).toBeVisible();
    const olderDraft = (target: number) => page.locator('li').filter({ has: page.getByText(`· #${target}`, { exact: true }) }).getByRole('button', { name: 'Publish this version', exact: true });
    await olderDraft(revision).click();
    await expect(page.getByRole('heading', { name: 'Replace your current draft?' })).toBeVisible();
    expect(sql('SELECT row_to_json(c) FROM storefront_config c;')).toBe(preservedDraft);
    await page.getByRole('button', { name: 'Replace draft and publish', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Your current plan' })).toBeVisible();
    expect(sql('SELECT row_to_json(c) FROM storefront_config c;')).toBe(preservedDraft);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await olderDraft(revision + 1).click();
    await expect(page.getByRole('heading', { name: 'Replace your current draft?' })).toBeVisible();
    await expect(page.getByText('Process storefront → Default', { exact: true })).toBeVisible();
    expect(sql('SELECT row_to_json(c) FROM storefront_config c;')).toBe(preservedDraft);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(sql('SELECT row_to_json(c) FROM storefront_config c;')).toBe(preservedDraft);
    await olderDraft(revision + 1).click();
    await page.getByRole('button', { name: 'Replace draft and publish', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(`Published as revision ${revision + 5}`);
    await page.getByRole('button', { name: 'Restore this version', exact: true }).last().click();
    await page.getByRole('button', { name: 'Confirm restore', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(`Published as revision ${revision + 6}`);
    expect(sql(`SELECT restored_from FROM storefront_config_history WHERE revision=${revision + 6};`)).toBe(String(original.revision));
  } finally {
    sql(`BEGIN;
      UPDATE storefront_config c SET revision=b.revision,draft=b.draft,published=b.published,updated_at=b.updated_at,updated_by=b.updated_by FROM jsonb_populate_record(NULL::storefront_config,${literal(original)}) b WHERE c.id=true;
      DELETE FROM storefront_config_history;
      INSERT INTO storefront_config_history SELECT * FROM jsonb_populate_recordset(NULL::storefront_config_history,${literal(originalHistory ?? [])});
      DELETE FROM audit_log WHERE table_name='storefront_config' AND (new_values->>'revision')::bigint>${original.revision};
      DELETE FROM application_rate_limits WHERE identifier IN ('user:${userId}','user:${member.userId}');
      COMMIT;`);
    await admin.cleanup(); await member.cleanup();
    expect(sql(stateQuery)).toBe(before);
  }
});
