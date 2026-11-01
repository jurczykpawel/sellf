/** Desktop action and currency layout. @see components/webhooks/WebhookListTable.tsx */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
test('keeps webhook actions visible at 1366px', async ({ page }) => {
  const admin = await createTestAdmin('core-layout');
  const name = `Layout webhook ${randomUUID()}`;
  const endpoint = await db.from('webhook_endpoints').insert({ url: 'https://hooks.example.com/services/sellf/customer-purchase-records', description: name, secret: randomUUID(), events: ['purchase.completed', 'waitlist.signup', 'lead.captured'], is_active: true }).select('id').single();
  expect(endpoint.error).toBeNull();
  try {
    await page.setViewportSize({ width: 1366, height: 900 });
    await setAuthSession(page, admin.email, admin.password);
    await page.goto('/en/dashboard/webhooks');
    const row = page.getByRole('row').filter({ hasText: name });
    const button = row.getByRole('button', { name: 'Delete', exact: true });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1366);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
    mkdirSync('/tmp/rcfix-core-shots', { recursive: true });
    for (const locale of ['en', 'pl']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/dashboard/webhooks`);
      await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
      await page.screenshot({ path: `/tmp/rcfix-core-shots/webhooks-${locale}-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  } finally {
    await db.from('webhook_endpoints').delete().eq('id', endpoint.data!.id);
    await admin.cleanup();
  }
});
test('keeps the full payment amount on one line at 1366px', async ({ page }) => {
  const admin = await createTestAdmin('core-amount-layout');
  await page.route('**/api/v1/payments/stats', route => route.fulfill({ json: { success: true, data: { total_transactions: 1, total_revenue_by_currency: { USD: 81455 }, today_revenue_by_currency: { USD: 81455 }, this_month_revenue_by_currency: { USD: 81455 }, refunded_amount_by_currency: {}, pending_count: 0 } } }));
  try {
    await page.setViewportSize({ width: 1366, height: 900 });
    await setAuthSession(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    const amount = page.locator('p').filter({ hasText: /^814[.,]55/ }).first();
    await expect(amount).toBeVisible();
    const lines = await amount.evaluate(element => { const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const tops = new Set<number>(); while (walker.nextNode()) { if (!walker.currentNode.textContent?.trim()) continue; const range = document.createRange(); range.selectNodeContents(walker.currentNode); for (const rect of range.getClientRects()) tops.add(Math.round(rect.top)); } return tops.size; });
    expect(lines).toBe(1);
    mkdirSync('/tmp/rcfix-core-shots', { recursive: true });
    for (const locale of ['en', 'pl']) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/dashboard/payments`);
      await expect(page.locator('p').filter({ hasText: /814[.,]55/ }).first()).toBeVisible();
      await page.screenshot({ path: `/tmp/rcfix-core-shots/payments-${locale}-${width}.png`, fullPage: true });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 10000 }).toBeLessThanOrEqual(width);
    }
  } finally {
    await admin.cleanup();
  }
});
test('keeps the coupon editor above mobile navigation', async ({ page }) => {
  const admin = await createTestAdmin('core-modal-layout');
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    await setAuthSession(page, admin.email, admin.password);
    await page.goto('/en/dashboard/coupons');
    await page.getByRole('button', { name: 'Create Coupon', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create Coupon', exact: true })).toBeVisible();
    const navigationOverlaysModal = await page.evaluate(() => !!document.elementFromPoint(30, window.innerHeight - 20)?.closest('nav'));
    expect(navigationOverlaysModal).toBe(false);
  } finally { await admin.cleanup(); }
});
