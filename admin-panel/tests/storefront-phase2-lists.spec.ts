/** Phase 2 sections against frozen geometry and bounded catalogue interactions. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import en from '../src/messages/en.json';
import pl from '../src/messages/pl.json';
import { catalogueLabels } from '../src/lib/storefront-templates/catalogue-section';
import { referenceCopy, referencePage } from './fixtures/storefront-sections/phase2/reference';
import { catalogueProduct } from './fixtures/storefront-sections/catalogue';
import { checkAccessibility } from './helpers/axe';

let script: string;
let css: string;
const referenceCss = readFileSync('tests/fixtures/storefront-sections/phase2/reference.css', 'utf8');
const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2');
const sample = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#e8eefb"/><g fill="#244b9a"><rect x="70" y="150" width="170" height="150" rx="12"/><rect x="315" y="150" width="170" height="150" rx="12"/><rect x="560" y="150" width="170" height="150" rx="12"/></g><path d="M240 225H315M485 225H560" stroke="#244b9a" stroke-width="8"/></svg>';
test.beforeAll(() => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-phase2-lists-'));
  try {
    const options = { entrypoints: [path.resolve('tests/fixtures/storefront-sections/phase2/lists-browser.tsx')], target: 'browser', outdir: directory, naming: 'fixture.[ext]', define: { 'process.env': '{"NODE_ENV":"production"}' } };
    execFileSync('bun', ['--eval', `const result=await Bun.build({...${JSON.stringify(options)},plugins:[{name:'image',setup(build){build.onResolve({filter:/^next\\/image$/},()=>({path:${JSON.stringify(path.resolve('tests/fixtures/storefront-sections/product-list-image.ts'))}}));}}]});if(!result.success)throw new AggregateError(result.logs);`]);
    script = readFileSync(path.join(directory, 'fixture.js'), 'utf8');
    css = readFileSync(path.join(directory, 'fixture.css'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
for (const locale of ['en', 'pl'] as const) for (const variant of ['comparison', 'featured-grid', 'compact']) {
  test(`${locale}/${variant}: reference geometry, states and keyboard`, async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    const requests: string[] = [];
    const inputs: { search: string; categoryIds: string[]; priceKind: string | null; cursor: string | null; pageSize: number }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    const reference = await context.newPage();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['lists.test', 'phase2.test'].includes(url.host)) return route.abort();
      if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script });
      if (url.pathname === '/geist.woff2') return route.fulfill({ contentType: 'font/woff2', body: font });
      if (url.pathname === '/sample.svg') return route.fulfill({ contentType: 'image/svg+xml', body: sample });
      if (url.pathname === '/api/storefront/catalogue') {
        const input = JSON.parse(url.searchParams.get('input')!);
        inputs.push(input);
        expect(input.group).toBe('all');
        expect(input.pageSize).toBeLessThanOrEqual(24);
        const start = input.cursor ? Number(input.cursor.slice(7)) : 0;
        const matching = [];
        for (let index = start + 1; index <= 100000 && matching.length <= input.pageSize; index++) {
          const product = catalogueProduct(index);
          if (input.search && !product.title.includes(input.search)) continue;
          if (input.categoryIds.length && index % 2 !== 0) continue;
          if (input.priceKind && product.price.kind !== input.priceKind) continue;
          matching.push(product);
        }
        const products = matching.slice(0, input.pageSize);
        return route.fulfill({ json: { products, nextCursor: matching.length > input.pageSize ? `cursor-${Number(products.at(-1)!.slug.slice(8))}` : null } });
      }
      if (url.host === 'phase2.test') return route.fulfill({ contentType: 'text/html', body: referencePage(variant === 'comparison' ? 'a' : 'b', locale, referenceCss) });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Phase 2 lists</title><style>@font-face{font-family:Geist;src:url('/geist.woff2')}*{box-sizing:border-box}body{margin:0;background:#f3f5f9;color:#17191f;font:15px/1.6 Geist,sans-serif;--sf-text-heading:#17191f;--sf-text-body:#555d69;--sf-text-muted:#555d69;--sf-bg-base:#fff;--sf-bg-raised:#e8eefb;--sf-border:#d7d9dc;--sf-accent:#244b9a;--sf-accent-foreground:#fff}p,h2,h3{margin:0}.list-wrap:has([data-variant=featured-grid]){width:min(1248px,calc(100% - 96px));margin:auto}a{color:inherit;text-decoration:none}button,input,select{font:inherit}${css}@media(max-width:900px){.list-wrap:has([data-variant=featured-grid]){width:calc(100% - 48px)}}@media(max-width:600px){.list-wrap:has([data-variant=featured-grid]){width:calc(100% - 36px)}}body.dark{background:#151922;--sf-text-heading:#f3f5f9;--sf-text-body:#ccd3df;--sf-text-muted:#ccd3df;--sf-bg-base:#151922;--sf-bg-raised:#222c3c;--sf-border:#506078;--sf-accent:#a8c5ff;--sf-accent-foreground:#151922}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` });
    });
    const open = async (state = '') => {
      await page.goto(`https://lists.test/?locale=${locale}&variant=${variant}&${state}`);
      await page.evaluate(() => document.fonts.ready);
    };
    await open();
    await reference.goto('http://phase2.test/');
    await reference.evaluate(() => document.fonts.ready);
    const freeLabel = (locale === 'pl' ? pl : en).checkout.customPrice.freePreset;
    await reference.locator('.price').evaluateAll((nodes, label) => nodes.forEach(node => { if (node.textContent === '0 zł' || node.textContent === 'PLN 0') node.textContent = label; }), freeLabel);
    // Canonical format labels replace the concept's synthetic descriptor.
    if (variant === 'compact') await reference.locator('.catalog-item p').evaluateAll((nodes, caption) => nodes.forEach(node => { node.textContent = caption; }), `${locale === 'pl' ? 'Szablon' : 'Template'} · ${catalogueLabels[locale].requirements}: ${referenceCopy[locale].requirement}`);
    const section = page.locator(variant === 'compact' ? '#catalogue' : '[data-section]');
    const cards = section.locator('article');
    await expect(cards).toHaveCount(variant === 'comparison' ? 2 : 6);
    await expect(cards.first().getByText(freeLabel, { exact: true })).toBeVisible();
    await expect(cards.first()).not.toContainText(locale === 'pl' ? '0 zł' : 'PLN 0');
    for (const width of [1440, 390, 320, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await reference.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await checkAccessibility(page);
      const actual = await cards.first().boundingBox();
      const expected = await reference.locator(variant === 'comparison' ? '.compare-panel' : variant === 'compact' ? '.catalog-item' : '.product').first().boundingBox();
      if (variant !== 'compact') {
        const actualSection = await section.boundingBox();
        const frozenSection = await reference.locator(variant === 'comparison' ? '.comparison' : '.featured').boundingBox();
        expect(Math.abs((actual!.y - actualSection!.y) - (expected!.y - frozenSection!.y))).toBeLessThanOrEqual(2);
      }
      for (const key of ['x', 'width', 'height'] as const) expect(Math.abs(actual![key] - expected![key])).toBeLessThanOrEqual(2);
      if (variant === 'featured-grid') {
        const image = await cards.first().locator('img').boundingBox();
        expect(Math.abs(image!.width / image!.height - 16 / 9)).toBeLessThan(.02);
      }
      if (locale === 'pl' && (width === 1440 || width === 390)) await expect(cards.first()).toHaveScreenshot(`${variant}-${width}.png`, { threshold: .2, maxDiffPixelRatio: .005 });
      if (width === 1440 || width === 390) await page.screenshot({ path: `/tmp/t2-6-${variant}-${locale}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 768, height: 900 });
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await page.keyboard.press('Tab');
    expect(await page.locator(':focus').count()).toBe(1);
    if (variant === 'featured-grid') {
      await page.setViewportSize({ width: 1440, height: 900 });
      await reference.setViewportSize({ width: 1440, height: 900 });
      await reference.locator('.product').first().locator('summary').click();
      await cards.first().locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(cards.first().locator('details')).toHaveAttribute('open', '');
      await checkAccessibility(page);
      const actual = await cards.first().boundingBox();
      const frozen = await reference.locator('.product').first().boundingBox();
      expect(Math.abs(actual!.height - frozen!.height)).toBeLessThanOrEqual(2);
      await testInfo.attach('expanded-card', { body: await cards.first().screenshot(), contentType: 'image/png' });
    }
    if (variant === 'compact') {
      await section.getByRole('button', { name: locale === 'en' ? 'More products' : 'Więcej produktów', exact: true }).click();
      await expect(cards).toHaveCount(30);
      await section.getByRole('searchbox').fill('Product 100000');
      await section.getByRole('searchbox').press('Enter');
      await expect(section.getByRole('heading', { name: 'Product 100000', exact: true })).toBeVisible();
      await expect(cards).toHaveCount(1);
      await section.getByRole('checkbox').check();
      await expect.poll(() => inputs.at(-1)?.categoryIds.length).toBe(1);
      expect(inputs.every(input => input.pageSize <= 24)).toBe(true);
      expect(requests.filter(url => url.includes('/api/')).length).toBe(inputs.length);
    }
    for (const state of ['long', 'missing', 'empty', 'unavailable', 'prices']) {
      await open(state);
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await checkAccessibility(page);
      }
      if (state === 'prices' && variant !== 'comparison') await expect(section).toContainText('0 PLN / month');
    }
    await open();
    await page.evaluate(() => document.body.classList.add('dark'));
    await checkAccessibility(page);
    expect(errors).toEqual([]);
    expect(requests.every(url => new URL(url).host === 'lists.test')).toBe(true);
    await reference.close();
  });
}
