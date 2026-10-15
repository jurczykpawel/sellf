/** Starter section browser geometry and accessibility. @see fixtures/storefront-sections/product-list.ts */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { D_TOKENS } from '../src/lib/storefront-templates/fixtures';
import { checkAccessibility } from './helpers/axe';

let script: string;
let css: string;
const fontSemibold = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.woff2');
const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2');
test.beforeAll(() => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-product-list-'));
  try {
    const options = { entrypoints: [path.resolve('tests/fixtures/storefront-sections/product-list-browser.tsx')], target: 'browser', outdir: directory, define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' } };
    const imageEntry = path.resolve('tests/fixtures/storefront-sections/product-list-image.ts');
    execFileSync('bun', ['--eval', `const result = await Bun.build({...${JSON.stringify(options)}, plugins: [{name: 'next-image-entry', setup(build) {build.onResolve({filter: /^next\\/image$/}, () => ({path: ${JSON.stringify(imageEntry)}}));}}]}); if (!result.success) throw new AggregateError(result.logs);`]);
    script = readFileSync(path.join(directory, 'product-list-browser.js'), 'utf8');
    css = readFileSync(path.join(directory, 'product-list-browser.css'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
for (const locale of ['en', 'pl'] as const) for (const theme of ['light', 'dark'] as const) for (const variant of ['detail-cards', 'compact']) {
  test(`${locale}/${theme}/${variant}: geometry, states and keyboard`, async ({ page }, testInfo) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    const colors = D_TOKENS[theme];
    const variables = `--sf-bg-base:${colors.background};--sf-text-heading:${colors.foreground};--sf-text-body:${colors.mutedForeground};--sf-accent:${colors.accent};--sf-border:${colors.border};--sf-radius-md:12px;--sf-font-heading-weight:600`;
    await page.route('https://media.example.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#e8f0ea"/><g fill="#faf8f4" stroke="#075c43" stroke-width="3"><rect x="60" y="160" width="180" height="140" rx="8"/><rect x="310" y="160" width="180" height="140" rx="8"/><rect x="560" y="160" width="180" height="140" rx="8"/><path d="M240 230h70m180 0h70"/></g></svg>' }));
    await page.route('http://starters.test/**', route => {
      const resource = new URL(route.request().url()).pathname;
      return route.fulfill(resource === '/fixture.js' ? { contentType: 'application/javascript', body: script }
        : resource === '/geist-semibold.woff2' ? { contentType: 'font/woff2', body: fontSemibold }
        : resource === '/geist.woff2' ? { contentType: 'font/woff2', body: font }
        : { contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Starters</title><style>@font-face{font-family:Geist;src:url('/geist.woff2');font-weight:400}@font-face{font-family:Geist;src:url('/geist-semibold.woff2');font-weight:600}body{${variables};margin:0;background:var(--sf-bg-base);color:var(--sf-text-heading);font:16px/1.6 Geist,sans-serif}main,body>div>header,footer{width:min(1248px,calc(100% - 80px));margin:auto}header h1{font-size:20px}footer a{color:var(--sf-accent)}@media(max-width:600px){main,body>div>header,footer{width:calc(100% - 36px)}}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` });
    });
    const open = async (state = '') => {
      await page.goto(`http://starters.test/?locale=${locale}&variant=${variant}&state=${state}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
    };
    await open();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    const section = page.locator('[data-section="product-list/1"]');
    const cards = section.locator('article');
    await expect(cards).toHaveCount(3);
    await expect(section.locator('[data-price-kind="subscription"]')).toContainText('0 PLN / month');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await checkAccessibility(page);
      const boxes = await cards.evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, width: element.getBoundingClientRect().width })));
      const mobile = width <= 600;
      expect(Math.abs(boxes[0].x - (width - Math.min(1248, width - (mobile ? 36 : 80))) / 2)).toBeLessThanOrEqual(2);
      if (variant === 'detail-cards') {
        expect(Math.abs(boxes[1].x - (mobile ? boxes[0].x : boxes[0].x + boxes[0].width + 24))).toBeLessThanOrEqual(2);
        const image = await cards.first().locator('img').boundingBox();
        expect(Math.abs(image!.width / image!.height - 1.6)).toBeLessThan(.02);
        const padding = await cards.first().locator('h3').evaluate(element => getComputedStyle(element.parentElement!).paddingLeft);
        expect(padding).toBe(mobile ? '21px' : '23px');
      } else {
        expect(Math.abs(boxes[1].x - boxes[0].x)).toBeLessThanOrEqual(2);
        const image = await cards.first().locator('img').boundingBox();
        expect(image!.width).toBe(mobile ? 57 : 76);
        expect(image!.height).toBe(mobile ? 45 : 54);
      }
      if (width === 390 || width === 1440) {
        await testInfo.attach(`starters-${width}`, { body: await section.screenshot(), contentType: 'image/png' });
        if (locale === 'en' && theme === 'light') await expect(section).toHaveScreenshot(`product-list-${variant}-${width}.png`);
      }
    }
    await page.setViewportSize({ width: 768, height: 1100 });
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await checkAccessibility(page);
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await page.keyboard.press('Tab');
    await expect(cards.first().getByRole('link')).toBeFocused();
    expect(await page.locator(':focus').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    if (variant === 'compact') {
      await page.keyboard.press('Tab');
      const summary = cards.first().locator('summary');
      await expect(summary).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(cards.first().locator('details')).toHaveAttribute('open', '');
      await checkAccessibility(page);
      await page.keyboard.press('Space');
      await expect(cards.first().locator('details')).not.toHaveAttribute('open');
    }
    for (const state of ['long', 'missing', 'pwyw', 'bare', 'empty', 'unavailable']) {
      await open(state);
      if (state === 'long' && variant === 'compact') await cards.first().locator('summary').click();
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      if (state === 'empty' || state === 'unavailable') await expect(section).toHaveCount(0);
      else {
        await checkAccessibility(page);
        if (state === 'bare') await expect(section.getByRole('heading', { level: 2 })).toHaveCount(3);
      }
      const footer = await page.locator('footer').boundingBox();
      const sectionBox = await section.count() ? await section.boundingBox() : null;
      if (sectionBox) expect(footer!.y).toBeGreaterThanOrEqual(sectionBox.y + sectionBox.height);
    }
    expect(errors).toEqual([]);
    expect(requests.every(url => url.startsWith('http://starters.test/') || url === 'https://media.example.test/starter.png')).toBe(true);
  });
}
