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
let productId: string;
let container: string;
let original: { revision: number };
let originalJson: string;
const sql = (query: string): string => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
const literal = (json: string): string => "'" + json.replaceAll("'", "''") + "'::jsonb";
test.beforeAll(async () => {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  expect(['localhost', '127.0.0.1']).toContain(url.hostname);
  const kong = execFileSync('docker', ['ps', '--filter', `publish=${url.port}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim();
  expect(kong).toMatch(/^supabase_kong_[a-zA-Z0-9_-]+$/);
  container = kong.replace('supabase_kong_', 'supabase_db_');
  originalJson = sql('SELECT to_jsonb(c) FROM public.storefront_config c');
  original = JSON.parse(originalJson);
  sql(`UPDATE public.storefront_config SET draft=NULL,published=${literal(JSON.stringify(DEFAULT_CONFIG))}`);
  admin = await createTestAdmin('composition-editor');
  const { data, error } = await db.from('products').select('id').eq('is_active', true).eq('is_listed', true).limit(1).single();
  if (error) throw error;
  productId = data.id;
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

test('reads, saves, reloads, retains inactive values and prevents a stale tab from overwriting', async ({ page, context }) => {
  await acceptAllCookies(page);
  await setAuthSession(page, admin.email, admin.password);
  await page.goto('/en/dashboard/templates');
  const editor = page.locator('[data-storefront-editor]');
  await expect(editor.getByRole('heading', { name: 'Storefront templates' })).toBeVisible();
  await editor.getByLabel('Template', { exact: true }).selectOption('d');
  await editor.getByLabel('Featured offer', { exact: true }).fill(productId);
  await editor.getByLabel('Closing offer', { exact: true }).fill(productId);
  await editor.getByRole('button', { name: 'Add home.hero', exact: true }).click();
  await editor.getByLabel('home.hero · EN · Heading', { exact: true }).fill('Żółć — '+ 'Long seller copy '.repeat(8));
  await editor.getByLabel('home.hero · EN · Steps', { exact: false }).fill('First step\nSecond step');
  await editor.getByRole('button', { name: 'Move hero down', exact: true }).focus();
  await page.keyboard.press('Enter');
  await editor.getByRole('checkbox', { name: 'Show tasks', exact: true }).uncheck();
  await editor.getByLabel('Variant for hero', { exact: true }).selectOption('simple');
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Draft saved');
  const saved = await db.from('storefront_config').select('revision,draft,published').single();
  expect(saved.error).toBeNull();
  const draft = saved.data!.draft as unknown as StorefrontConfig;
  expect(draft.templateId).toBe('d');
  expect(draft.overridesByTemplate.d!.order![0]).toBe('tasks');
  expect(draft.overridesByTemplate.d!.hidden).toEqual(['tasks']);
  expect(draft.overridesByTemplate.d!.variants!.hero).toBe('simple');
  expect((saved.data!.published as unknown as StorefrontConfig).templateId).toBe('default');
  await page.reload();
  await expect(editor.getByLabel('Featured offer', { exact: true })).toHaveValue(productId);
  await expect(editor.getByLabel('home.hero · EN · Heading', { exact: true })).toHaveValue(draft.content['home.hero']!.en!.kind === 'hero' ? draft.content['home.hero']!.en!.heading : '');
  await editor.getByLabel('Template', { exact: true }).selectOption('default');
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Draft saved');
  await page.reload();
  await editor.getByLabel('Template', { exact: true }).selectOption('d');
  await expect(editor.getByLabel('Featured offer', { exact: true })).toHaveValue(productId);
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Draft saved');
  const other = await context.newPage();
  await other.goto('/en/dashboard/templates');
  await expect(other.getByLabel('Featured offer', { exact: true })).toBeVisible();
  const firstTabHeading = 'First tab saved — ' + 'Długi tekst '.repeat(10);
  await editor.getByLabel('home.hero · EN · Heading', { exact: true }).fill(firstTabHeading);
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Draft saved');
  await other.getByLabel('home.hero · EN · Heading', { exact: true }).fill('Second tab local');
  await other.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(other.locator('[data-storefront-editor]').getByRole('alert')).toContainText('newer revision');
  await expect(other.getByLabel('home.hero · EN · Heading', { exact: true })).toHaveValue('Second tab local');
  await expect(other.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await other.getByRole('button', { name: 'Reload saved draft', exact: true }).click();
  await other.getByRole('button', { name: 'Discard edits and reload', exact: true }).click();
  await expect(other.getByLabel('home.hero · EN · Heading', { exact: true })).toHaveValue(firstTabHeading);
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
    const summary = editor.locator('summary');
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(editor.getByText('tokens.light.accent', { exact: true })).toBeVisible();
    await expect(editor.locator('dl > div')).toHaveCount(22);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('[data-storefront-editor]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations).toEqual([]);
    await page.setViewportSize({ width: 640, height: 900 });
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(selector).toBeVisible();
    await page.screenshot({ path: `/tmp/t1-18-${locale}-${mode}.png`, fullPage: true });
  });
}
