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

test('long transfer reference stays inside the signed receipt on screen and print @J95', async ({ page }, testInfo) => {
  const { supabaseAdmin: db } = await import('./helpers/admin-auth');
  const { signTransferToken } = await import('@/lib/orders/transfer-token');
  const title = 'T'.repeat(200);
  const { data: order, error } = await db.from('payment_transactions').insert({ customer_email: 'receipt@example.com', amount: 4700, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1, transfer_details: { title, holder: 'Shop', account: 'PL61109010140000071219812874' } }).select('id').single();
  expect(error).toBeNull();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/pl/order/${order!.id}/transfer?token=${signTransferToken(order!.id)}`);
    for (const media of ['screen', 'print'] as const) {
      await page.emulateMedia({ media });
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
    await page.pdf({ path: testInfo.outputPath('receipt.pdf'), format: 'A4' });
    await page.emulateMedia({ media: 'screen' });
    await page.screenshot({ path: testInfo.outputPath('receipt.png'), fullPage: true });
  } finally { expect((await db.from('payment_transactions').delete().eq('id', order!.id)).error).toBeNull(); }
});
