/** First-paint appearance with actual build-bundled font files; requires bun run build. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { checkAccessibility } from './helpers/axe';
let pages: Record<string, string>; let css: string; let fonts: string; let scripts: Record<string, string>; let script: string;
test.beforeAll(() => {
  const dir = mkdtempSync(path.resolve('node_modules/.cache-theme-'));
  try {
    execFileSync('bun', ['build', 'tests/fixtures/storefront-sections/theme-render.tsx', '--target=node', '--packages=external', '--outdir', dir]);
    ({ pages, scripts } = JSON.parse(execFileSync('bun', [path.join(dir, 'theme-render.js')], { encoding: 'utf8' })));
    execFileSync('bun', ['-e', `const r=await Bun.build({entrypoints:['tests/fixtures/storefront-sections/theme-browser.tsx'],target:'browser',outdir:${JSON.stringify(dir)},define:{'process.env':'{"NODE_ENV":"production"}'},plugins:[{name:'image',setup(b){b.onResolve({filter:/^next\\/image$/},()=>({path:${JSON.stringify(path.resolve('tests/fixtures/storefront-sections/catalogue-image.ts'))}}));}}]});if(!r.success){console.error(r.logs);process.exit(1)}`]);
    script = readFileSync(path.join(dir, 'theme-browser.js'), 'utf8');
    css = readFileSync(path.join(dir, 'theme-render.css'), 'utf8');
    const built = readdirSync('.next/static/chunks').filter(f => f.endsWith('.css')).map(f => readFileSync(`.next/static/chunks/${f}`, 'utf8')).join('');
    fonts = [...built.matchAll(/@font-face\{[^}]+\}/g)].map(m => m[0]).filter(f => /font-family:(?:"?DM Sans"?|Geist);/.test(f)).join('').replaceAll('../media/', '/fonts/');
    expect(fonts).toContain('DM Sans'); expect(fonts).toContain('Geist');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
for (const locale of ['en', 'pl'] as const) for (const font of ['geist', 'dm-sans'] as const) for (const dark of [false, true]) {
  test(`${locale}/${font}/${dark ? 'dark' : 'light'}: scoped first paint, fonts and protected floors`, async ({ browser }, testInfo) => {
    for (const javaScriptEnabled of [false, true]) {
      const context = await browser.newContext({ javaScriptEnabled, colorScheme: dark ? 'dark' : 'light', viewport: { width: 390, height: 900 } });
      const page = await context.newPage(); const hosts = new Set<string>(); const errors: string[] = [];
      page.on('request', r => hosts.add(new URL(r.url()).host)); page.on('pageerror', e => errors.push(e.message));
      await context.route('https://theme.test/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/fonts/')) return route.fulfill({ contentType: 'font/woff2', body: readFileSync(`.next/static/media/${path.basename(url.pathname)}`) });
        if (url.pathname === '/theme.js') return route.fulfill({ contentType: 'application/javascript', body: script });
        if (url.pathname === '/example.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#767676"/></svg>' });
        const surface = url.pathname.includes('protected') ? 'protected' : 'storefront';
        const mode = url.searchParams.get('mode') ?? 'system';
        const template = url.searchParams.get('template') === 'default' ? 'default' : 'd';
        const html = pages[`${locale}/${font}/${surface}/${mode}${template === 'default' ? '/default' : ''}`];
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Appearance</title>${scripts[mode]}<style>${fonts}*{box-sizing:border-box}body{margin:0;--font-geist-sans:Geist;--font-dm-sans:'DM Sans'}#admin{font-family:serif;font-size:16px;font-weight:400;border-radius:6px}main{padding:20px}button,input{font:inherit;max-width:100%;min-height:44px}a{color:inherit}${css}</style></head><body><div id="root">${html}</div><script id="theme-props" type="application/json">${JSON.stringify({ locale, font, surface, mode, template })}</script><script src="/theme.js" defer></script><aside id="admin">Admin</aside></body></html>` });
      });
      await page.goto('https://theme.test/storefront');
      if (javaScriptEnabled) await expect(page.locator('body')).toHaveAttribute('data-hydrated', 'true');
      const shell = page.locator('.sf-public-theme');
      await expect(shell).toHaveCSS('font-weight', '500'); await expect(shell).toHaveCSS('font-size', '18px');
      await expect(shell).toHaveCSS('font-family', font === 'geist' ? 'Geist' : '"DM Sans"');
      await expect(shell).toHaveCSS('background-color', dark ? 'rgb(21, 25, 22)' : 'rgb(250, 248, 244)');
      await expect(page.locator('h1')).toHaveCSS('font-weight', '700'); await expect(page.locator('h1')).toHaveCSS('letter-spacing', 'normal');
      await expect(page.locator('#catalogue h2').first()).toHaveCSS('font-weight', '700');
      await expect(page.locator('#catalogue article').first()).toHaveCSS('border-radius', '4px');
      await expect(page.locator('#catalogue input[type=search]')).toHaveCSS('border-radius', '8px');
      await expect(page.locator('figure').first()).toHaveCSS('border-radius', '24px');
      await expect(page.locator('#admin')).toHaveCSS('border-radius', '6px'); await expect(page.locator('#admin')).toHaveCSS('font-weight', '400');
      {
        await page.evaluate(() => document.fonts.ready);
        const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
        const { root } = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#glyphs' });
        for (const weight of [400, 500, 600, 700]) {
          await page.locator('#glyphs').evaluate((element, value) => { element.style.fontWeight = String(value); }, weight);
          await page.evaluate(() => document.fonts.ready);
          const rendered = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
          expect(rendered.fonts.every(f => f.isCustomFont && f.familyName.includes(font === 'geist' ? 'Geist' : 'DM Sans'))).toBe(true);
          expect(rendered.fonts.reduce((n, f) => n + f.glyphCount, 0)).toBeGreaterThan(20);
        }
      }
      if (javaScriptEnabled) {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:theme', { detail: 'light' })));
        await expect(shell).toHaveCSS('background-color', 'rgb(250, 248, 244)');
        await page.evaluate(dark => window.dispatchEvent(new CustomEvent('fixture:theme', { detail: dark ? 'dark' : 'light' })), dark);
        await checkAccessibility(page);
        await page.screenshot({ path: testInfo.outputPath('theme.png'), fullPage: true });
      }
      for (const width of [320, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
      await page.goto('https://theme.test/protected');
      await expect(shell).toHaveCSS('font-weight', '400'); await expect(shell).toHaveCSS('font-size', '16px');
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(() => { document.body.style.zoom = '2'; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => { document.body.style.zoom = ''; });
      await expect(page.locator('button')).toBeVisible(); await expect(page.locator('[role=alert]')).toBeVisible();
      if (javaScriptEnabled) { await page.locator('button').focus(); await expect(page.locator('button')).toBeFocused(); await checkAccessibility(page); }
      await page.goto(`https://theme.test/storefront?mode=${dark ? 'light' : 'dark'}`);
      await expect(shell).toHaveCSS('background-color', dark ? 'rgb(250, 248, 244)' : 'rgb(21, 25, 22)');
      await page.goto('https://theme.test/storefront?template=default');
      await expect(page.locator('#catalogue article').first()).toHaveCSS('border-radius', '4px');
      expect([...hosts]).toEqual(['theme.test']); expect(errors).toEqual([]); await context.close();
    }
  });
}
