/** Full-composition SSR and finder/catalogue integration. Run with the sections project. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { checkAccessibility } from './helpers/axe';
import { A_TOKENS, B_TOKENS, C_TOKENS, D_TOKENS } from '../src/lib/storefront-templates/fixtures';
import type { PresentationModel } from '../src/lib/storefront-templates/resolver';
let pages: Record<string, { html: string; model: PresentationModel }>;
let css: string; let script: string;
test.beforeAll(() => {
  const dir = mkdtempSync(path.resolve('node_modules/.cache-composition-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/composition-render.tsx', '--target=node', '--production', '--packages=external', '--outdir', dir]);
    pages = JSON.parse(execFileSync('bun', [path.join(dir, 'composition-render.js')], { encoding: 'utf8' }));
    css = readFileSync(path.join(dir, 'composition-render.css'), 'utf8');
    execFileSync('bun', ['-e', `const r=await Bun.build({entrypoints:['tests/fixtures/storefront-sections/composition-browser.tsx'],target:'browser',format:'iife',outdir:${JSON.stringify(dir)},define:{'process.env':'{"NODE_ENV":"production"}'},plugins:[{name:'image',setup(b){b.onResolve({filter:/^next\\/image$/},()=>({path:${JSON.stringify(path.resolve('tests/fixtures/storefront-sections/catalogue-image.ts'))}}));}}]});if(!r.success){console.error(r.logs);process.exit(1)}`]);
    script = readFileSync(path.join(dir, 'composition-browser.js'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
for (const theme of ['light', 'dark'] as const) for (const locale of ['en', 'pl'] as const) for (const template of ['default', 'd', 'storefront-a', 'storefront-b', 'storefront-c'] as const) {
  test(`${locale}/${template}/${theme}: first paint, headings, responsive and shared filters`, async ({ page, context }, testInfo) => {
    const fixture = pages[`${locale}/${template}`]; const colors = (template === 'storefront-c' ? C_TOKENS : template === 'storefront-b' ? B_TOKENS : template === 'storefront-a' ? A_TOKENS : D_TOKENS)[theme];
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    const errors: string[] = []; const inputs: { categoryIds: string[]; search: string }[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route('https://composition.test/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/portrait.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="484"><rect width="440" height="484" fill="#e8e5de"/><circle cx="220" cy="155" r="70" fill="#244b9a"/><path d="M70 484V360a150 150 0 0 1 300 0v124" fill="#244b9a"/></svg>' });
      if (url.pathname === '/sample.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#17243e"/><text x="55" y="220" fill="#b9ccf4" font-size="44">Example Studio</text><path d="M60 300H740" stroke="#b9ccf4" stroke-width="4"/></svg>' });
      if (url.pathname === '/font.woff2') return route.fulfill({ contentType: 'font/woff2', body: readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2') });
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script });
      if (url.pathname === '/api/storefront/catalogue') {
        const input = JSON.parse(url.searchParams.get('input')!); inputs.push(...(Array.isArray(input) ? input : [input]));
        const result = { products: Object.values(fixture.model.catalogue.groups)[0]!.products.slice(0, 1), nextCursor: null };
        return route.fulfill({ json: Array.isArray(input) ? input.map(() => result) : result });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Composition</title><link rel="canonical" href="https://composition.test/${locale}"><style>@font-face{font-family:FixtureGeist;src:url('/font.woff2')}*{box-sizing:border-box}body{margin:0;font-family:FixtureGeist;background:${colors.background};color:${colors.foreground}}.fixtureHeader{height:80px;max-width:1248px;width:calc(100% - 80px);margin:auto;display:flex;align-items:center;font-weight:600}.fixtureHeader a{color:inherit;text-decoration:none}@media(max-width:600px){.fixtureHeader{height:72px;width:calc(100% - 36px)}}main{--sf-bg-base:${colors.background};--sf-bg-raised:${colors.muted};--sf-text-heading:${colors.foreground};--sf-text-body:${colors.foreground};--sf-text-muted:${colors.mutedForeground};--sf-accent:${colors.accent};--sf-accent-foreground:${colors.accentForeground};--sf-accent-fg:${colors.accentForeground};--sf-border:${colors.border}}${css}</style></head><body><header class="fixtureHeader"><a href="/${locale}">Example shop</a></header><main id="root">${fixture.html}</main><script id="model" type="application/json">${JSON.stringify(fixture.model)}</script><script src="/fixture.js" defer></script></body></html>` });
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
      for (const control of await page.locator('#catalogue select').all()) expect((await control.boundingBox())!.width).toBeGreaterThanOrEqual(template.startsWith('storefront-') ? 96 : 120);
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`composition-${width}.png`), fullPage: true });
      if (template === 'storefront-a') {
        const footer = page.locator('[data-template] > footer');
        expect(await footer.evaluate(element => getComputedStyle(element).textAlign)).toBe('center');
        expect(await footer.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await page.locator('section').last().evaluate(element => getComputedStyle(element).backgroundColor));
        expect(await footer.evaluate(element => parseFloat(getComputedStyle(element).paddingTop))).toBeGreaterThanOrEqual(24);
        expect(fixture.model.sections.map(section => section.id)).toEqual(['hero', 'tasks', 'comparison', 'start', 'catalogue', 'faq', 'closing']);
        await expect(page.locator('[data-variant="offer-focus"] video, [data-variant="offer-focus"] iframe, [data-variant="offer-focus"] button')).toHaveCount(0);
        await expect(page.locator('[data-variant="comparison"] article')).toHaveCount(2);
        await expect(page.locator('[data-variant="detail-cards"] article')).toHaveCount(3);
        if (width === 390 || width === 1440) {
          await page.screenshot({ path: `/tmp/t2-7-${locale}-${theme}-${width}.png`, fullPage: true });
          if (locale === 'pl' && theme === 'light') await expect(page).toHaveScreenshot(`a-${width}.png`, { fullPage: true, threshold: .2, maxDiffPixelRatio: .005 });
        }
      }
      if (template === 'storefront-b') {
        expect(await page.locator('[data-template] > footer').evaluate(element => getComputedStyle(element).textAlign)).toBe('center');
        expect(fixture.model.sections.map(section => section.id)).toEqual(['hero', 'featured', 'catalogue', 'starter', 'faq', 'closing']);
        await expect(page.locator('[data-variant="featured-grid"] article')).toHaveCount(6);
        await expect(page.locator('[data-variant="search-hero"]')).toBeVisible();
        if (width === 390 || width === 1440) {
          await page.screenshot({ path: `/tmp/t213-${locale}-${theme}-${width}.png`, fullPage: true });
          if (locale === 'pl' && theme === 'light') await expect(page).toHaveScreenshot(`b-${width}.png`, { fullPage: true, threshold: .2, maxDiffPixelRatio: .005 });
        }
      }
      if (template === 'storefront-c') {
        expect(fixture.model.sections.map(section => section.id)).toEqual(['hero', 'story', 'paths', 'projects', 'start', 'catalogue', 'faq', 'closing']);
        for (const family of ['author-hero/1', 'author-story/1', 'product-paths/1', 'project-showcase/1']) await expect(page.locator(`[data-section="${family}"]`)).toBeVisible();
        await expect(page.locator('[data-section="product-paths/1"] article')).toHaveCount(4);
        await expect(page.locator('[data-section="project-showcase/1"] article')).toHaveCount(3);
        await expect(page.locator('[data-variant="detail-cards"] article')).toHaveCount(3);
        const hero = page.locator('[data-section="author-hero/1"]');
        await expect(hero.locator('a').first()).toHaveAttribute('href', '#paths');
        await expect(hero.locator('a').last()).toHaveAttribute('href', '#catalogue');
        expect(await page.locator('a[href*="biograph"], a[href*="about"]').count()).toBe(0);
        if ((width === 390 || width === 1440) && theme === 'light') {
          await page.screenshot({ path: `/tmp/t2-18-${locale}-${width}.png`, fullPage: true });
          if (locale === 'pl') await expect(page).toHaveScreenshot(`c-${width}.png`, { fullPage: true, threshold: .2, maxDiffPixelRatio: .005 });
        }
      }
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
    if (template !== 'default' && template !== 'storefront-c') {
      const task = page.locator('nav[aria-label] a').first();
      await task.focus(); await task.press('Enter');
      await expect.poll(() => inputs.length).toBe(1);
      await expect(task).toBeFocused(); await expect(task).toHaveAttribute('aria-current', 'true');
      expect(inputs[0].categoryIds).toEqual([template === 'd' ? '55555555-5555-4555-8555-555555555555' : '00000000-0000-4000-8000-000000000001']);
      await page.locator('#catalogue button').filter({ hasText: locale === 'pl' ? 'Wyczyść filtry' : 'Clear filters' }).click();
      await expect(task).not.toHaveAttribute('aria-current', 'true');
      const search = template === 'storefront-a' ? page.locator('#catalogue input[type="search"]') : page.locator('section form[role="search"]').first().getByRole('searchbox');
      await search.fill('report'); await search.press('Enter');
      await expect.poll(() => inputs.at(-1)?.search).toBe('report'); await expect(search).toBeFocused();
      const summary = page.locator('details summary').first();
      await summary.focus(); await summary.press('Enter');
      await expect(page.locator('details').first()).toHaveAttribute('open', '');
    }
    if (template === 'storefront-c') {
      const pathsAction = page.locator('[data-section="author-hero/1"] a').first();
      await pathsAction.focus(); await pathsAction.press('Enter');
      await expect(page).toHaveURL(/#paths$/);
      await expect(page.locator('#paths')).toBeVisible();
      await expect.poll(() => page.locator('#paths').evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThanOrEqual(2);
      await page.keyboard.press('Tab');
      await expect(page.locator('#paths a').first()).toBeFocused();
      for (const link of await page.locator('[data-section="product-paths/1"] a').all()) await expect(link).toHaveAttribute('href', new RegExp(`^/${locale}/p/example-`));
      const search = page.locator('#catalogue input[type="search"]');
      await search.fill('report'); await search.press('Enter');
      await expect.poll(() => inputs.at(-1)?.search).toBe('report'); await expect(search).toBeFocused();
      await page.locator('#catalogue button').filter({ hasText: locale === 'pl' ? 'Wyczyść filtry' : 'Clear filters' }).click();
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
    if (template === 'storefront-a') {
      await expect(page.locator('section a[href="#catalogue"]').last()).toBeVisible();
      await page.evaluate(() => {
        const model = JSON.parse(document.getElementById('model')!.textContent!);
        const hero = model.sections.find((section: { id: string }) => section.id === 'hero');
        delete hero.props.content.staticDemo;
        hero.props.product.image = null;
        hero.props.content.heading = 'ŻółćExample'.repeat(14);
        window.dispatchEvent(new CustomEvent('composition:replace', { detail: model }));
      });
      await expect(page.locator('[data-variant="offer-focus"] img')).toHaveCount(0);
      await page.setViewportSize({ width: 320, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => {
        const model = JSON.parse(document.getElementById('model')!.textContent!);
        for (const section of model.sections) {
          if ('product' in section.props) section.props.product = null;
          if ('products' in section.props) section.props.products = [];
          if ('groups' in section.props) section.props.groups = { all: { products: [], nextCursor: null } };
          if (section.id === 'hero' || section.id === 'faq') section.props.content = null;
        }
        window.dispatchEvent(new CustomEvent('composition:replace', { detail: model }));
      });
      await expect(page.locator('#catalogue')).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('[data-section="product-list/1"]')).toHaveCount(0);
      await expect(page.locator('[data-variant="offer-focus"] a')).toHaveCount(0);
    }
    if (template === 'storefront-c') {
      await page.evaluate(() => {
        const model = JSON.parse(document.getElementById('model')!.textContent!);
        for (const section of model.sections) {
          if (section.props.content) {
            section.props.content.heading = 'ŻółćExample'.repeat(14);
            if (section.type === 'author-story/1') section.props.content.paragraphs = ['Przykładowa długa biografia '.repeat(80)];
          }
          for (const item of section.props.items ?? []) {
            if ('situation' in item) item.situation = 'ŻółćExample'.repeat(14);
            if ('name' in item) item.name = 'ŻółćExample'.repeat(14);
            item.body = 'Przykładowy długi opis '.repeat(60);
          }
        }
        window.dispatchEvent(new CustomEvent('composition:replace', { detail: model }));
      });
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(page.locator('h1')).toContainText('ŻółćExample');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (theme === 'light') {
          await page.screenshot({ path: `/tmp/t2-18-${locale}-long-${width}.png`, fullPage: true });
          if (locale === 'pl') await expect(page).toHaveScreenshot(`c-long-${width}.png`, { fullPage: true, threshold: .2, maxDiffPixelRatio: .005 });
        }
      }
      await page.evaluate(() => {
        const model = JSON.parse(document.getElementById('model')!.textContent!);
        for (const section of model.sections) {
          if ('content' in section.props) section.props.content = null;
          if ('portrait' in section.props) section.props.portrait = null;
          if ('items' in section.props) section.props.items = [];
          if ('products' in section.props) section.props.products = [];
          if ('groups' in section.props) section.props.groups = { all: { products: [], nextCursor: null } };
        }
        window.dispatchEvent(new CustomEvent('composition:replace', { detail: model }));
      });
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('#catalogue')).toBeVisible();
      await expect(page.locator('#catalogue article')).toHaveCount(0);
      await expect(page.locator('[data-section="author-hero/1"] img, [data-section="author-story/1"], [data-section="product-paths/1"], [data-section="project-showcase/1"], [data-section="product-list/1"]')).toHaveCount(0);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (theme === 'light') {
          await page.screenshot({ path: `/tmp/t2-18-${locale}-empty-${width}.png`, fullPage: true });
          if (locale === 'pl') await expect(page).toHaveScreenshot(`c-empty-${width}.png`, { fullPage: true, threshold: .2, maxDiffPixelRatio: .005 });
        }
      }
    }
    expect(requests.every(url => new URL(url).host === 'composition.test')).toBe(true);
    expect(requests.some(url => /licenses|stripe|auth|checkout-session/.test(url))).toBe(false);
    expect(errors).toEqual([]);
  });
}
