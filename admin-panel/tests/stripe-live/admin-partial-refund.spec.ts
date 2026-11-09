/**
 * Seller refunds part of a real Stripe test-mode payment from the admin refund dialog,
 * then the rest; Stripe, the order and the dialog agree on every amount.
 * @see src/components/admin/PaymentTransactionsTable.tsx
 * @see src/lib/actions/payment.ts → processRefund
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import { acceptAllCookies } from '../helpers/consent';
import { createTestAdmin, loginAsAdmin, setAuthSession, supabaseAdmin as db } from '../helpers/admin-auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

for (const paymentProvider of ['stripe', 'bank_transfer']) {
test(`partial then remaining refund reaches Stripe for ${paymentProvider} orders @J192`, async ({ page }) => {
  expect(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'Stripe test key required').toBe(true);
  const admin = await createTestAdmin('w135-refund');
  const run = randomUUID().replaceAll('-', '');
  const email = `w135-refund-${run}@example.test`;
  const intent = await stripe.paymentIntents.create({ amount: 7000, currency: 'pln', payment_method: 'pm_card_visa', confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, metadata: { test_run: run } });
  expect(intent.status).toBe('succeeded');
  const product = await db.from('products').insert({ name: `W135 refund ${run}`, slug: `w135-refund-${run}`, price: 70, currency: 'PLN', is_active: true }).select('id').single();
  expect(product.error).toBeNull();
  const tx = await db.from('payment_transactions').insert({ product_id: product.data!.id, amount: 7000, currency: 'PLN', status: 'completed',
    customer_email: email, payment_provider: paymentProvider, session_id: paymentProvider === 'stripe' ? intent.id : null, settled_via: paymentProvider === 'bank_transfer' ? 'stripe' : null, pricing_snapshot_version: 1, stripe_payment_intent_id: intent.id }).select('id').single();
  expect(tx.error).toBeNull();
  const refundRow = () => db.from('payment_transactions').select('status, refunded_amount').eq('id', tx.data!.id).single();
  const openDialog = async () => {
    await page.goto('/pl/dashboard/payments');
    await page.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'Zwrot', exact: true }).click();
    await page.getByRole('combobox').last().selectOption('requested_by_customer');
  };
  try {
    await setAuthSession(page, admin.email, admin.password);

    await openDialog();
    const amount = page.getByLabel(/Kwota zwrotu/);
    await amount.fill('70,01');
    await expect(page.getByRole('alert').filter({ hasText: 'przekracza' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pełny zwrot' })).toBeDisabled();
    await amount.fill('25,50');
    await page.getByRole('button', { name: /^Zwróć 25,50/ }).click();
    await expect.poll(async () => (await refundRow()).data).toEqual({ status: 'partially_refunded', refunded_amount: 2550 });
    expect((await stripe.refunds.list({ payment_intent: intent.id })).data.map(r => [r.amount, r.status])).toEqual([[2550, 'succeeded']]);

    // The remainder: an empty amount refunds exactly what is left (44,50 zł).
    await openDialog();
    await expect(page.getByText(/44,50/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Pełny zwrot' }).click();
    await expect.poll(async () => (await refundRow()).data).toEqual({ status: 'refunded', refunded_amount: 7000 });
    const refunds = (await stripe.refunds.list({ payment_intent: intent.id })).data.map(r => r.amount).sort((a, b) => a - b);
    expect(refunds).toEqual([2550, 4450]);
  } finally {
    await db.from('payment_transactions').delete().eq('id', tx.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
    await admin.cleanup();
  }
});

}

test.describe('Payment dialogs, sessions and buyer refund fields', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120000);
  let productId: string;
  let transferId: string;
  let buyerId: string;
  let buyerTransactionId: string;
  const buyerEmail = `refund-ui-${randomUUID()}@example.com`;
  const buyerPassword = 'Refund-ui-test-123!';
  const email = `payments-ui-${randomUUID()}@example.com`;
  test.beforeAll(async () => {
    const { data, error } = await db.from('products').insert({ name: 'Payment UI check', slug: `payments-ui-${randomUUID().replaceAll('-', '')}`, price: 20, currency: 'PLN', is_active: true, is_refundable: true, refund_period_days: 14 }).select('id').single();
    expect(error).toBeNull(); productId = data!.id;
    const { data: rows, error: insertError } = await db.from('payment_transactions').insert([
      { product_id: productId, customer_email: email, amount: 2000, currency: 'PLN', status: 'awaiting_payment', refunded_amount: 0, payment_provider: 'bank_transfer', session_id: null, pricing_snapshot_version: 1, payment_due_at: '2099-01-01T00:00:00Z' },
      { product_id: productId, customer_email: email, amount: 900, currency: 'PLN', status: 'partially_refunded', refunded_amount: 100, payment_provider: 'stripe', session_id: `cs_ui_${randomUUID().replaceAll('-', '')}`, stripe_payment_intent_id: `pi_ui_${randomUUID().replaceAll('-', '')}` },
    ]).select('id,status');
    expect(insertError).toBeNull(); transferId = rows!.find(r => r.status === 'awaiting_payment')!.id;
    const buyer = await db.auth.admin.createUser({ email: buyerEmail, password: buyerPassword, email_confirm: true });
    expect(buyer.error).toBeNull(); buyerId = buyer.data.user!.id;
    const paid = await db.from('payment_transactions').insert({ product_id: productId, user_id: buyerId, customer_email: buyerEmail, amount: 900, currency: 'PLN', status: 'completed', session_id: `cs_buyer_${randomUUID().replaceAll('-', '')}`, stripe_payment_intent_id: `pi_buyer_${randomUUID().replaceAll('-', '')}` }).select('id').single();
    expect(paid.error).toBeNull(); buyerTransactionId = paid.data!.id;
  });
  test.afterAll(async () => {
    if (productId) {
      await db.from('refund_requests').delete().eq('product_id', productId);
      await db.from('guest_purchases').delete().eq('product_id', productId);
      await db.from('payment_transactions').delete().eq('product_id', productId);
      await db.from('products').delete().eq('id', productId);
    }
    if (buyerId) await db.auth.admin.deleteUser(buyerId);
  });
  test('sessions show transfer nulls and minor-unit amounts; refund/details dialogs manage keyboard focus @J192', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
    await page.goto('/en/dashboard/payments');
    await page.getByRole('tab', { name: /Checkout sessions/i }).click();
    await expect(page.getByRole('row').filter({ hasText: email }).first()).toBeVisible();
    const transfer = page.getByRole('row').filter({ hasText: email }).filter({ hasText: /20\.00/ });
    await expect(transfer).toHaveCount(1);
    expect(errors).toEqual([]);
    await page.getByRole('tab', { name: /Payment transactions/i }).click();
    const row = page.getByRole('row').filter({ hasText: email }).filter({ hasText: /9\.00/ });
    const refund = row.getByRole('button', { name: /Refund/ }); await refund.click();
    let dialog = page.getByRole('dialog'); await expect(dialog).toHaveAccessibleName(/Process refund/i);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Tab'); await expect(dialog.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(refund).toBeFocused();
    const details = row.getByRole('button', { name: /Details/ }); await details.click();
    dialog = page.getByRole('dialog'); await expect(dialog).toHaveAccessibleName(/Transaction Details/i);
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(details).toBeFocused();
  });
  test('marking a transfer paid keeps its details open with the completed status @J53', async ({ page }) => {
    await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
    const { data } = await db.from('payment_transactions').select('order_number').eq('id', transferId).single();
    await page.goto(`/en/dashboard/payments?order=${data!.order_number}`);
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await dialog.locator('input[type=date]').fill(new Date().toISOString().slice(0, 10));
    await dialog.getByRole('button', { name: /Mark.*paid/i }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Completed', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Mark.*paid/i })).toHaveCount(0);
    const { data: tx } = await db.from('payment_transactions').select('status').eq('id', transferId).single(); expect(tx!.status).toBe('completed');
  });

  test('buyer corrects a long refund reason at the field before submitting @J56', async ({ page }) => {
    await acceptAllCookies(page);
    await setAuthSession(page, buyerEmail, buyerPassword);
    await page.goto('/en/my-purchases');
    await page.getByRole('button', { name: 'Request Refund', exact: true }).click();
    const reason = page.getByLabel('Reason for refund (optional)');
    await reason.fill('x'.repeat(6000));
    await page.getByRole('button', { name: 'Submit Request', exact: true }).click();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    await expect(reason).toHaveAttribute('aria-describedby', 'buyer-refund-reason-hint');
    await expect(page.locator('#buyer-refund-reason-hint')).toContainText('maximum 2000');
    expect((await db.from('refund_requests').select('id').eq('transaction_id', buyerTransactionId)).data).toHaveLength(0);
    await reason.fill('Purchased the wrong edition');
    await page.getByRole('button', { name: 'Submit Request', exact: true }).click();
    await expect(reason).toHaveCount(0);
    const { data, error } = await db.from('refund_requests').select('reason').eq('transaction_id', buyerTransactionId);
    expect(error).toBeNull(); expect(data).toEqual([{ reason: 'Purchased the wrong edition' }]);
  });
});
