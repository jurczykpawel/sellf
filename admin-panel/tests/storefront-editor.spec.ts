import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';
/** Admin composition editor acceptance. @see storefront-config.md */
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { createTestAdmin, setAuthSession } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
import type { StorefrontConfig } from '@/lib/storefront-templates/schemas';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
test.describe.configure({ mode: 'serial' });
let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let productName: string;
let container: string;
let original: { revision: number };
let originalJson: string;
const sql = (query: string): string => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
const literal = (json: string): string => "'" + json.replaceAll("'", "''") + "'::jsonb";
test.beforeAll(async () => {
  container = getTestDatabaseContainer();
  originalJson = sql('SELECT to_jsonb(c) FROM public.storefront_config c');
  original = JSON.parse(originalJson);
  sql(`UPDATE public.storefront_config SET draft=NULL,published=${literal(JSON.stringify(DEFAULT_CONFIG))}`);
  admin = await createTestAdmin('composition-editor');
  const { data, error } = await db.from('products').select('id,name').eq('is_active', true).eq('is_listed', true).limit(1).single();
  if (error) throw error;
  productName = data.name;
});
test.afterAll(async () => {
  if (original) {
    sql(`BEGIN;
      UPDATE public.storefront_config c SET revision=b.revision,draft=b.draft,published=b.published,updated_at=b.updated_at,updated_by=b.updated_by
        FROM jsonb_populate_record(NULL::public.storefront_config,${literal(originalJson)}) b WHERE c.id=true;
      DELETE FROM public.storefront_config_history WHERE revision>${original.revision};
      DELETE FROM public.audit_log WHERE table_name='storefront_config' AND (new_values->>'revision')::bigint>${original.revision};
      COMMIT;`);
    expect(sql('SELECT to_jsonb(c) FROM public.storefront_config c')).toBe(originalJson);
  }
  await admin?.cleanup();
});

