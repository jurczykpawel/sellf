/** The product row actions menu stays fully inside the viewport, also for the last row on short screens. */
import { test, expect } from '@playwright/test';
import { setAuthSession } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

const viewports = [
  { name: 'short desktop', width: 1440, height: 600 },
  { name: 'phone', width: 390, height: 844 },
];

for (const vp of viewports) {
  test(`opens the last row menu fully inside the ${vp.name} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await acceptAllCookies(page);
    await setAuthSession(page, 'demo@sellf.app', 'demo123');
    await page.goto('/pl/dashboard/products');

    const toggles = page.locator('tbody tr button[aria-expanded]');
    await expect(toggles.first()).toBeVisible();
    const last = toggles.last();
    await last.scrollIntoViewIfNeeded();
    await last.click();

    const menu = page.locator('div[style*="position: fixed"]').filter({ has: page.getByRole('button', { name: /^Duplikuj$/ }) });
    await expect(menu).toBeVisible();
    const items = menu.getByRole('button');
    const count = await items.count();
    expect(count).toBeGreaterThan(3);
    const scroller = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    expect(scroller.top).toBeGreaterThanOrEqual(0);
    expect(scroller.bottom).toBeLessThanOrEqual(vp.height);
    expect(scroller.left).toBeGreaterThanOrEqual(0);
    expect(scroller.right).toBeLessThanOrEqual(vp.width);

    // every item is reachable without moving the page: the real click must land on the item
    await page.getByRole('button', { name: /^Duplikuj$/ }).click({ timeout: 5000 });
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}
