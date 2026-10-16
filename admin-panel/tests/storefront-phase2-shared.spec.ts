/** T2.5 geometry against frozen source, keyboard, bounded catalogue and network harness. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { referencePage, referenceProducts } from './fixtures/storefront-sections/phase2/reference';
import en from '../src/messages/en.json';
import pl from '../src/messages/pl.json';
import { checkAccessibility } from './helpers/axe';

const referenceCss = readFileSync('tests/fixtures/storefront-sections/phase2/reference.css', 'utf8');
const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2');
const sample = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#e8eefb"/><g fill="#244b9a"><rect x="70" y="150" width="170" height="150" rx="12"/><rect x="315" y="150" width="170" height="150" rx="12"/><rect x="560" y="150" width="170" height="150" rx="12"/></g><path d="M240 225H315M485 225H560" stroke="#244b9a" stroke-width="8"/></svg>';
let script: string;
let css: string;
test.beforeAll(() => {
  const directory = mkdtempSync(path.resolve('node_modules/.cache-t205-'));
  try {
    execFileSync('bun', ['-e', `const r=await Bun.build({entrypoints:['tests/fixtures/storefront-sections/phase2/shared-browser.tsx'],target:'browser',outdir:${JSON.stringify(directory)},define:{'process.env':'{"NODE_ENV":"production"}'},plugins:[{name:'image',setup(b){b.onResolve({filter:/^next\\/image$/},()=>({path:${JSON.stringify(path.resolve('tests/fixtures/storefront-sections/catalogue-image.ts'))}}));}}]});if(!r.success){console.error(r.logs);process.exit(1)}`]);
    script = readFileSync(path.join(directory, 'shared-browser.js'), 'utf8');
    css = readFileSync(path.join(directory, 'shared-browser.css'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
const tokens = '--sf-font-family:FixtureGeist;--sf-font-body-weight:400;--sf-font-heading-weight:600;--sf-bg-base:#fff;--sf-bg-raised:#e8eefb;--sf-text-heading:#17191f;--sf-text-body:#555d69;--sf-accent:#244b9a;--sf-accent-fg:#fff;--sf-border:#cbd5e5;--sf-radius-md:8px';
for (const concept of ['a', 'b'] as const) for (const locale of ['en', 'pl'] as const) {
  test(`${concept}/${locale}: reference geometry and shared harness`, async ({ page, context }) => {
    const requests: string[] = [];
    const errors: string[] = [];
    const batches: Record<string, unknown>[] = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://phase2.test') return route.abort();
      if (url.pathname === '/geist.woff2') return route.fulfill({ contentType: 'font/woff2', body: font });
      if (url.pathname === '/sample.svg') return route.fulfill({ contentType: 'image/svg+xml', body: sample });
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script });
      if (url.pathname.includes('/api/')) {
        const body = JSON.parse(url.searchParams.get('input')!);
        batches.push(body);
        const products = referenceProducts(locale).filter(product => (!body.search || product.title.toLowerCase().includes(body.search.toLowerCase())) && (!body.categoryIds.length || body.categoryIds.includes(product.id))).map(product => ({ ...product, image: null }));
        return route.fulfill({ json: { products, nextCursor: null } });
      }
      if (url.pathname === '/reference') return route.fulfill({ contentType: 'text/html', body: referencePage(concept, locale, referenceCss) });
      const dark = url.searchParams.has('dark') ? '--sf-bg-base:#141820;--sf-bg-raised:#1c2636;--sf-text-heading:#f6f7fb;--sf-text-body:#cbd2df;--sf-accent:#a5c6ff;--sf-accent-fg:#141820;--sf-border:#758399;' : '';
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Shared sections</title><style>@font-face{font-family:FixtureGeist;src:url(/geist.woff2)}*{box-sizing:border-box}body{margin:0;${tokens};${dark}font:15px/1.6 FixtureGeist;background:var(--sf-bg-base);color:var(--sf-text-heading)}button,input{font:inherit}a{color:inherit}h2{margin:0}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` });
    });
    const reference = await context.newPage();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await reference.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto(`http://phase2.test/?concept=${concept}&locale=${locale}&geometry`);
      await reference.goto('http://phase2.test/reference');
      if (concept === 'a') {
        // Core labels/format substitute concept editorial placeholders; retain every author field.
        const messages = locale === 'pl' ? pl : en;
        await reference.locator('.offer-price a').evaluate((element, label) => { element.textContent = `${label} ↗`; }, messages.myProducts.viewDetails);
        await reference.locator('.offer-price small').evaluate((element, label) => { element.textContent = label; }, messages.admin.products.form.marketing.formats.template);
      }
      await page.evaluate(() => document.fonts.ready);
      await reference.evaluate(() => document.fonts.ready);
      const hero = page.locator('[data-variant]').first();
      await expect(page.locator('h1')).toHaveCount(1);
      const dimensions = async (selector: string, refSelector: string) => {
        const actual = await page.locator(selector).boundingBox();
        const expected = await reference.locator(refSelector).boundingBox();
        const actualHero = await hero.boundingBox();
        const expectedHero = await reference.locator('[data-crop=hero]').boundingBox();
        for (const key of ['width', 'height'] as const) expect(Math.abs(actual![key] - expected![key]), `${width} ${selector} ${key}`).toBeLessThanOrEqual(2);
        expect(Math.abs(actual!.x - expected!.x), `${selector} x`).toBeLessThanOrEqual(2);
        expect(Math.abs((actual!.y - actualHero!.y) - (expected!.y - expectedHero!.y)), `${selector} relative y`).toBeLessThanOrEqual(2);
      };
      if (concept === 'a') {
        await dimensions('[data-variant=offer-focus]', '[data-crop=hero]');
        await dimensions('[data-variant=offer-focus] h1', '[data-crop=hero] h1');
        await dimensions('[data-variant=offer-focus] ol', '.what');
      } else {
        // B's outer section is full-width; its inner wrap matches the reference section.
        const actual = await hero.boundingBox();
        const expected = await reference.locator('[data-crop=hero]').boundingBox();
        expect(Math.abs(actual!.height - expected!.height)).toBeLessThanOrEqual(2);
        expect(Math.abs((await hero.locator(':scope > div').boundingBox())!.width - expected!.width)).toBeLessThanOrEqual(2);
        await dimensions('[data-variant=search-hero] h1', '[data-crop=hero] h1');
        await dimensions('[data-variant=search-hero] form', '[data-crop=hero] .search');
        await dimensions('[data-variant=search-hero] nav a:first-child', '[data-crop=hero] .task:first-child');
      }
      const closing = page.locator('[data-closing] > section');
      const expectedClosing = reference.locator('.closing');
      const closingBox = await closing.boundingBox();
      const referenceClosingBox = await expectedClosing.boundingBox();
      expect(Math.abs(closingBox!.height - referenceClosingBox!.height)).toBeLessThanOrEqual(2);
      for (const selector of ['h2', 'a']) {
        const actual = await closing.locator(selector).boundingBox();
        const expected = await expectedClosing.locator(selector).boundingBox();
        expect(Math.abs(actual!.x - expected!.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(actual!.y - closingBox!.y - expected!.y + referenceClosingBox!.y)).toBeLessThanOrEqual(2);
      }
      await page.screenshot({ path: `/tmp/t2-5-${concept}-${locale}-${width}.png`, fullPage: true });
      if (locale === 'pl') await expect(hero).toHaveScreenshot(`${concept}-hero-${width}.png`, { threshold: .2, maxDiffPixelRatio: .005, animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await checkAccessibility(page);
    }
    await reference.close();
    await page.goto(`http://phase2.test/?concept=${concept}&locale=${locale}`);
    const closing = page.locator('[data-closing] a');
    await expect(closing).toHaveAttribute('href', '#catalogue');
    await closing.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#catalogue$/);
    if (concept === 'b') {
      const finder = page.locator('[data-variant=search-hero]');
      const link = finder.getByRole('link').first();
      await link.focus();
      expect(await link.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
      await page.keyboard.press('Enter');
      await expect(link).toBeFocused();
      await expect(link).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('#catalogue article')).toHaveCount(1);
      const search = finder.getByRole('searchbox');
      const before = batches.length;
      await search.fill('x'.repeat(101));
      await search.press('Enter');
      expect(await search.evaluate(element => (element as HTMLInputElement).validity.valid)).toBe(false);
      expect(batches).toHaveLength(before);
      await search.fill('no match');
      await search.press('Enter');
      await expect(page.locator('#catalogue article')).toHaveCount(0);
      await expect(search).toBeFocused();
      expect(batches.every(batch => batch.pageSize === 24)).toBe(true);
    }
    for (const extra of ['dark', 'long', 'empty', 'unavailable', 'no-media', 'price=free', 'price=subscription', 'price=pwyw']) {
      await page.goto(`http://phase2.test/?concept=${concept}&locale=${locale}&geometry&${extra}`);
      for (const width of [320, 768]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(page.locator('h1')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
      await checkAccessibility(page);
    }
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768);
    await checkAccessibility(page);
    expect(errors).toEqual([]);
    expect(requests.every(url => url.startsWith('http://phase2.test/'))).toBe(true);
    expect(requests.some(url => /stripe|checkout-session|magic-link|license/.test(url))).toBe(false);
  });
}
