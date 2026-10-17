import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { D_CONFIG, DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
import { validateConfig } from '@/lib/storefront-templates/registry';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

let script: string;
let css: string;
test.beforeAll(async () => {
  const dir = mkdtempSync(path.resolve('node_modules/.cache-authoring-'));
  try {
    const mock = `export const storefrontTemplateAction = input => fetch('/action', {method:'POST',body:JSON.stringify(input)}).then(r=>r.json());
      export const importLegacyStorefrontTheme = async () => ({success:false});
      export const getCategories = async () => ({success:true,data:[]});
      export const api = {list:async()=>({data:[],pagination:{has_more:false}}),get:async()=>({id:'11111111-1111-4111-8111-111111111111',name:'Workshop',is_active:true})};`;
    execFileSync('bun', ['-e', `const result=await Bun.build({entrypoints:['tests/fixtures/storefront-sections/authoring-browser.tsx'],target:'browser',outdir:${JSON.stringify(dir)},define:{'process.env':'{"NODE_ENV":"production"}'},plugins:[{name:'actions',setup(b){b.onResolve({filter:/^@\\/lib\\/(actions\\/(storefront-templates|storefront-legacy-theme|categories)|api\\/client)$/},()=>({path:'actions',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:${JSON.stringify(mock)},loader:'js'}));}}]});if(!result.success){console.error(result.logs);process.exit(1)}`]);
    script = readFileSync(path.join(dir, 'authoring-browser.js'), 'utf8');
    css = (await postcss([tailwindcss()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
    css += readFileSync(path.join(dir, 'authoring-browser.css'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
for (const locale of ['en', 'pl'] as const) test(`${locale}: publication feedback leads to the section, incomplete save warns, comparisons use current version`, async ({ page }, testInfo) => {
  const copy = locale === 'pl' ? pl : en;
  const draft = structuredClone(D_CONFIG);
  delete draft.settingsByTemplate.d!.closingProduct;
  const validation = validateConfig(draft);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://authoring.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script });
    if (url.pathname === '/action') {
      const input = route.request().postDataJSON();
      const snapshot = { revision: 3, draft, published: DEFAULT_CONFIG, validation };
      const data = input.operation === 'read' ? snapshot : input.operation === 'history'
        ? [3, 2, 0].map(revision => ({ ...snapshot, revision, draft: revision ? draft : null, created_at: '2026-10-17T10:00:00Z' }))
        : { fromRevision: input.fromRevision, toRevision: input.toRevision, changes: [] };
      return route.fulfill({ json: input.operation === 'publish'
        ? { success: false, code: 'INVALID', validation: { ...validation, valid: false, errors: validation.warnings.filter(issue => issue.code === 'BINDING') } }
        : input.operation === 'draft' ? { success: true, revision: 4, validation } : { success: true, data } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authoring</title><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`https://authoring.test/${locale}/admin/templates/history`);
  const rows = page.locator('ol > li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByRole('button', { name: copy.templatePreview.compare, exact: true })).toHaveCount(0);
  await rows.nth(1).getByRole('button', { name: copy.templatePreview.compare, exact: true }).click();
  await expect(page.getByRole('heading', { name: `${copy.templatePreview.changes} #2 → #3` })).toBeVisible();
  await rows.nth(0).getByRole('button', { name: copy.templatePreview.publishVersion }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(copy.storefrontEditor.sectionNames.closing);
  await expect(alert).toContainText(copy.storefrontEditor.missingOffer);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('publish-feedback.png'), fullPage: true });
  await alert.getByRole('link').click();
  await expect(page.locator('[data-editor-panel]')).toHaveAccessibleName(copy.storefrontEditor.sectionNames.closing);
  await expect(page.locator('[data-editor-panel]')).toBeFocused();
  await expect.poll(async () => {
    const panel = await page.locator('[data-editor-panel]').boundingBox();
    const bar = await page.locator('[data-editor-savebar]').boundingBox();
    return panel!.y >= bar!.y + bar!.height;
  }).toBe(true);
  await page.getByRole('button', { name: copy.storefrontEditor.sectionNames.hero, exact: true }).click();
  await page.getByLabel(`${copy.storefrontEditor.sectionNames.hero} · EN · ${copy.storefrontEditor.heading}`, { exact: true }).fill('Updated workshop');
  await page.getByRole('button', { name: copy.storefrontEditor.save, exact: true }).click();
  await expect(page.getByRole('status')).toContainText(copy.storefrontEditor.savedState);
  const warning = page.getByRole('region', { name: copy.storefrontEditor.beforePublishing });
  await expect(warning).toContainText(copy.storefrontEditor.missingOffer);
  await warning.getByRole('button').click();
  await expect(page.locator('[data-editor-panel]')).toHaveAccessibleName(copy.storefrontEditor.sectionNames.closing);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('draft-warning.png'), fullPage: true });
  expect(errors).toEqual([]);
});
