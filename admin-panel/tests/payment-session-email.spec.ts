/** Checkout attempts with no buyer email use a readable translated label. */
import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin } from './helpers/admin-auth';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
test('checkout sessions hide the pending guest address in PL and EN', async ({ page }) => {
  const admin = await createTestAdmin('session-email');
  try {
    const now = new Date().toISOString();
    await page.route('**/api/admin/payments/sessions', route => route.fulfill({ json: [{ id: 'unknown', session_id: 'pi_test_unknown', customer_email: 'pending@sellf.app', product_id: null, provider_type: 'stripe', amount: 1000, currency: 'PLN', status: 'pending', created_at: now, updated_at: now, expires_at: null }] }));
    await loginAsAdmin(page, admin.email, admin.password);
    for (const locale of ['pl', 'en'] as const) {
      const messages = locale === 'pl' ? pl : en;
      await page.goto(`/${locale}/dashboard/payments`);
      await page.getByRole('tab', { name: new RegExp(messages.admin.payments.sessions.titleSentence) }).click();
      await expect(page.getByRole('cell', { name: messages.admin.payments.transactions.unknownCustomer, exact: true })).toBeVisible();
      await expect(page.getByText('pending@sellf.app', { exact: true })).toHaveCount(0);
    }
  } finally { await admin.cleanup(); }
});
