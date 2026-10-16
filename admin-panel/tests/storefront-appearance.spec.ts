/** Appearance authoring on an exclusively owned local stack. @see theme-tokens.md */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { createTestAdmin, setAuthSession } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const directory = path.join(process.env.TEST_APP_CWD ?? process.cwd(), 'data');
const files = ['active-theme.json', 'active-theme.legacy-backup.json'];
const savedFiles: (Buffer | null)[] = [];
const legacy = JSON.stringify({ name: 'Previous theme', colors: { accent: '#38BDF8', border: 'rgba(255,255,255,.2)' }, typography: { 'font-family': 'dm-sans' }, shapes: { 'radius-md': '8px' } }, null, 2);
let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let container: string;
let original: string;
let revision: number;
const sql = (query: string): string => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();
const literal = (json: string): string => "'" + json.replaceAll("'", "''") + "'::jsonb";
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  expect(['localhost', '127.0.0.1']).toContain(url.hostname);
  const kong = execFileSync('docker', ['ps', '--filter', `publish=${url.port}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim();
  expect(kong).toMatch(/^supabase_kong_[a-zA-Z0-9_-]+$/); container = kong.replace('supabase_kong_', 'supabase_db_');
  original = sql('SELECT to_jsonb(c) FROM public.storefront_config c'); revision = JSON.parse(original).revision;
  await mkdir(directory, { recursive: true });
  for (const file of files) { savedFiles.push(await readFile(path.join(directory, file)).catch(() => null)); await unlink(path.join(directory, file)).catch(() => {}); }
  await writeFile(path.join(directory, files[0]), legacy);
  admin = await createTestAdmin('appearance-editor');
});
test.afterAll(async () => {
  if (original) sql(`BEGIN; UPDATE public.storefront_config c SET revision=b.revision,draft=b.draft,published=b.published,updated_at=b.updated_at,updated_by=b.updated_by FROM jsonb_populate_record(NULL::public.storefront_config,${literal(original)}) b WHERE c.id=true; DELETE FROM public.storefront_config_history WHERE revision>${revision}; DELETE FROM public.audit_log WHERE table_name='storefront_config' AND (new_values->>'revision')::bigint>${revision}; COMMIT;`);
  for (const [index, previous] of savedFiles.entries()) { if (previous) await writeFile(path.join(directory, files[index]), previous); else await unlink(path.join(directory, files[index])).catch(() => {}); }
  await admin?.cleanup();
});
test('imports once with backup, edits and resets a leaf while retaining seller content', async ({ page }) => {
  await acceptAllCookies(page); await setAuthSession(page, admin.email, admin.password);
  await page.goto('/en/dashboard/templates');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const editor = page.locator('[data-storefront-editor]');
  await editor.getByText('Bring your previous colours', { exact: true }).click();
  await editor.getByRole('button', { name: 'Import previous theme', exact: true }).click();
  await expect(editor.getByText('Theme imported into the draft. Original backed up.')).toBeVisible();
  expect(await readFile(path.join(directory, files[1]), 'utf8')).toBe(legacy);
  expect(await readFile(path.join(directory, files[0]), 'utf8')).toBe(legacy);
  await expect(editor.getByText('1 old settings could not be converted. Review them in Technical details.')).toBeVisible();
  const imported = (await db.from('storefront_config').select('*').single()).data!;
  await editor.getByRole('button', { name: 'Import previous theme', exact: true }).click();
  await expect(editor.getByText('This theme has already been imported. Continue editing your draft.')).toBeVisible();
  expect((await db.from('storefront_config').select('revision').single()).data!.revision).toBe(imported.revision);
  await editor.getByLabel('Light · Accent', { exact: true }).fill('#ffffff');
  await expect(editor.getByText('Improve contrast before publishing. Your draft can still be saved.')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Reset Font' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Reset Light · Accent', exact: true }).click();
  await expect(editor.getByLabel('Light · Accent', { exact: true })).toHaveValue('#006aab');
  const reset = (await db.from('storefront_config').select('*').single()).data!;
  const draft = reset.draft as { tokens: { light?: { accent?: string } }; content: unknown };
  expect(draft.tokens.light?.accent).toBeUndefined(); expect(draft.content).toEqual((imported.draft as { content: unknown }).content);
  expect(reset.published).toEqual(imported.published);
  expect(await readFile(path.join(directory, files[0]), 'utf8')).toBe(legacy);
  expect(await readFile(path.join(directory, files[1]), 'utf8')).toBe(legacy);
  await page.reload(); await editor.getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect(editor.getByLabel('Font', { exact: true })).toHaveValue('dm-sans');
});
for (const locale of ['en', 'pl']) for (const mode of ['light', 'dark'] as const) {
  test(`${locale} ${mode} appearance keyboard, contrast and responsive layout`, async ({ page }) => {
    await acceptAllCookies(page); await setAuthSession(page, admin.email, admin.password);
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
    await page.addInitScript(theme => localStorage.setItem('sf_theme', theme), mode);
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`/${locale}/dashboard/templates`);
    const editor = page.locator('[data-storefront-editor]');
    await editor.getByRole('button', { name: locale === 'pl' ? 'Wygląd' : 'Appearance', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(editor.locator('[data-token-origin]')).toHaveCount(22);
    const protectedSummary = editor.getByText(locale === 'pl' ? 'Płatności i logowanie' : 'Checkout and sign-in', { exact: true });
    await protectedSummary.focus(); await page.keyboard.press('Enter');
    await expect(protectedSummary.locator('..').locator('dd').filter({ hasText: locale === 'pl' ? 'Chronione przez Sellf' : 'Protected by Sellf' }).first()).toBeVisible();
    const font = editor.getByLabel(locale === 'pl' ? 'Krój pisma' : 'Font', { exact: true });
    await font.focus(); await page.keyboard.press('Tab'); expect(await editor.evaluate(el => el.contains(document.activeElement))).toBe(true);
    expect((await new AxeBuilder({ page }).include('[data-storefront-editor]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await protectedSummary.click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width !== 320) await page.screenshot({ path: `/tmp/t1-15-${locale}-${mode}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 640, height: 900 }); await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
