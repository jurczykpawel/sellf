/** Fresh browser navigation through the canonical locale routes. */
import { expect, test } from '@playwright/test';

for (const path of ['/login', '/en/login', '/pl/login']) {
  test(`${path} reaches the login form`, async ({ page }) => {
    const navigations: number[] = [];
    page.on('response', response => {
      if (response.request().isNavigationRequest()) navigations.push(response.status());
    });
    const response = await page.goto(`${path}?redirect_to=%2Fmy-products`);
    expect(response?.status()).toBe(200);
    expect(navigations.filter(status => status >= 300 && status < 400).length).toBeLessThanOrEqual(1);
    await expect(page).toHaveURL(new RegExp(`${path === '/pl/login' ? '/pl' : ''}/login\\?redirect_to=%2Fmy-products$`));
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
}
