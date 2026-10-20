import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Opens a tab on /dashboard/settings and waits for its content.
 * Tabs are client state, so a click that lands before hydration is lost;
 * the click is repeated until `ready` shows up.
 */
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
  await expect(async () => {
    await tab.click();
    await expect(ready).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

export const PAYMENTS_TAB = /^Payments$|^Płatności$/i;
