import { test, expect } from '@playwright/test';

const CASES = [
  { path: '/pl/taxes', title: 'Strona nie znaleziona' },
  { path: '/pl/payment/success', title: 'Strona nie znaleziona' },
  { path: '/pl/nie-ma-takiej-strony/glebiej', title: 'Strona nie znaleziona' },
  { path: '/en/taxes', title: 'Page Not Found' },
  { path: '/en/nie-ma-takiej-strony', title: 'Page Not Found' },
];

for (const { path, title } of CASES) {
  test(`unknown route ${path} renders the localized 404 page`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('This page could not be found.')).toHaveCount(0);
  });
}
