import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/admin-auth';

test('long permitted transfer reference wraps inside settings @J95', async ({ page }) => {
  await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
  await page.goto('/pl/dashboard/settings?tab=payments');
  const input = page.getByLabel('Szablon tytułu przelewu', { exact: true });
  await expect(page.locator('[data-tour="transfer-save"]')).toBeEnabled();
  await expect(input).not.toHaveValue('');
  const value = 'R'.repeat(186) + '{order_number}';
  await input.fill(value);
  const preview = page.getByText(`Podgląd tytułu: ${value.replace('{order_number}', '12345')}`, { exact: true });
  await expect(preview).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(preview).toHaveText(`Podgląd tytułu: ${value.replace('{order_number}', '12345')}`);
  }
});