test('reads, saves, reloads, retains inactive values and prevents a stale tab from overwriting @J79', async ({ page, context }) => {
  await acceptAllCookies(page);
  await setAuthSession(page, admin.email, admin.password);
  await page.goto('/en/dashboard/templates');
  const editor = page.locator('[data-storefront-editor]');
  await expect(editor.getByRole('heading', { name: 'Storefront templates' })).toBeVisible();
  await editor.getByLabel('Template', { exact: true }).selectOption('d');
  await editor.getByRole('searchbox', { name: 'Featured offer · Search by name…' }).fill(productName);
  await editor.getByRole('button', { name: `Add ${productName}`, exact: true }).click();
  await editor.getByRole('button', { name: 'Final invitation', exact: true }).click();
  await editor.getByRole('searchbox', { name: 'Closing offer · Search by name…' }).fill(productName);
  await editor.getByRole('button', { name: `Add ${productName}`, exact: true }).click();
  await editor.getByRole('button', { name: 'Hero', exact: true }).click();
  await editor.getByLabel('Hero · EN · Heading', { exact: true }).fill('Żółć — '+ 'Long seller copy '.repeat(8));
  await editor.getByLabel('Hero · EN · Steps', { exact: false }).fill('First step\nSecond step');
  await editor.getByRole('button', { name: 'Reorder Hero', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await editor.getByRole('checkbox', { name: 'Show How it works', exact: true }).uncheck();
  await editor.getByLabel('Layout style', { exact: true }).selectOption('simple');
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('All changes saved');
  const saved = await db.from('storefront_config').select('revision,draft,published').single();
  expect(saved.error).toBeNull();
  const draft = saved.data!.draft as unknown as StorefrontConfig;
  expect(draft.templateId).toBe('d');
  expect(draft.overridesByTemplate.d!.order![0]).toBe('tasks');
  expect(draft.overridesByTemplate.d!.sections?.tasks?.visibility).toBe('hidden');
  expect(draft.overridesByTemplate.d!.sections?.hero?.variant).toBe('simple');
  expect((saved.data!.published as unknown as StorefrontConfig).templateId).toBe('default');
  await page.reload();
  await expect(editor.getByRole('button', { name: `Remove ${productName}`, exact: true })).toBeVisible();
  await expect(editor.getByLabel('Hero · EN · Heading', { exact: true })).toHaveValue(draft.content['home.hero']!.en!.kind === 'hero' ? draft.content['home.hero']!.en!.heading : '');
  await editor.getByLabel('Template', { exact: true }).selectOption('default');
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('All changes saved');
  await page.reload();
  await editor.getByLabel('Template', { exact: true }).selectOption('d');
  await expect(editor.getByRole('button', { name: `Remove ${productName}`, exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('All changes saved');
  const other = await context.newPage();
  await other.goto('/en/dashboard/templates');
  await expect(other.getByRole('button', { name: `Remove ${productName}`, exact: true })).toBeVisible();
  const firstTabHeading = 'First tab saved — ' + 'Długi tekst '.repeat(10);
  await editor.getByLabel('Hero · EN · Heading', { exact: true }).fill(firstTabHeading);
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('All changes saved');
  await other.getByLabel('Hero · EN · Heading', { exact: true }).fill('Second tab local');
  await other.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(other.locator('[data-storefront-editor]').getByRole('alert')).toContainText('newer revision');
  await expect(other.getByLabel('Hero · EN · Heading', { exact: true })).toHaveValue('Second tab local');
  await expect(other.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await other.getByRole('button', { name: 'Reload saved draft', exact: true }).click();
  await other.getByRole('button', { name: 'Discard edits and reload', exact: true }).click();
  await expect(other.getByLabel('Hero · EN · Heading', { exact: true })).toHaveValue(firstTabHeading);
  await other.close();
});

for (const locale of ['en', 'pl']) for (const mode of ['light', 'dark'] as const) {
  test(`${locale} ${mode}: keyboard, mobile, reduced motion, origins and zoom`, async ({ page }) => {
    await acceptAllCookies(page);
    await setAuthSession(page, admin.email, admin.password);
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
    await page.addInitScript(theme => localStorage.setItem('sf_theme', theme), mode);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/dashboard/templates`);
    const editor = page.locator('[data-storefront-editor]');
    await expect(editor.getByRole('heading', { level: 1 })).toHaveText(locale === 'pl' ? 'Szablony sklepu' : 'Storefront templates');
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /^(?!.*dark)/);
    const selector = editor.getByLabel(locale === 'pl' ? 'Szablon' : 'Template', { exact: true });
    await selector.focus();
    await page.keyboard.press('Tab');
    expect(await editor.evaluate(el => el.contains(document.activeElement))).toBe(true);
    const technical = editor.locator('details').filter({ hasText: locale === 'pl' ? 'Szczegóły techniczne' : 'Technical details' });
    const summary = technical.locator('summary');
    await expect(technical).not.toHaveAttribute('open');
    await expect(editor.getByText('tokens.light.accent', { exact: true })).not.toBeVisible();
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(editor.getByText('tokens.light.accent', { exact: true })).toBeVisible();
    await expect(editor.locator('[data-editor-savebar]')).toBeVisible();
    const bar = await editor.locator('[data-editor-savebar]').boundingBox();
    expect(bar!.y).toBeGreaterThanOrEqual(55);
    expect(bar!.y).toBeLessThanOrEqual(57);
    await expect(editor.locator('dl > div')).toHaveCount(22);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('[data-storefront-editor]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations).toEqual([]);
    await page.setViewportSize({ width: 640, height: 900 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(selector).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    await summary.click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await editor.getByRole('heading', { level: 1 }).click();
      await page.evaluate(() => scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/d056-${locale}-${mode}-${width}.png`, fullPage: true });
    }
  });
}

test('A saves descriptor-driven section intent and reloads it in both locales', async ({ page }) => {
  await acceptAllCookies(page);
  await setAuthSession(page, admin.email, admin.password);
  await page.goto('/en/dashboard/templates');
  const editor = page.locator('[data-storefront-editor]');
  await editor.getByLabel('Template', { exact: true }).selectOption('storefront-a');
  await editor.getByRole('checkbox', { name: 'Show How it works', exact: true }).uncheck();
  await editor.getByRole('button', { name: 'Starting offers', exact: true }).click();
  await editor.getByLabel('Layout style', { exact: true }).selectOption('compact');
  await editor.getByRole('button', { name: /Reorder Starting offers/ }).focus();
  await page.keyboard.press('ArrowUp');
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('All changes saved');
  const { data, error } = await db.from('storefront_config').select('draft').single();
  expect(error).toBeNull();
  const draft = data!.draft as typeof DEFAULT_CONFIG;
  expect(draft.overridesByTemplate['storefront-a']).toEqual({ order: ['hero', 'tasks', 'start', 'comparison', 'catalogue', 'faq', 'closing'], sections: { tasks: { visibility: 'hidden' }, start: { variant: 'compact' } } });
  for (const locale of ['en', 'pl']) {
    await page.goto(`/${locale}/dashboard/templates`);
    await expect(editor.getByRole('checkbox', { name: locale === 'pl' ? 'Pokaż: Jak to działa' : 'Show How it works', exact: true })).not.toBeChecked();
    const sectionButton = editor.getByRole('button', { name: locale === 'pl' ? 'Oferty na początek' : 'Starting offers', exact: true });
    await expect(async () => {
      await sectionButton.click();
      await expect(sectionButton).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await expect(editor.getByLabel(locale === 'pl' ? 'Układ sekcji' : 'Layout style', { exact: true })).toHaveValue('compact');
    await editor.getByRole('searchbox').fill(productName);
    await expect(editor.getByRole('button', { name: `${locale === 'pl' ? 'Dodaj' : 'Add'} ${productName}`, exact: true })).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/p2wire-editor-${locale}-${width}.png`, fullPage: true });
    }
  }
});
