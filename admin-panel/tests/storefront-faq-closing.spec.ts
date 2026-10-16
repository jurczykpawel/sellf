/** FAQ/closing reference geometry, first paint and keyboard checks. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { D_TOKENS } from '../src/lib/storefront-templates/fixtures';
import { checkAccessibility } from './helpers/axe';

const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2').toString('base64');
const markup: Record<string, string> = {};
let css: string;
test.beforeAll(() => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-faq-closing-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/faq-closing-render.tsx', '--target=bun', '--outdir', directory]);
    css = readFileSync(path.join(directory, 'faq-closing-render.css'), 'utf8');
    for (const locale of ['en', 'pl']) for (const state of ['normal', 'long', 'empty', 'missing', 'unavailable', 'free', 'subscription', 'pwyw', 'buy']) {
      markup[`${locale}/${state}`] = execFileSync('bun', [path.join(directory, 'faq-closing-render.js'), locale, state], { encoding: 'utf8' });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
function html(locale: 'en' | 'pl', theme: 'light' | 'dark', state = 'normal') {
  const t = D_TOKENS[theme];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Section fixture</title><style>
  @font-face{font-family:Geist;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
  *{box-sizing:border-box}body{margin:0;--sf-bg-base:${t.background};--sf-bg-raised:${t.muted};--sf-text-heading:${t.foreground};--sf-text-body:${t.mutedForeground};--sf-accent:${t.accent};--sf-accent-foreground:${t.accentForeground};--sf-border:${t.border};--sf-font-family:Geist;--sf-font-heading-weight:600;--sf-radius-md:12px;font:16px/1.6 Geist;background:${t.background};color:${t.foreground}}h1{margin:0}footer{padding:32px;display:flex;gap:24px}footer a{color:${t.accent};min-height:44px}a:focus-visible{outline:3px solid ${t.accent}}${css}</style></head><body>${markup[`${locale}/${state}`]}</body></html>`;
}
for (const locale of ['en', 'pl'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`${locale}/${theme}: FAQ and closing matrix`, async ({ page }) => {
    const errors: string[] = [], requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('http://sections.test/**', route => route.fulfill({ contentType: 'text/html', body: html(locale, theme, new URL(route.request().url()).searchParams.get('state') ?? 'normal') }));
    await page.goto('http://sections.test/');
    const faq = page.locator('section').first(), closing = page.locator('section').nth(1);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await page.locator('h1,h2,h3').evaluateAll(nodes => nodes.map(n => n.tagName))).toEqual(['H1', 'H2', 'H2', 'H3']);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await checkAccessibility(page);
      const geometry = await page.locator('section > div').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(), style = getComputedStyle(node), section = getComputedStyle(node.parentElement!);
        return { x: box.x, width: box.width, gap: style.columnGap, columns: style.gridTemplateColumns, padding: parseFloat(section.paddingTop) };
      }));
      const wrap = Math.min(1248, width - (width <= 600 ? 36 : 80));
      for (const g of geometry) { expect(Math.abs(g.x - (width - wrap) / 2)).toBeLessThanOrEqual(2); expect(Math.abs(g.width - wrap)).toBeLessThanOrEqual(2); }
      expect(geometry[0].padding).toBe(width <= 600 ? 52 : 88);
      expect(geometry[1].padding).toBe(width <= 600 ? 38 : 60);
      if (width > 600) {
        expect(geometry[0].gap).toBe('90px');
        expect(geometry[1].gap).toBe(width <= 950 ? '50px' : '120px');
        const [a,b] = geometry[0].columns.split(' ').map(parseFloat);
        expect(Math.abs(a / b - .85 / 1.4)).toBeLessThan(.01);
        const [c,d] = geometry[1].columns.split(' ').map(parseFloat);
        expect(Math.abs(c / d - 1.4)).toBeLessThan(.01);
      }
      const summary = await page.locator('summary').first().boundingBox();
      expect(summary!.height).toBeCloseTo(width <= 600 ? 59.59 : 66.39, 0);
      const footer = await page.locator('footer').boundingBox(), cta = await closing.boundingBox();
      expect(footer!.y).toBeGreaterThanOrEqual(cta!.y + cta!.height);
      if (width === 390 || width === 1440) {
        await expect(faq).toHaveScreenshot(`faq-${locale}-${theme}-${width}.png`);
        await expect(closing).toHaveScreenshot(`closing-${locale}-${theme}-${width}.png`);
      }
    }
    const summary = page.locator('summary').first(), details = page.locator('details').first();
    await summary.focus();
    expect(await summary.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter'); await expect(details).toHaveAttribute('open', '');
    await expect(summary).toBeFocused(); await checkAccessibility(page);
    await page.keyboard.press('Space'); await expect(details).not.toHaveAttribute('open');
    await page.keyboard.press('Tab'); await expect(page.locator('summary').nth(1)).toBeFocused();
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await expect(closing.getByRole('link')).toBeFocused();
    await expect(closing.getByRole('link')).toHaveAttribute('href', `/${locale}/p/example-workshop`);
    await page.keyboard.press('Tab'); await expect(page.locator('footer a').first()).toBeFocused();
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkAccessibility(page);
    for (const state of ['long', 'empty', 'missing', 'unavailable', 'free', 'subscription', 'pwyw', 'buy']) {
      await page.goto(`http://sections.test/?state=${state}`);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await checkAccessibility(page);
      if (state === 'long') { await expect(page.locator('details')).toHaveCount(20); await page.locator('summary').first().click(); await checkAccessibility(page); }
      if (state === 'empty') { await expect(page.locator('details')).toHaveCount(0); await expect(page.locator('section p')).toHaveCount(0); }
      if (state === 'missing') await expect(page.locator('section')).toHaveCount(1);
      if (state === 'unavailable') await expect(page.locator('section a')).toHaveCount(0);
      if (state === 'buy') await expect(closing.getByRole('link')).toHaveAttribute('href', `/${locale}/checkout/example-workshop`);
    }
    expect(errors).toEqual([]); expect(requests.every(url => url.startsWith('http://sections.test/'))).toBe(true);
  });
}
test('native disclosures work with JavaScript disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 1000 } });
  const page = await context.newPage();
  await page.route('http://sections.test/**', route => route.fulfill({ contentType: 'text/html', body: html('en', 'light') }));
  await page.goto('http://sections.test/');
  await expect(page.locator('h2')).toHaveCount(2);
  await page.locator('summary').first().focus(); await page.keyboard.press('Enter');
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  await context.close();
});
