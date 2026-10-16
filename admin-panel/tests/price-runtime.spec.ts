/** Byte parity for shared PLN formatting in Node and Chromium. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

let html: string;
let script: string;
let nodePrices: string[];

test.beforeAll(() => {
  const dir = mkdtempSync(path.resolve('node_modules/.cache-price-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/price-render.tsx', '--target=node', '--packages=external', '--outdir', dir]);
    const entry = path.join(dir, 'price-render.js');
    const output = execFileSync('node', ['--input-type=module', '-e', `
      import { createElement } from 'react';
      import { renderToString } from 'react-dom/server';
      import { PriceFixture } from ${JSON.stringify(entry)};
      console.log(JSON.stringify(renderToString(createElement(PriceFixture))));
    `], { encoding: 'utf8' });
    html = JSON.parse(output);
    nodePrices = [...html.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(match => match[1]);
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/price-browser.tsx', '--target=browser', '--outdir', dir]);
    script = readFileSync(path.join(dir, 'price-browser.js'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PLN prices render identical UTF-8 bytes in Node and Chromium', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setContent(`<div id="root">${html}</div>`);
  await page.addScriptTag({ content: script });
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.locator('#client [data-price]')).toHaveCount(4);
  const browserPrices = await page.locator('#client [data-price]').allTextContents();
  expect(await page.locator('#root [data-price]').allTextContents()).toEqual(browserPrices);
  expect(browserPrices).toHaveLength(4);
  expect(browserPrices.map(value => [...new TextEncoder().encode(value)]))
    .toEqual(nodePrices.map(value => [...new TextEncoder().encode(value)]));
  expect(errors).toEqual([]);
});
