/** Full-composition SSR and finder/catalogue integration. Run with the sections project. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { checkAccessibility } from './helpers/axe';
import { D_TOKENS } from '../src/lib/storefront-templates/fixtures';
import type { PresentationModel } from '../src/lib/storefront-templates/resolver';
let pages: Record<string, { html: string; model: PresentationModel }>;
let css: string; let script: string;
test.beforeAll(() => {
  const dir = mkdtempSync(path.resolve('node_modules/.cache-composition-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/composition-render.tsx', '--target=node', '--packages=external', '--outdir', dir]);
    pages = JSON.parse(execFileSync('bun', [path.join(dir, 'composition-render.js')], { encoding: 'utf8' }));
    css = readFileSync(path.join(dir, 'composition-render.css'), 'utf8');
    execFileSync('bun', ['-e', `const r=await Bun.build({entrypoints:['tests/fixtures/storefront-sections/composition-browser.tsx'],target:'browser',outdir:${JSON.stringify(dir)},define:{'process.env':'{"NODE_ENV":"production"}'},plugins:[{name:'image',setup(b){b.onResolve({filter:/^next\\/image$/},()=>({path:${JSON.stringify(path.resolve('tests/fixtures/storefront-sections/catalogue-image.ts'))}}));}}]});if(!r.success){console.error(r.logs);process.exit(1)}`]);
    script = readFileSync(path.join(dir, 'composition-browser.js'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
for (const theme of ['light', 'dark'] as const) for (const locale of ['en', 'pl'] as const) for (const template of ['default', 'd'] as const) {
  test(`${locale}/${template}/${theme}: first paint, headings, responsive and shared filters`, async ({ page, context }, testInfo) => {
    const fixture = pages[`${locale}/${template}`]; const colors = D_TOKENS[theme];
    const errors: string[] = []; const inputs: { categoryIds: string[]; search: string }[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route('https://composition.test/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/font.woff2') return route.fulfill({ contentType: 'font/woff2', body: readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2') });
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script });
      if (url.pathname === '/api/storefront/catalogue') {
        const input = JSON.parse(url.searchParams.get('input')!); inputs.push(...(Array.isArray(input) ? input : [input]));
        const result = { products: Object.values(fixture.model.catalogue.groups)[0]!.products.slice(0, 1), nextCursor: null };
        return route.fulfill({ json: Array.isArray(input) ? input.map(() => result) : result });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Composition</title><link rel="canonical" href="https://composition.test/${locale}"><style>@font-face{font-family:FixtureGeist;src:url('/font.woff2')}*{box-sizing:border-box}body{margin:0;font-family:FixtureGeist;background:${colors.background};color:${colors.foreground}}header a{color:inherit}main{--sf-bg-base:${colors.background};--sf-bg-raised:${colors.muted};--sf-text-heading:${colors.foreground};--sf-text-body:${colors.foreground};--sf-text-muted:${colors.mutedForeground};--sf-accent:${colors.accent};--sf-accent-foreground:${colors.accentForeground};--sf-accent-fg:${colors.accentForeground};--sf-border:${colors.border}}${css}</style></head><body><header><a href="/${locale}">Example shop</a></header><main id="root">${fixture.html}</main><script id="model" type="application/json">${JSON.stringify(fixture.model)}</script><script src="/fixture.js" defer></script></body></html>` });
    });
    const firstPaint = await context.newPage(); await firstPaint.route('**/fixture.js', route => route.abort());
    await firstPaint.goto(`https://composition.test/${locale}`);
    await expect(firstPaint.locator('h1')).toHaveCount(1);
    await expect(firstPaint.locator('#catalogue')).toBeVisible(); await firstPaint.close();
    await page.goto(`https://composition.test/${locale}`);
    await expect(page.locator('[data-template]')).toHaveAttribute('data-template', template);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('h1')).toHaveCount(1);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const control of await page.locator('#catalogue select').all()) expect((await control.boundingBox())!.width).toBeGreaterThanOrEqual(120);
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`composition-${width}.png`), fullPage: true });
      if (template === 'd') {
        const starter = await page.locator('[data-section="product-list/1"]').boundingBox();
        expect(starter!.width).toBeCloseTo(Math.min(1248, width - (width <= 600 ? 36 : 80)), 0);
      }
      expect(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(e => [e.tagName, e.className, e.getBoundingClientRect().right]))).toEqual([]);
    }
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await checkAccessibility(page);
    if (template === 'd') {
      const task = page.locator('nav[aria-label] a').first();
      await task.focus(); await task.press('Enter');
      await expect.poll(() => inputs.length).toBe(1);
      await expect(task).toBeFocused(); await expect(task).toHaveAttribute('aria-current', 'true');
      expect(inputs[0].categoryIds).toEqual(['55555555-5555-4555-8555-555555555555']);
      await page.locator('#catalogue button').filter({ hasText: locale === 'pl' ? 'Wyczyść filtry' : 'Clear filters' }).click();
      await expect(task).not.toHaveAttribute('aria-current', 'true');
      const search = page.locator('section form[role="search"]').first().getByRole('searchbox');
      await search.fill('report'); await search.press('Enter');
      await expect.poll(() => inputs.at(-1)?.search).toBe('report'); await expect(search).toBeFocused();
      const summary = page.locator('details summary').first();
      await summary.focus(); await summary.press('Enter');
      await expect(page.locator('details').first()).toHaveAttribute('open', '');
    }
    await page.evaluate(() => {
      const model = JSON.parse(document.getElementById('model')!.textContent!);
      model.sections.find((s: { type: string }) => s.type === 'catalogue/1').props.initialQuery = { search: 'external', categoryIds: [], priceKind: null, format: null };
      window.dispatchEvent(new CustomEvent('composition:replace', { detail: model }));
    });
    await expect(page.locator('#catalogue input[type="search"]')).toHaveValue('external');
    if (template === 'default') {
      await page.evaluate(() => {
        const model = JSON.parse(document.getElementById('model')!.textContent!);
        model.catalogue.groups.paid.nextCursor = 'more';
        model.sections.find((section: { type: string }) => section.type === 'catalogue/1').props.groups.paid.nextCursor = 'more';
        window.dispatchEvent(new CustomEvent('composition:replace', { detail: model }));
      });
      await expect(page.locator('[data-template] > header dl')).toHaveCount(0);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: `/tmp/tpl-fixes-${locale}-${theme}-${width}.png`, fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  });
}
