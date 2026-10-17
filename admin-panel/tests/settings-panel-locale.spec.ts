import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

let script: string;
let css: string;
test.beforeAll(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-settings-'));
  try {
    execFileSync('bun', ['-e', `
      const result = await Bun.build({ entrypoints: ['tests/fixtures/storefront-sections/settings-browser.tsx'], target: 'browser', outdir: ${JSON.stringify(directory)}, plugins: [{
        name: 'fixture-actions', setup(builder) {
          builder.onLoad({ filter: /lib\\/actions\\/security-audit\\.ts$/ }, () => ({ loader: 'js', contents: 'export async function getSecurityAudit(locale) { globalThis.panelCalls.push(locale); return globalThis.panelResult; } export const runSecurityAudit = getSecurityAudit;' }));
        }
      }] });
      if (!result.success) throw new Error(result.logs.map(String).join('\\n'));
    `]);
    script = readFileSync(path.join(directory, 'settings-browser.js'), 'utf8');
    css = (await postcss([tailwindcss()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
for (const locale of ['en', 'pl'] as const) {
  test(`${locale}: check details and rerun use the selected language`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.route('http://settings.test/**', route => route.fulfill(route.request().url().endsWith('/fixture.js')
      ? { contentType: 'application/javascript', body: script }
      : { contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Settings fixture</title><style>${css}</style></head><body><main id="root" style="max-width:1100px;margin:24px auto"></main><script src="/fixture.js"></script></body></html>` }));
    await page.goto(`http://settings.test/?locale=${locale}`);
    await expect(page.getByText(locale === 'pl' ? 'Ostrzeżenie' : 'Warning', { exact: true })).toBeVisible();
    await expect(page.getByText(locale === 'pl' ? 'Jak poprawić' : 'How to fix', { exact: true })).toBeVisible();
    await expect(page.getByText(/0-12\/13/)).toBeVisible();
    const row = page.getByRole('button', { name: locale === 'pl' ? /Liczba wierszy/ : /Row count/ });
    await row.click();
    await expect(page.getByText(/0-12\/13/)).toBeHidden();
    await row.click();
    await expect(page.getByText(/0-12\/13/)).toBeVisible();
    await page.getByRole('button', { name: locale === 'pl' ? 'Uruchom ponownie' : 'Run again' }).click();
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { panelCalls: string[] }).panelCalls)).toEqual([locale, locale]);
    expect(errors).toEqual([]);
  });
}
