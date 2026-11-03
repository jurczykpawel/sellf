/**
 * Seller refunds part of a real Stripe test-mode payment from the admin refund dialog,
 * then the rest; Stripe, the order and the dialog agree on every amount.
 * @see src/components/admin/PaymentTransactionsTable.tsx
 * @see src/lib/actions/payment.ts → processRefund
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import { createTestAdmin, setAuthSession, supabaseAdmin as db } from '../helpers/admin-auth';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

test('partial then remaining refund from the dialog reaches Stripe and the order @J192', async ({ page }) => {
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
    customer_email: email, session_id: intent.id, stripe_payment_intent_id: intent.id }).select('id').single();
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
