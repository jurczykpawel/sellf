/** Buyer navigation and transfer status updates on the current page. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import pl from '../src/messages/pl.json';

let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let buyer: Awaited<ReturnType<typeof createTestUser>>;
let productId: string;
const transactionIds: string[] = [];
const prefix = `ui-polish-${randomUUID()}`;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a local disposable Supabase stack');
test.beforeAll(async () => {
  admin = await createTestAdmin(prefix);
  buyer = await createTestUser(prefix);
  const { data, error } = await db.from('products').insert({ name: prefix, slug: prefix, price: 30, currency: 'PLN', is_active: true }).select('id').single();
  if (error) throw error;
  productId = data!.id;
});
test.afterAll(async () => {
  if (transactionIds.length) await db.from('payment_transactions').delete().in('id', transactionIds);
  if (productId) await db.from('products').delete().eq('id', productId);
  await buyer?.cleanup();
  await admin?.cleanup();
});

test('mobile buyer sees buyer links and cannot open administrator pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await acceptAllCookies(page);
  await setAuthSession(page, buyer.email, buyer.password);
  await page.goto('/pl/my-purchases');
  const bar = page.locator('nav.fixed.bottom-0');
  await expect(bar.getByRole('link', { name: pl.navigation.myProducts, exact: true })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Moje zakupy', exact: true })).toBeVisible();
  await expect(bar.locator('a[href*="dashboard"]')).toHaveCount(0);
  await page.goto('/pl/dashboard/products');
  await expect(page).not.toHaveURL(/dashboard/);
  expect((await page.request.get('/api/v1/products')).status()).toBe(401);
});

for (const action of ['mark-paid', 'cancel'] as const) {
  test(`${action} refreshes the visible payment row without navigation`, async ({ page }) => {
    const email = `${prefix}-${action}@example.com`;
    const { data, error } = await db.from('payment_transactions').insert({ product_id: productId, customer_email: email, amount: 3000, currency: 'PLN',
      pricing_snapshot_version: 1, status: 'awaiting_payment', payment_provider: 'bank_transfer', payment_due_at: '2099-01-01T00:00:00Z',
      metadata: { customer_email: email },
    }).select('id').single();
    if (error) throw error;
    transactionIds.push(data!.id);
    await acceptAllCookies(page);
    await setAuthSession(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText(pl.admin.payments.transactions.statuses.awaiting_payment);
    await row.getByRole('button', { name: /szczegóły/i }).click();
    const transfer = page.getByRole('region', { name: 'Przelew tradycyjny', exact: true });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
    let refreshRequested = false;
    await page.route('**/api/v1/payments?*', async route => {
      refreshRequested = true;
      await refreshGate;
      await route.continue();
    });
    if (action === 'mark-paid') {
      await transfer.getByLabel('Data wpływu').fill('2026-10-20');
      await transfer.getByRole('button', { name: 'Oznacz jako opłacone' }).click();
    } else {
      await transfer.getByLabel('Powód anulowania').fill('Rezygnacja klienta');
      await transfer.getByRole('button', { name: 'Anuluj zamówienie' }).click();
    }
    try {
      await expect.poll(() => refreshRequested).toBe(true);
      await expect(transfer).toBeVisible();
    } finally { releaseRefresh(); }
    await expect(transfer).toHaveCount(0);
    await expect(row).toContainText(pl.admin.payments.transactions.statuses[action === 'mark-paid' ? 'completed' : 'cancelled']);
    await expect(page).toHaveURL(/\/pl\/dashboard\/payments$/);
  });
}
