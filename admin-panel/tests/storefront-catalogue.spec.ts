/** Catalogue geometry and browser contract. @see fixtures/storefront-sections/catalogue.ts */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { checkAccessibility } from './helpers/axe';
import { catalogueProduct } from './fixtures/storefront-sections/catalogue';
import { D_TOKENS } from '../src/lib/storefront-templates/fixtures';
import { catalogueLabels } from '../src/lib/storefront-templates/catalogue-section';

let script: string;
let css: string;
test.beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sellf-catalogue-'));
  try {
    execFileSync('/tmp/bun-1314/bun-darwin-aarch64/bun', [
      '-e',
      `
      const result=await Bun.build({entrypoints:['tests/fixtures/storefront-sections/catalogue-browser.tsx'],target:'browser',outdir:${JSON.stringify(dir)},naming:'fixture.[ext]',define:{'process.env':'{"NODE_ENV":"production"}'},plugins:[{name:'next-image-esm',setup(build){build.onResolve({filter:/^next\\/image$/},()=>({path:${JSON.stringify(path.resolve('tests/fixtures/storefront-sections/catalogue-image.ts'))}}));}}]});
      if(!result.success){console.error(result.logs);process.exit(1);}
    `,
    ]);
    script = readFileSync(path.join(dir, 'fixture.js'), 'utf8');
    css =
      (
        await postcss([tailwindcss()]).process(readFileSync('src/app/globals.css', 'utf8'), {
          from: path.resolve('src/app/globals.css'),
        })
      ).css + readFileSync(path.join(dir, 'fixture.css'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
for (const locale of ['en', 'pl'] as const)
  for (const theme of ['light', 'dark'])
    for (const variant of ['detail-cards', 'default-groups'] as const) {
      test(`${locale}/${theme}/${variant}: geometry, accessibility and bounded navigation`, async ({
        page,
      }, testInfo) => {
        const errors: string[] = [];
        const hosts: string[] = [];
        const inputs: Record<string, unknown>[] = [];
        page.on('pageerror', (error) => {
          errors.push(error.message);
          console.error(error.message);
        });
        page.on('request', (request) => hosts.push(new URL(request.url()).host));
        let fail = false;
        let empty = false;
        await page.route('https://catalogue.test/**', async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname === '/fixture.js')
            return route.fulfill({ contentType: 'application/javascript', body: script });
          if (url.pathname === '/font.woff2')
            return route.fulfill({
              contentType: 'font/woff2',
              body: readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2'),
            });
          if (url.pathname === '/cover.svg')
            return route.fulfill({
              contentType: 'image/svg+xml',
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#dceade"/></svg>',
            });
          if (url.pathname === '/api/storefront/catalogue') {
            const input = JSON.parse(url.searchParams.get('input')!);
            inputs.push(input);
            if (fail) return route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } });
            // Models a 100k server dataset without putting it in browser state.
            const start =
              input.cursor && String(input.cursor).startsWith('cursor-')
                ? Number(String(input.cursor).slice(7))
                : input.cursor
                  ? 9
                  : 0;
            const size = Number(input.pageSize);
            const matching = [];
            for (let index = start + 1; index <= 100000 && matching.length <= size; index++) {
              const product = catalogueProduct(index);
              product.marketing.format = index % 3 === 0 ? 'ebook' : 'workshop';
              if (input.group === 'free' && product.price.kind !== 'free') continue;
              if (input.group === 'paid' && product.price.kind === 'free') continue;
              if (input.group === 'featured' && index % 5 !== 1) continue;
              if (
                input.search &&
                !product.title.toLowerCase().includes(String(input.search).trim().normalize('NFC').toLowerCase())
              )
                continue;
              if (input.priceKind && product.price.kind !== input.priceKind) continue;
              if (input.format && product.marketing.format !== input.format) continue;
              if (input.categoryIds.length && index % 2 !== 0) continue;
              matching.push(product);
            }
            const products = empty ? [] : matching.slice(0, size);
            expect(products.length).toBeLessThanOrEqual(size);
            return route.fulfill({
              json: {
                products,
                nextCursor:
                  !empty && matching.length > size ? `cursor-${Number(products.at(-1)!.slug.slice(8))}` : null,
              },
            });
          }
          const tokens = theme === 'dark' ? D_TOKENS.dark : D_TOKENS.light;
          const approvedTokens =
            variant === 'detail-cards'
              ? `:root:not(.dark),:root.dark{--sf-bg-base:${tokens.background};--sf-bg-raised:${tokens.background};--sf-text-heading:${tokens.foreground};--sf-text-body:${tokens.mutedForeground};--sf-text-muted:${tokens.mutedForeground};--sf-accent:${tokens.accent};--sf-border:${tokens.border};--sf-radius-md:12px}`
              : '';
          return route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html lang="${locale}" class="${theme}"><head><meta charset="utf-8"><title>Catalogue fixture</title><style>${css} ${approvedTokens} @font-face{font-family:Geist;src:url(/font.woff2) format('woff2')}body{font-family:Geist,sans-serif}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
          });
        });
        const labels = catalogueLabels[locale];
        await page.goto(`https://catalogue.test/?locale=${locale}&variant=${variant}&media=1`);
        await expect(page.getByRole('heading', { name: labels.title })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('h1')).toHaveCount(1);
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await checkAccessibility(page);
          const grid = page.locator('article').first().locator('..');
          if (variant === 'detail-cards') {
            const boxes = await grid.locator('article').evaluateAll((elements) =>
              elements.slice(0, 3).map((e) => {
                const r = e.getBoundingClientRect();
                return { x: r.x, y: r.y, w: r.width };
              }),
            );
            const columns = width > 950 ? 3 : width > 600 ? 2 : 1;
            const wrapWidth = Math.min(1248, width - (width <= 600 ? 36 : 80));
            expect(Math.abs(boxes[0].x - (width - wrapWidth) / 2)).toBeLessThanOrEqual(2);
            expect(
              Math.abs(boxes[0].w - (wrapWidth - (columns - 1) * (width <= 600 ? 22 : 24)) / columns),
            ).toBeLessThanOrEqual(2);
            if (columns > 1) expect(Math.abs(boxes[1].x - boxes[0].x - boxes[0].w - 24)).toBeLessThanOrEqual(2);
            // Frozen d-card-detail.png / d-desktop-1440-qa-2.png geometry; approved Geist/D tokens and synthetic copy replace concept content.
            const body = page.locator('article').first().locator('> div').last();
            expect(await body.evaluate((e) => Number.parseFloat(getComputedStyle(e).paddingLeft))).toBe(
              width <= 600 ? 21 : 23,
            );
            expect(
              await page
                .locator('article h3')
                .first()
                .evaluate((e) => getComputedStyle(e).fontSize),
            ).toBe('23px');
            const image = await page.locator('article img').first().boundingBox();
            expect(Math.abs(image!.width / image!.height - 1.6)).toBeLessThan(0.02);
          }
          if (width === 390 || width === 1440) {
            const screenshot = testInfo.outputPath(`catalogue-${width}.png`);
            await page.screenshot({ path: screenshot, fullPage: true });
            await testInfo.attach(`catalogue-${width}`, { path: screenshot, contentType: 'image/png' });
          }
        }
        await page.setViewportSize({ width: 768, height: 1000 });
        await page.evaluate(() => {
          document.body.style.zoom = '2';
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await checkAccessibility(page);
        await page.evaluate(() => {
          document.body.style.zoom = '';
        });
        const search = page.getByRole('searchbox');
        await search.focus();
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: labels.submit, exact: true })).toBeFocused();
        expect(await page.locator(':focus').evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');
        const more = page.getByRole('button', {
          name: variant === 'detail-cards' ? labels.more : labels.moreFree,
          exact: true,
        });
        await more.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { name: 'Product 10', exact: true })).toBeFocused();
        expect(inputs.at(-1)).toMatchObject({ pageSize: 9, group: variant === 'detail-cards' ? 'all' : 'free' });
        await search.fill('Product');
        await page.getByRole('button', { name: labels.submit, exact: true }).click();
        await expect(page.getByRole('status')).toContainText(labels.shown);
        expect(inputs.slice(variant === 'detail-cards' ? -1 : -3).every((input) => input.cursor === null)).toBe(true);
        await page.getByRole('checkbox', { name: 'Reports' }).check();
        await expect(page.getByRole('status')).toContainText(labels.shown);
        expect(inputs.at(-1)?.categoryIds).toEqual(['55555555-5555-4555-8555-555555555555']);
        await page.getByRole('checkbox', { name: 'Reports' }).uncheck();
        await page.getByRole('combobox', { name: labels.format, exact: true }).selectOption('ebook');
        await expect(page.getByRole('status')).toContainText(labels.shown);
        expect(inputs.at(-1)?.format).toBe('ebook');
        const price = page.getByRole('combobox', { name: labels.price, exact: true });
        await price.focus();
        await price.selectOption('subscription');
        await expect(page.getByRole('status')).toContainText(labels.shown);
        await expect(price).toBeFocused();
        fail = true;
        await page.getByRole('button', { name: labels.submit, exact: true }).click();
        await expect(page.getByRole('alert')).toContainText(labels.error);
        await expect(page.locator('article')).toHaveCount(0);
        await checkAccessibility(page);
        fail = false;
        empty = true;
        await page.getByRole('button', { name: labels.retry }).click();
        await expect(page.getByRole('status')).toHaveText(labels.empty);
        await checkAccessibility(page);
        for (const size of [12, 24]) {
          empty = false;
          await page.goto(`https://catalogue.test/?locale=${locale}&variant=${variant}&size=${size}&long=1`);
          await expect(page.getByRole('heading', { name: labels.title })).toBeVisible();
          await page.setViewportSize({ width: 320, height: 1000 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await expect(page.locator('img')).toHaveCount(0);
          await checkAccessibility(page);
          await page.getByRole('button', { name: labels.reset }).click();
          await expect(page.getByRole('status')).toContainText(labels.shown);
          expect(
            inputs
              .slice(variant === 'detail-cards' ? -1 : -3)
              .every((input) => input.pageSize === size && input.cursor === null),
          ).toBe(true);
          const articles = page.locator('article');
          await expect(articles).toHaveCount(size * (variant === 'detail-cards' ? 1 : 3));
          const disclosure = page.locator('summary').first();
          await disclosure.focus();
          await page.keyboard.press('Enter');
          await expect(page.locator('details').first()).toHaveAttribute('open', '');
          await page.keyboard.press('Enter');
          await expect(page.locator('details').first()).not.toHaveAttribute('open', '');
        }
        expect(errors).toEqual([]);
        expect(hosts.every((host) => host === 'catalogue.test')).toBe(true);
      });
    }
