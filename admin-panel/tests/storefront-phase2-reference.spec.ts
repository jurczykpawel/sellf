/** Twelve compressed references; both locales retain geometry/network checks. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { referencePage } from './fixtures/storefront-sections/phase2/reference';
import sources from './fixtures/storefront-sections/phase2/sources.json';

const css = readFileSync('tests/fixtures/storefront-sections/phase2/reference.css', 'utf8');
const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2');
const sample = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#e8eefb"/><g fill="#244b9a"><rect x="70" y="150" width="170" height="150" rx="12"/><rect x="315" y="150" width="170" height="150" rx="12"/><rect x="560" y="150" width="170" height="150" rx="12"/></g><path d="M240 225H315M485 225H560" stroke="#244b9a" stroke-width="8"/></svg>';
const screenshotOptions = { threshold: sources.pixelThreshold, maxDiffPixelRatio: sources.maxDiffPixelRatio, animations: 'disabled' as const };
let offerPages: Record<string, string>;
let offerCss: string;
test.beforeAll(() => {
  const directory = mkdtempSync(path.resolve('node_modules/.cache-phase2-offer-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/phase2/offer-render.tsx', '--target=node', '--packages=external', '--outdir', directory]);
    offerPages = JSON.parse(execFileSync('bun', [path.join(directory, 'offer-render.js')], { encoding: 'utf8' }));
    offerCss = readFileSync(path.join(directory, 'offer-render.css'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
for (const concept of ['a', 'b', 'c', 'offer'] as const) for (const locale of ['en', 'pl'] as const) {
  test(`${concept}/${locale}: desktop, mobile and card references`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://phase2.test') return route.abort();
      if (url.pathname === '/geist.woff2') return route.fulfill({ contentType: 'font/woff2', body: font });
      if (url.pathname === '/sample.svg') return route.fulfill({ contentType: 'image/svg+xml', body: sample });
      const html = concept === 'offer'
        ? `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Core offer reference</title><style>${css}${offerCss}</style></head><body>${offerPages[locale]}</body></html>`
        : referencePage(concept, locale, css);
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('http://phase2.test/');
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('iframe,video,script')).toHaveCount(0);
    if (concept !== 'offer') {
      await expect(page.locator('.product')).toHaveCount(concept === 'b' ? 6 : 3);
      await expect(page.locator('.catalog-item')).toHaveCount(12);
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const hero = page.locator(concept === 'offer' ? 'main > section' : '.hero.wrap').first();
      const wrap = await hero.boundingBox();
      expect(Math.abs(wrap!.width - (width === 1440 ? 1248 : 354))).toBeLessThanOrEqual(sources.structuralTolerancePx);
      await page.screenshot({ path: `/tmp/t2-4-${concept}-${locale}-${width}.png`, fullPage: true });
      if (locale === 'pl') await expect(page).toHaveScreenshot(`${concept}-${width === 1440 ? 'desktop-1440' : 'mobile-390'}.png`, { ...screenshotOptions, fullPage: true });
      if (width === 1440) {
        const card = page.locator(concept === 'offer' ? '[data-offer-card]' : '.product').first();
        if (concept !== 'offer') {
          const box = await card.boundingBox();
          expect(Math.abs(box!.width - 400)).toBeLessThanOrEqual(sources.structuralTolerancePx);
          await card.locator('summary').click();
        }
        if (locale === 'pl') await expect(card).toHaveScreenshot(`${concept}-card-detail.png`, screenshotOptions);
        if (concept !== 'offer') await card.locator('summary').click();
      }
    }
    expect(requests.every(url => url.startsWith('http://phase2.test/'))).toBe(true);
  });
}
