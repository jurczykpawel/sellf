/** C hero geometry and shared accessibility/network harness. @see docs/templates/phase2-contracts.md */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { referencePage } from './fixtures/storefront-sections/phase2/reference';
import { checkAccessibility } from './helpers/axe';

const referenceCss = readFileSync('tests/fixtures/storefront-sections/phase2/reference.css', 'utf8');
const font = readFileSync('node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2');
const portrait = '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="484"><rect width="440" height="484" fill="#e8e5de"/><circle cx="220" cy="155" r="70" fill="#244b9a"/><path d="M70 484V360a150 150 0 0 1 300 0v124" fill="#244b9a"/></svg>';
let script: string; let css: string;
test.beforeAll(() => {
  const directory = mkdtempSync(path.resolve('node_modules/.cache-t214-'));
  try {
    execFileSync('bun', ['-e', `const r=await Bun.build({entrypoints:['tests/fixtures/storefront-sections/phase2/author-browser.tsx'],target:'browser',outdir:${JSON.stringify(directory)},define:{'process.env':'{"NODE_ENV":"production"}'},plugins:[{name:'image',setup(b){b.onResolve({filter:/^next\\/image$/},()=>({path:${JSON.stringify(path.resolve('tests/fixtures/storefront-sections/catalogue-image.ts'))}}));}}]});if(!r.success){console.error(r.logs);process.exit(1)}`]);
    script = readFileSync(path.join(directory, 'author-browser.js'), 'utf8');
    css = readFileSync(path.join(directory, 'author-browser.css'), 'utf8');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
const tokens = '--sf-font-family:FixtureGeist;--sf-bg-base:#fff;--sf-bg-raised:#e8e5de;--sf-text-heading:#17191f;--sf-text-body:#555d69;--sf-accent:#244b9a;--sf-accent-fg:#fff;--sf-border:#b9c5d9;--sf-radius-md:8px';
for (const locale of ['en', 'pl'] as const) test(`${locale}: C author hero and edge states`, async ({ page, context }) => {
  const requests: string[] = []; const errors: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://phase2.test') return route.abort();
    if (url.pathname === '/geist.woff2') return route.fulfill({ contentType: 'font/woff2', body: font });
    if (url.pathname === '/sample.svg') return route.fulfill({ contentType: 'image/svg+xml', body: portrait });
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: script });
    if (url.pathname === '/reference') return route.fulfill({ contentType: 'text/html', body: referencePage('c', locale, referenceCss) });
    const dark = url.searchParams.has('dark') ? '--sf-bg-base:#141820;--sf-bg-raised:#1c2636;--sf-text-heading:#f6f7fb;--sf-text-body:#cbd2df;--sf-accent:#a5c6ff;--sf-accent-fg:#141820;--sf-border:#758399;' : '';
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Author hero</title><style>@font-face{font-family:FixtureGeist;src:url(/geist.woff2)}*{box-sizing:border-box}body{margin:0;${tokens};${dark}font:15px/1.6 FixtureGeist;background:${dark ? 'var(--sf-bg-base)' : '#f7f5ef'};color:var(--sf-text-heading)}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` });
  });
  const reference = await context.newPage();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await reference.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto(`https://phase2.test/?locale=${locale}`);
    await reference.goto('https://phase2.test/reference');
    // Frozen author grammar has no author-note/caption body; core owns action labels.
    await reference.locator('.author-note, .portrait small').evaluateAll(elements => elements.forEach(element => element.remove()));
    await reference.locator('.actions .button').first().evaluate((element, text) => { element.textContent = text; }, await page.locator('[data-section] a').first().textContent());
    await page.evaluate(() => document.fonts.ready);
    await reference.evaluate(() => document.fonts.ready);
    const hero = page.locator('[data-section]');
    await expect(hero.locator('h1')).toHaveCount(1);
    for (const [actualSelector, expectedSelector] of [['h1', 'h1'], ['img', 'img']] as const) {
      const actual = await hero.locator(actualSelector).boundingBox();
      const expected = await reference.locator(`[data-crop=hero] ${expectedSelector}`).boundingBox();
      const actualHero = await hero.boundingBox(); const expectedHero = await reference.locator('[data-crop=hero]').boundingBox();
      for (const key of ['width', 'height'] as const) expect(Math.abs(actual![key] - expected![key]), `${width} ${actualSelector} ${key}`).toBeLessThanOrEqual(2);
      expect(Math.abs(actual!.x - expected!.x), `${width} ${actualSelector} x`).toBeLessThanOrEqual(2);
      expect(Math.abs(actual!.y - actualHero!.y - expected!.y + expectedHero!.y), `${width} ${actualSelector} y`).toBeLessThanOrEqual(2);
    }
    if (locale === 'pl') await expect(hero).toHaveScreenshot(`c-hero-${width}.png`, { threshold: .2, maxDiffPixelRatio: .005, animations: 'disabled' });
    await page.screenshot({ path: `/tmp/t2-14-${locale}-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await checkAccessibility(page);
  }
  await reference.close();
  const links = page.locator('[data-section] a');
  for (const [index, target] of ['paths', 'catalogue'].entries()) {
    await links.nth(index).focus();
    expect(await links.nth(index).evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#${target}$`));
  }
  for (const state of ['empty', 'blank', 'no-eyebrow', 'no-media', 'unresolved-media', 'long', 'hostile']) for (const dark of [false, true]) {
    await page.goto(`https://phase2.test/?locale=${locale}&state=${state}${dark ? '&dark' : ''}`);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${state}/${width}`).toBe(width);
    }
    if (state === 'no-eyebrow') {
      await page.setViewportSize({ width: 390, height: 844 });
      const image = await page.locator('[data-section] img').boundingBox();
      const heading = await page.locator('h1').boundingBox();
      expect(heading!.y).toBeGreaterThanOrEqual(image!.y + image!.height);
    }
    await checkAccessibility(page);
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768);
    await checkAccessibility(page);
  }
  expect(errors).toEqual([]);
  expect(requests.every(url => url.startsWith('https://phase2.test/'))).toBe(true);
  expect(requests.some(url => /api\/|stripe|checkout-session|magic-link|license/.test(url))).toBe(false);
});
