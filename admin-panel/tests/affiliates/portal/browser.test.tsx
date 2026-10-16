/** Portal layout matrix. @see components/affiliates/portal/AffiliatePortal.tsx */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, it } from 'vitest';
import AffiliatePortal from '@/components/affiliates/portal/AffiliatePortal';
import styles from '@/components/affiliates/portal/AffiliatePortal.module.css';
import { portalMessages } from '@/components/affiliates/portal/messages';
import { fixture } from './fixtures';

it('supports EN/PL, desktop/mobile, light/dark, keyboard and enlarged text', async () => {
  let css = readFileSync('src/components/affiliates/portal/AffiliatePortal.module.css', 'utf8').replace(/:global\(([^)]+)\)/g, '$1');
  for (const [name, generated] of Object.entries(styles)) css = css.replace(new RegExp(`\\.${name}(?![\\w-])`, 'g'), `.${generated}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const locale of ['en', 'pl'] as const) for (const width of [1440, 390, 320]) for (const dark of [false, true]) for (const zoom of [1, 2]) {
      await page.setViewportSize({ width, height: 1000 });
      const markup = renderToStaticMarkup(createElement(AffiliatePortal, { data: fixture, locale }));
      await page.setContent(`<!doctype html><html lang="${locale}" class="${dark ? 'dark' : ''}"><head><title>Partner</title><style>*{box-sizing:border-box}html{font-size:${16 * zoom}px}body{margin:0;font:1rem system-ui;background:${dark ? '#0a101c' : '#f3f5f8'}}main{max-width:1280px;margin:1rem auto;padding:0 1rem}${css}</style></head><body><main>${markup}</main></body></html>`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press('Tab');
      expect(await page.locator('summary').first().evaluate(el => el === document.activeElement)).toBe(true);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      expect(await page.getByRole('button', { name: portalMessages[locale].next }).evaluate(el => el === document.activeElement)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (width !== 320 && !dark && zoom === 1) await page.screenshot({ path: `/tmp/a1-7-${locale}-${width}.png`, fullPage: true });
      if (width === 320 && zoom === 2) {
        await page.getByText(portalMessages[locale].help, { exact: true }).click();
        await page.getByText(portalMessages[locale].technical, { exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
    }
  } finally { await browser.close(); }
}, 120000);
