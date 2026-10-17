/** Revenue filters retain their controls without widening the dashboard. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2').toString('base64');
let script: string;
let css: string;
test.beforeAll(() => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-dashboard-layout-'));
  try {
    execFileSync('bun', ['-e', `
      const mocks = {
        '@/lib/actions/analytics': 'export const getSalesChartData = async () => []; export const getHourlyRevenueStats = async () => [];',
        'next/navigation': 'const params = new URLSearchParams(); export const useSearchParams = () => params;',
        '@/contexts/RealtimeContext': 'const context = { addRefreshListener() {}, removeRefreshListener() {} }; export const useRealtime = () => context;',
        '@/contexts/UserPreferencesContext': 'const preferences = { hideValues: false, currencyViewMode: "grouped", displayCurrency: null }; export const useUserPreferences = () => preferences;',
        '@/hooks/useCurrencyConversion': 'const convertMultipleCurrencies = async () => []; export const useCurrencyConversion = () => ({ convertMultipleCurrencies });',
      };
      const result = await Bun.build({ entrypoints: ['tests/fixtures/dashboard-chart-browser.tsx'], target: 'browser', outdir: ${JSON.stringify(directory)},
        plugins: [{ name: 'dashboard-data', setup(build) {
          build.onResolve({ filter: new RegExp('^(' + Object.keys(mocks).map(name => name.split('/').join('\\\\/')).join('|') + ')$') }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
        }}] });
      if (!result.success) throw new Error(result.logs.join('\\n'));
    `]);
    script = readFileSync(path.join(directory, 'dashboard-chart-browser.js'), 'utf8');
    css = execFileSync('bun', ['-e', `
      import postcss from 'postcss'; import tailwind from '@tailwindcss/postcss';
      const from = ${JSON.stringify(path.resolve('src/app/globals.css'))};
      const result = await postcss([tailwind()]).process(await Bun.file(from).text(), { from });
      process.stdout.write(result.css);
    `], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const locale of ['en', 'pl']) {
  test(`${locale}: dashboard date range fits mobile and remains editable`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://dashboard.test/**', route => route.fulfill(route.request().url().endsWith('/fixture.js')
      ? { contentType: 'application/javascript', body: script }
      : { contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font});font-weight:100 900}:root{--font-geist-sans:Geist}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` }));
    await page.goto(`https://dashboard.test/?locale=${locale}`);
    const dates = page.locator('input[type="date"]');
    const clear = page.getByRole('button', { name: locale === 'pl' ? 'Wyczyść' : 'Clear', exact: true });
    await expect(clear).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [390, 320, 640, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
        controls: [...document.querySelectorAll('input,button')].map(element => { const rect = element.getBoundingClientRect(); return { text: element.getAttribute('aria-label') ?? element.textContent, x: rect.x, right: rect.right }; }) }));
      expect(geometry.document, JSON.stringify(geometry)).toBeLessThanOrEqual(width);
      for (const control of geometry.controls) { expect(control.x).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width); }
      await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`), fullPage: true });
    }
    await dates.nth(0).fill('2026-01-01');
    await dates.nth(1).fill('2026-02-01');
    await expect(dates.nth(0)).toHaveValue('2026-01-01');
    await expect(dates.nth(1)).toHaveValue('2026-02-01');
    await clear.click();
    await expect(dates.nth(0)).toHaveValue('');
    await expect(dates.nth(1)).toHaveValue('');
    await expect(clear).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
