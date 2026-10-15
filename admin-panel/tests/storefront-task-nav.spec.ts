/** Finder geometry, keyboard, and public fixture checks. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { D_TOKENS } from '../src/lib/storefront-templates/fixtures';
import { checkAccessibility } from './helpers/axe';

const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2').toString('base64');
let script: string;
let css: string;
test.beforeAll(() => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-task-nav-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/task-nav-browser.tsx', '--target=browser', '--outdir', directory]);
    script = readFileSync(path.join(directory, 'task-nav-browser.js'), 'utf8');
    css = readFileSync(path.join(directory, 'task-nav-browser.css'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const locale of ['en', 'pl'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`${locale}/${theme}: finder matrix`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    const tokens = D_TOKENS[theme];
    const variables = `--sf-bg-base:${tokens.background};--sf-bg-raised:${tokens.muted};--sf-text-heading:${tokens.foreground};--sf-text-body:${tokens.mutedForeground};--sf-accent:${tokens.accent};--sf-border:${tokens.border};--sf-font-family:Geist;--sf-font-heading-weight:600;--sf-radius-sm:4px;--sf-radius-md:12px`;
    await page.route('http://task-nav.test/**', route => route.fulfill(route.request().url().endsWith('/fixture.js')
      ? { contentType: 'application/javascript', body: script }
      : { contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Task fixture</title><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}a{color:var(--sf-accent)}body{margin:0;${variables};font:16px/1.6 Geist;background:var(--sf-bg-base);color:var(--sf-text-heading)}h1{margin:0}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` }));
    await page.goto(`http://task-nav.test/?locale=${locale}`);
    const finder = page.getByRole('region', { name: locale === 'pl' ? 'Co chcesz zbudować?' : 'What do you want to build?' });
    const links = finder.getByRole('link');
    const search = finder.getByRole('searchbox');
    await expect(links).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('h1')).toHaveCount(1);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await checkAccessibility(page);
      const geometry = await finder.evaluate(element => {
        const form = element.querySelector('form')!.getBoundingClientRect();
        const nav = element.querySelector('nav')!.getBoundingClientRect();
        const cards = [...element.querySelectorAll('nav a')].map(a => a.getBoundingClientRect());
        return { form: { x: form.x, width: form.width, height: form.height }, gap: nav.y - form.bottom,
          first: { y: cards[0].y, height: cards[0].height, width: cards[0].width }, ys: cards.map(c => c.y),
          padding: parseFloat(getComputedStyle(element).paddingTop) };
      });
      // Frozen d/index.html + d.css finder geometry; approved tokens/type and synthetic copy differ.
      const expectedWidth = Math.min(1248, width - (width <= 600 ? 36 : 80));
      expect(Math.abs(geometry.form.x - (width - expectedWidth) / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.form.width - expectedWidth)).toBeLessThanOrEqual(2);
      expect(Math.abs(geometry.form.height - (width <= 600 ? 56 : 58))).toBeLessThanOrEqual(2);
      expect(geometry.gap).toBe(width <= 600 ? 14 : 18);
      expect(geometry.padding).toBe(width <= 600 ? 27 : 34);
      const finderBox = await finder.boundingBox();
      const termsBox = await page.locator('footer a').boundingBox();
      expect(termsBox!.y).toBeGreaterThanOrEqual(finderBox!.y + finderBox!.height);
      await expect(page.locator('footer a')).toBeVisible();
      expect(geometry.first.height).toBe(width <= 600 ? 116 : 135);
      expect(geometry.ys[1]).toBe(geometry.ys[0]);
      expect(geometry.ys[2] > geometry.ys[0]).toBe(width <= 600);
      if (width === 390 || width === 1440) {
        await expect(finder).toHaveScreenshot(`finder-${locale}-${theme}-${width}.png`);
        const screenshot = testInfo.outputPath(`finder-${width}.png`);
        await finder.screenshot({ path: screenshot });
        await testInfo.attach(`finder-${width}`, { path: screenshot, contentType: 'image/png' });
      }
    }
    await search.focus();
    await page.keyboard.press('Tab');
    await expect(finder.getByRole('button')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(links.first()).toBeFocused();
    expect(await links.first().evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(links.first()).toBeFocused();
    await expect(links.first()).toHaveAttribute('aria-current', 'true');
    await expect(finder.getByRole('status')).toContainText(locale === 'pl' ? 'Faktury' : 'Invoices');
    await expect(page.locator('#catalogue').getByRole('status')).toContainText('1 ');
    await search.fill('a'.repeat(101));
    await search.press('Enter');
    expect(await search.evaluate(element => (element as HTMLInputElement).validity.valid)).toBe(false);
    await expect(page.locator('#catalogue').getByRole('status')).toContainText('1 ');
    await search.fill('no matching category');
    await search.press('Enter');
    await expect(search).toBeFocused();
    await expect(page.locator('#catalogue').getByRole('status')).toContainText('0 ');
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await checkAccessibility(page);
    await page.goto(`http://task-nav.test/?locale=${locale}&long&count=12`);
    await expect(links).toHaveCount(12);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await checkAccessibility(page);
    await page.goto(`http://task-nav.test/?locale=${locale}&count=0`);
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await page.goto(`http://task-nav.test/?locale=${locale}&fallback`);
    await links.first().click();
    await expect(page).toHaveURL(/\?category=11111111-1111-4111-8111-000000000000#catalogue$/);
    expect(errors).toEqual([]);
    expect(requests.every(url => url.startsWith('http://task-nav.test/'))).toBe(true);
  });
}
