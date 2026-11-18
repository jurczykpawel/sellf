import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export async function openSettingsTab(
  page: Page,
  name: RegExp,
  ready: Locator,
  path = '/dashboard/settings',
): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
  const tab = page.getByRole('button', { name });
  await expect(tab).toBeVisible({ timeout: 20000 });
  await tab.click({ timeout: 20000 });
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await expect(ready).toBeVisible({ timeout: 20000 });
}

export const PAYMENTS_TAB = /^Payments$|^Płatności$/i;
