/** Frozen D hero geometry and public-section browser acceptance. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { D_TOKENS } from '../src/lib/storefront-templates/fixtures';
import { heroProductCases } from './fixtures/storefront-sections/hero-product';
import { checkAccessibility } from './helpers/axe';
import type { Page } from '@playwright/test';

let pages: Record<string, string>;
let css: string;
const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2');
const diagram = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f0eee9"/><g fill="#075c43"><rect x="60" y="180" width="160" height="140" rx="12"/><rect x="320" y="180" width="160" height="140" rx="12"/><rect x="580" y="180" width="160" height="140" rx="12"/></g><path d="M220 250H320M480 250H580" stroke="#075c43" stroke-width="8"/></svg>';
test.beforeAll(() => {
  const directory = mkdtempSync(path.resolve('node_modules/.cache-hero-product-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/hero-product-render.tsx', '--target=node', '--packages=external', '--outdir', directory]);
    pages = JSON.parse(execFileSync('bun', [path.join(directory, 'hero-product-render.js')], { encoding: 'utf8' }));
    css = readFileSync(path.join(directory, 'hero-product-render.css'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function themeCss(theme: 'light' | 'dark'): string {
  const colors = D_TOKENS[theme];
  return `@font-face{font-family:FixtureGeist;src:url('/geist.woff2')}*{box-sizing:border-box}body{margin:0;background:${colors.background};color:${colors.foreground}}footer a{color:inherit}
  main{--sf-font-family:FixtureGeist;--sf-font-body-weight:400;--sf-font-heading-weight:600;--sf-text-heading:${colors.foreground};--sf-text-body:${colors.mutedForeground};--sf-accent:${colors.accent};--sf-accent-fg:${colors.accentForeground};--sf-bg-raised:${colors.muted};--sf-border:${colors.border};--sf-radius-sm:4px;--sf-radius-md:12px;--sf-radius-lg:16px}
  header{height:80px}@media(max-width:600px){header{height:72px}}`;
}

async function openFixture(page: Page, locale: 'en' | 'pl', theme: 'light' | 'dark', variant: 'split-process' | 'simple', name: string): Promise<void> {
  await page.route('https://media.example.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: diagram }));
  await page.route('http://hero.test/**', route => route.fulfill(route.request().url().endsWith('.woff2')
    ? { contentType: 'font/woff2', body: font }
    : { contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Hero fixture</title><style>${themeCss(theme)}${css}</style></head><body><header aria-label="Store header"></header><main>${pages[`${locale}/${variant}/${name}`]}</main><footer><a href="/${locale}/terms">${locale === 'pl' ? 'Regulamin' : 'Terms'}</a></footer></body></html>` }));
  await page.goto('http://hero.test/');
  await page.evaluate(() => document.fonts.ready);
}

for (const locale of ['en', 'pl'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const variant of ['split-process', 'simple'] as const) {
      test(`${locale}/${theme}/${variant}: states, responsive, keyboard and static media`, async ({ page }, testInfo) => {
        const requests: string[] = [];
        const errors: string[] = [];
        page.on('request', request => requests.push(request.url()));
        page.on('pageerror', error => errors.push(error.message));
        for (const [name, props] of Object.entries(heroProductCases(locale))) {
          await openFixture(page, locale, theme, variant, name);
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          await expect(page.locator('h1')).toHaveCount(1);
          await expect(page.locator('iframe,video,button')).toHaveCount(0);
          const section = page.locator('main section');
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          }
          await checkAccessibility(page);
          await page.setViewportSize({ width: 768, height: 1000 });
          await page.evaluate(() => { document.body.style.zoom = '2'; });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await checkAccessibility(page);
          await page.evaluate(() => { document.body.style.zoom = ''; });
          if (props.product?.availability === 'available') {
            await expect(section).toContainText(props.product.price.display);
            const action = section.getByRole('link');
            await expect(action).toHaveAttribute('href', props.product.actions.details);
            await page.keyboard.press('Tab');
            await expect(action).toBeFocused();
            expect(await action.evaluate(el => getComputedStyle(el).outlineWidth)).toBe('3px');
            await page.keyboard.press('Tab');
            await expect(page.locator('footer a')).toBeFocused();
            if (props.product.image) {
              const image = section.getByRole('img');
              await expect(image).toHaveAttribute('alt', props.product.image.alt);
              await expect(image).toHaveAttribute('width', '800');
              await expect(image).toHaveAttribute('height', '500');
              await expect(image).toHaveAttribute('fetchpriority', 'high');
              expect(await image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
            } else await expect(section.locator('figure')).toHaveCount(0);
          } else {
            await expect(section.getByRole('link')).toHaveCount(0);
            await expect(section.getByRole('img')).toHaveCount(0);
          }
          const footer = await page.locator('footer').boundingBox();
          const hero = await section.boundingBox();
          expect(footer!.y).toBeGreaterThanOrEqual(hero!.y + hero!.height - 1);
        }
        await openFixture(page, locale, theme, variant, 'paid');
        await page.setViewportSize({ width: 390, height: 1000 });
        const screenshot = testInfo.outputPath('hero-mobile.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        await testInfo.attach('hero-mobile', { path: screenshot, contentType: 'image/png' });
        expect(errors).toEqual([]);
        expect(requests.every(url => url.startsWith('http://hero.test/') || url === 'https://media.example.test/workshop.webp')).toBe(true);
        expect(requests.some(url => /\.js(?:\?|$)/.test(url))).toBe(false);
      });
    }
  }
}

test.describe('server first paint', () => {
  test.use({ javaScriptEnabled: false });
  for (const variant of ['split-process', 'simple'] as const) {
    for (const width of [390, 1440]) {
      test(`${variant}/${width}: frozen D structural geometry and synthetic screenshot`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1100 });
        await openFixture(page, 'en', 'light', variant, 'paid');
        const metrics = await page.locator('main section').evaluate(section => {
          const layout = section.firstElementChild!;
          const media = layout.querySelector('figure')!;
          const steps = section.querySelector('ol')!;
          const copy = layout.firstElementChild!;
          const box = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
          return { hero: box(section), layout: box(layout), copy: box(copy), media: box(media), steps: box(steps),
            padding: getComputedStyle(section).paddingTop, gap: getComputedStyle(layout).gap,
            columns: getComputedStyle(layout).gridTemplateColumns.split(' ').map(parseFloat),
            stepColumns: getComputedStyle(steps).gridTemplateColumns.split(' ').length,
            transform: getComputedStyle(media).transform };
        });
        // d-desktop-1440.png / d-mobile-390.png: original main hero, not hero-alt.
        // Geist, approved green tokens, synthetic copy/diagram replace concept assets.
        const mobile = width === 390;
        expect(Math.abs(metrics.hero.x - (mobile ? 18 : 96))).toBeLessThanOrEqual(2);
        expect(Math.abs(metrics.hero.width - (mobile ? 354 : 1248))).toBeLessThanOrEqual(2);
        expect(metrics.hero.y).toBe(mobile ? 72 : 80);
        expect(metrics.padding).toBe(mobile ? '29px' : '58px');
        expect(metrics.gap).toBe(mobile || variant === 'simple' ? '26px' : '62px');
        if (mobile || variant === 'simple') {
          expect(metrics.columns).toHaveLength(1);
          expect(Math.abs(metrics.media.y - metrics.copy.y - metrics.copy.height - 26)).toBeLessThanOrEqual(2);
          expect(metrics.transform).toBe('none');
        } else {
          expect(metrics.columns).toEqual([593, 593]);
          expect(metrics.media.x).toBeGreaterThan(metrics.copy.x + metrics.copy.width);
          expect(metrics.transform).not.toBe('none');
        }
        expect(metrics.stepColumns).toBe(mobile || variant === 'simple' ? 1 : 3);
        expect(metrics.steps.y).toBeGreaterThan(metrics.layout.y + metrics.layout.height);
        await expect(page.locator('main')).toHaveScreenshot(`hero-${variant}-${width}.png`, { animations: 'disabled' });
      });
    }
  }

});
