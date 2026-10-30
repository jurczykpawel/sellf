/** Browser acceptance for the production marketing section, without shared DB writes. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { checkAccessibility } from './helpers/axe';
import en from '../src/messages/en.json';
import pl from '../src/messages/pl.json';

let script: string;
let css: string;
test.beforeAll(async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sellf-marketing-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/marketing-form.tsx', '--target=browser', '--outfile', path.join(directory, 'fixture.js')]);
    script = readFileSync(path.join(directory, 'fixture.js'), 'utf8');
    css = (await postcss([tailwindcss()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') })).css;
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const locale of ['en', 'pl'] as const) {
  for (const theme of ['light', 'dark']) {
    test(`${locale}/${theme}: responsive, keyboard, validation and reload @J120`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      const requests: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      const labels = (locale === 'pl' ? pl : en).admin.products.form.marketing;
      await page.route('http://marketing.test/**', route => route.fulfill(route.request().url().endsWith('/fixture.js')
        ? { contentType: 'application/javascript', body: script }
        : { contentType: 'text/html', body: `<!doctype html><html lang="${locale}" class="${theme}"><head><meta charset="utf-8"><title>Marketing fixture</title><style>${css}</style></head><body class="bg-sf-base"><div id="root"></div><script src="/fixture.js"></script></body></html>` }));
      await page.goto(`http://marketing.test/?locale=${locale}`);
      const editor = page.getByTestId('product-marketing');
      await expect(editor).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await page.setViewportSize({ width: 320, height: 1000 });
      await checkAccessibility(page);
      if (locale === 'pl') {
        await expect(editor.getByRole('status')).toContainText(labels.fallback.replace('{locale}', 'en'));
        await page.getByRole('button', { name: labels.addTranslation }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByLabel(labels.result, { exact: true })).toBeFocused();
      }
      const result = page.getByLabel(labels.result, { exact: true });
      await result.fill('ą'.repeat(241));
      await expect(editor.getByRole('alert')).toHaveText(labels.invalid);
      await page.getByRole('button', { name: 'Save fixture' }).click();
      expect(await page.evaluate(() => localStorage.getItem('marketing'))).toBeNull();
      await checkAccessibility(page);
      await result.fill('ą'.repeat(240));
      await page.getByLabel(labels.format, { exact: true }).selectOption('ebook');
      await page.getByRole('button', { name: labels.addTools, exact: true }).click();
      const tool = page.getByLabel(`${labels.tools} ${locale === 'en' ? 2 : 1}`, { exact: true });
      await expect(tool).toBeFocused();
      await tool.fill('Tool fixture');
      await page.getByRole('button', { name: labels.addRequirements, exact: true }).click();
      await page.getByLabel(`${labels.requirements} ${locale === 'en' ? 2 : 1}`, { exact: true }).fill('Requirement fixture');
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await checkAccessibility(page);
        if (width !== 768) {
          const screenshot = testInfo.outputPath(`editor-${width}.png`);
          await page.screenshot({ path: screenshot, fullPage: true });
          await testInfo.attach(`editor-${width}`, { path: screenshot, contentType: 'image/png' });
        }
      }
      await page.setViewportSize({ width: 768, height: 1000 });
      await page.evaluate(() => { document.body.style.zoom = '2'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await checkAccessibility(page);
      await page.evaluate(() => { document.body.style.zoom = ''; });
      await result.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(`${labels.tools} 1`, { exact: true })).toBeFocused();
      expect(await page.locator(':focus').evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
      await page.getByRole('button', { name: 'Save fixture' }).click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible();
      await page.reload();
      await expect(result).toHaveValue('ą'.repeat(240));
      await expect(page.getByLabel(labels.format, { exact: true })).toHaveValue('ebook');
      await expect(page.getByLabel(`${labels.tools} ${locale === 'en' ? 2 : 1}`, { exact: true })).toHaveValue('Tool fixture');
      await expect(page.getByLabel(`${labels.requirements} ${locale === 'en' ? 2 : 1}`, { exact: true })).toHaveValue('Requirement fixture');
      expect(errors).toEqual([]);
      expect(requests.every(url => url.startsWith('http://marketing.test/'))).toBe(true);
    });
  }
}
