import { test, expect, type Page } from '@playwright/test';
import { createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

/**
 * Leaving the dashboard while its server actions are still in flight must not surface errors
 * (pageerror / console.error), and the payments status filter must show it is loading.
 * @see src/components/dashboard, src/components/admin/PaymentsDashboard.tsx
 */

test.describe('Dashboard interrupted requests', () => {
  let admin: Awaited<ReturnType<typeof createTestAdmin>>;
  let problems: string[];

  test.beforeAll(async () => { admin = await createTestAdmin('aborted-requests'); });
  test.afterAll(async () => { await admin.cleanup(); });

  test.beforeEach(async ({ page }) => {
    problems = [];
    page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
    await loginAsAdmin(page, admin.email, admin.password);
  });

  const openDashboard = async (page: Page) => {
    await page.goto('/dashboard/products');
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  };

  for (const [target, delay] of [['payments', 0], ['coupons', 150], ['payments', 800], ['coupons', 2000]] as const) {
    test(`clicking ${target} ${delay} ms after load logs nothing`, async ({ page }) => {
      await openDashboard(page);
      await page.waitForTimeout(delay);
      await page.locator(`a[href="/dashboard/${target}"]`).first().click();
      await page.waitForURL(`**/dashboard/${target}`);
      await page.waitForTimeout(3500);
      expect(problems).toEqual([]);
    });
  }

  for (const delay of [300, 1200, 5000]) {
    test(`reloading ${delay} ms after load logs nothing`, async ({ page }) => {
      await openDashboard(page);
      await page.waitForTimeout(delay);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);
      expect(problems).toEqual([]);
    });
  }

  test('payments status filter marks the table busy until new rows arrive', async ({ page }) => {
    await page.route('**/api/v1/payments?**', async route => {
      if (new URL(route.request().url()).searchParams.get('status') === 'completed') {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      await route.continue();
    });
    await page.goto('/dashboard/payments');
    const table = page.locator('[aria-busy]').first();
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await page.locator('#payment-status-filter').selectOption('completed');
    await expect(table).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status')).toBeVisible();
    await expect(table).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
  });
});
