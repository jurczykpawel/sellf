/** Public routes retain useful first paint without browser scripts. Run with the app Chromium project. */
import { test, expect } from '@playwright/test';

for (const [path, locale] of [['/', 'en'], ['/store', 'en'], ['/pl', 'pl'], ['/pl/store', 'pl']] as const) {
  test(`${path}: public language, canonical and first paint`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(new URL(canonical!).pathname).toBe(path);
      await expect(page.locator('[data-testid="storefront"], [data-testid="coming-soon"]')).toBeVisible();
      expect(await page.locator('#catalogue article').count()).toBeLessThanOrEqual(72);
    } finally { await context.close(); }
  });
}

test('neutral route query retains canonical public identity', async ({ page }) => {
  await page.goto('/pl/store?search=no-matching-product-142857&experiment=neutral&arm=same');
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(new URL(canonical!).pathname).toBe('/pl/store');
  expect(new URL(canonical!).search).toBe('');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.locator('#catalogue input[type="search"]')).toHaveValue('no-matching-product-142857');
});
