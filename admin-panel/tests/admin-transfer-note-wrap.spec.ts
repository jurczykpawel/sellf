import { test, expect } from '@playwright/test';
import { loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';

test.setTimeout(120000);

test('accepted 200-character buyer note wraps in admin payment details @J53', async ({ page }, info) => {
  const note = 'X'.repeat(200);
  const email = `note-${Date.now()}@example.com`;
  const { data: order, error } = await db.from('payment_transactions').insert({ customer_email: email, amount: 4700, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1, transfer_details: { title: 'Order', holder: 'Shop', account: 'PL61109010140000071219812874' }, transfer_declared_at: new Date().toISOString(), transfer_declared_note: note }).select('id').single();
  expect(error).toBeNull();
  try {
    await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
    for (const locale of ['pl', 'en']) {
      await page.goto(`/${locale}/dashboard/payments`);
      const row = page.getByRole('row').filter({ hasText: email });
      await row.getByRole('button', { name: /szczegóły|details/i }).click();
      const item = page.locator('[data-tour="unpaid-lifecycle"] li').filter({ hasText: note });
      await expect(item).toContainText(note);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => item.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        await expect(item).toContainText(note);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}.png`) });
      }
    }
  } finally { expect((await db.from('payment_transactions').delete().eq('id', order!.id)).error).toBeNull(); }
});
