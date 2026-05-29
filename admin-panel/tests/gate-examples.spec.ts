/**
 * Smoke test for the static element-gating demo pages under public/gate-examples.
 * Self-contained (CSS-only visitor switch) — no backend / Supabase needed.
 */
import { test, expect } from '@playwright/test';

const proKit = '[data-sellf-product="pro-kit"]';
const vip = '[data-sellf-product="vip-masterclass"]';

test.describe('Gate examples — interactive demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/gate-examples/index.html');
  });

  test('owner: has-access branch, vip no-access, feature unlocked, verify passes', async ({ page }) => {
    await page.locator('label[for="role-owner"]').click();
    await expect(page.locator(`${proKit} [data-has-access]`)).toBeVisible();
    await expect(page.locator(`${proKit} [data-no-access]`)).toBeHidden();
    await expect(page.locator(`${proKit} [data-no-session]`)).toBeHidden();
    await expect(page.locator(`${vip} [data-no-access]`)).toBeVisible();
    await expect(page.locator('.feat[data-sellf-feature="pro-kit"] .unlock')).toBeVisible();
    await expect(page.locator('.verdict .ok')).toBeVisible();
  });

  test('signed-in non-owner: no-access branch, feature locked, verify denies', async ({ page }) => {
    await page.locator('label[for="role-member"]').click();
    await expect(page.locator(`${proKit} [data-no-access]`)).toBeVisible();
    await expect(page.locator(`${proKit} [data-has-access]`)).toBeHidden();
    await expect(page.locator('.feat[data-sellf-feature="pro-kit"] .lock')).toBeVisible();
    await expect(page.locator('.verdict .no')).toBeVisible();
  });

  test('guest: no-session branch on every block', async ({ page }) => {
    await page.locator('label[for="role-guest"]').click();
    await expect(page.locator(`${proKit} [data-no-session]`)).toBeVisible();
    await expect(page.locator(`${proKit} [data-has-access]`)).toBeHidden();
    await expect(page.locator(`${vip} [data-no-session]`)).toBeVisible();
  });

  test('deploy reference page renders the snippet', async ({ page }) => {
    await page.goto('/gate-examples/live-integration.html');
    await expect(page.locator('body')).toContainText('/api/loginwall/gate.js');
    await expect(page.locator('body')).toContainText('data-sellf-product');
  });
});
