import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

test('admin reads buyer, recipient, phone and five participants from the seeded order @J60', async ({ page }) => {
  test.setTimeout(90_000);
  const admin = await createTestAdmin('order-details');
  try {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    const row = page.getByRole('row').filter({ hasText: 'office@example.com' });
    await row.getByRole('button', { name: /szczegóły/i }).click();
    const section = page.getByRole('region', { name: 'Dane z koszyka' });
    await expect(section.getByText('Gmina Przykładowa')).toBeVisible();
    await expect(section.getByText('Szkoła Podstawowa nr 1')).toBeVisible();
    await expect(section.getByText('+48500100200', { exact: false })).toBeVisible();
    await expect(section.getByRole('table').getByRole('row')).toHaveCount(6);
    await expect(section.getByText('anna5@example.com')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('order-details.png'), fullPage: true });
  } finally {
    await admin.cleanup();
  }
});
