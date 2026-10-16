/** Live route coverage; appearance fixtures exercise customized values separately. */
import { test, expect } from '@playwright/test';

for (const prefix of ['', '/pl']) {
  test(`${prefix || '/'}: exact public appearance coverage without scripts`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false, colorScheme: 'dark' });
    try {
      const page = await context.newPage();
      for (const route of ['/', '/store', '/p/premium-course', '/checkout/premium-course', '/login', '/terms', '/privacy']) {
        const response = await page.goto(`${prefix}${route === '/' ? '' : route}` || '/');
        expect(response?.status(), route).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('lang', prefix ? 'pl' : 'en');
        const shell = page.locator('.sf-public-theme');
        await expect(shell).toHaveCount(1);
        await expect(shell).toHaveAttribute('data-sf-surface', route === '/' || route === '/store' ? 'storefront' : 'protected');
        await expect(shell).toHaveCSS('font-size', '16px');
        await expect(shell).toHaveCSS('font-weight', '400');
        const css = await shell.locator('style').textContent();
        expect(css).toContain('--sf-accent-foreground:'); expect(css).not.toContain('url(');
      }
      await page.goto(`${prefix}/about`);
      await expect(page.locator('.sf-public-theme')).toHaveCount(0);
    } finally { await context.close(); }
  });
}
