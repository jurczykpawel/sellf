/** Signed buyer order page reflects persisted status on a fresh request. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { signTransferToken } from '@/lib/orders/transfer-token';
import { supabaseAdmin as db } from './helpers/admin-auth';

test('cancelled transfer stays cancelled after reload and cannot be paid online @J182', async ({ page }) => {
  const productId = randomUUID(), orderId = randomUUID();
  const check = (error: unknown) => expect(error).toBeNull();
  check((await db.from('products').insert({ id: productId, name: 'Refresh order', slug: `refresh-${productId}`, price: 10, currency: 'PLN', is_active: true })).error);
  try {
    check((await db.from('payment_transactions').insert({ id: orderId, product_id: productId, session_id: null, pricing_snapshot_version: 1, customer_email: 'refresh@example.com', amount: 1000, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', transfer_details: { account: 'PL61109010140000071219812874' } })).error);
    check((await db.from('payment_line_items').insert({ transaction_id: orderId, product_id: productId, item_type: 'main_product', quantity: 1, unit_price: 10, total_price: 10, currency: 'PLN' })).error);
    const url = `/pl/order/${orderId}/transfer?token=${signTransferToken(orderId)}`;
    await page.goto(url);
    await expect(page.getByText('Oczekuje na przelew', { exact: true })).toBeVisible();
    check((await db.from('payment_transactions').update({ status: 'cancelled' }).eq('id', orderId)).error);
    await page.reload();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Tego zamówienia nie można już opłacić');
    await expect(page.getByText('Oczekuje na przelew', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /zostało anulowane/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Zapłać online/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Przejdź do produktu' })).toHaveAttribute('href', `/pl/p/refresh-${productId}`);
    await expect(page.getByRole('button', { name: 'Wysłałem przelew' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Tego zamówienia nie można już opłacić');
  } finally {
    await db.from('payment_transactions').delete().eq('id', orderId);
    await db.from('products').delete().eq('id', productId);
  }
});
