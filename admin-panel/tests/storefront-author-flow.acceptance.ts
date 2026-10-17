/** Seller draft navigation and publication flow. @see StorefrontEditor.tsx */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { createTestAdmin, setAuthSession } from './helpers/admin-auth';
import { getTestDatabaseContainer } from './helpers/database-container';
import { acceptAllCookies } from './helpers/consent';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';

const literal = (value: unknown) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
test('seller saves, previews, publishes and restores a storefront', async ({ page, context }) => {
  test.setTimeout(180000);
  const container = getTestDatabaseContainer();
  if (container === 'supabase_db_sellf') throw new Error('Use a disposable local stack for author acceptance');
  const sql = (input: string) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' }).trim();
  const original = JSON.parse(sql('SELECT to_jsonb(c) FROM storefront_config c'));
  const history = JSON.parse(sql('SELECT coalesce(jsonb_agg(to_jsonb(h)),\'[]\') FROM storefront_config_history h'));
  const admin = await createTestAdmin('storefront-author');
  try {
    sql(`UPDATE storefront_config SET draft=NULL,published=${literal(DEFAULT_CONFIG)}; UPDATE storefront_config_history SET draft=NULL,published=${literal(DEFAULT_CONFIG)} WHERE revision=${original.revision};`);
    await setAuthSession(page, admin.email, admin.password);
    await acceptAllCookies(page);
    await page.goto('/dashboard/templates');
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled();
    await page.getByLabel('Layout style', { exact: true }).selectOption('detail-cards');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.locator('[data-editor-savebar]')).toContainText('All changes saved');
    const revision = original.revision + 1;
    const popup = context.waitForEvent('page');
    await page.getByRole('link', { name: 'Preview', exact: true }).click();
    const preview = await popup;
    await expect(preview.locator('section[data-density]')).toBeVisible();
    await expect(preview.locator('section[data-density]')).not.toHaveClass(/defaultGroups/);
    await preview.close();
    for (const locale of ['en', 'pl']) {
      await page.goto(`${locale === 'pl' ? '/pl' : ''}/dashboard/templates`);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(page.getByRole('link', { name: locale === 'pl' ? 'Historia i publikacja' : 'History and publishing', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `/private/tmp/sellf-fixtpl-editor-${locale}-${width}.png`, fullPage: true, style: 'nextjs-portal { display: none }' });
      }
      await page.getByRole('button', { name: locale === 'pl' ? 'Wygląd' : 'Appearance', exact: true }).click();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: `/private/tmp/sellf-fixtpl-appearance-${locale}-${width}.png`, fullPage: true, style: 'nextjs-portal { display: none }' });
      }
    }
    await page.getByRole('link', { name: 'Historia i publikacja', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Historia sklepu');
    await page.getByRole('button', { name: 'Opublikuj tę wersję', exact: true }).first().click();
    await expect(page.getByRole('status')).toContainText(String(revision + 1));
    const store = await context.newPage();
    await store.goto('/store');
    await expect(store.locator('section[data-density]')).toBeVisible();
    await expect(store.locator('section[data-density]')).not.toHaveClass(/defaultGroups/);
    await page.getByRole('button', { name: 'Przywróć tę wersję', exact: true }).last().click();
    await expect(page.getByRole('status')).toContainText(String(revision + 2));
    await store.reload();
    await expect(store.locator('section[data-density]')).toHaveClass(/defaultGroups/);
    await store.close();
    await page.getByRole('link', { name: /edytor/i }).click();
    await expect(page.getByRole('heading', { name: 'Szablony sklepu' })).toBeVisible();
  } finally {
    sql(`BEGIN; UPDATE storefront_config c SET revision=b.revision,draft=b.draft,published=b.published,updated_at=b.updated_at,updated_by=b.updated_by FROM jsonb_populate_record(NULL::storefront_config,${literal(original)}) b WHERE c.id=true;
      DELETE FROM storefront_config_history; INSERT INTO storefront_config_history SELECT * FROM jsonb_populate_recordset(NULL::storefront_config_history,${literal(history)});
      DELETE FROM audit_log WHERE table_name='storefront_config' AND (new_values->>'revision')::bigint>${original.revision}; COMMIT;`);
    await admin.cleanup();
  }
});
