// @vitest-environment happy-dom
/**
 * Seller opens an order by number/link, refunds part of it, and issues a license from it.
 * @see src/components/admin/PaymentTransactionsTable.tsx
 */
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PaymentTransactionsTable from '@/components/admin/PaymentTransactionsTable';
import type { PaymentTransaction } from '@/types/payment';

const { processRefund } = vi.hoisted(() => ({ processRefund: vi.fn() }));
vi.mock('@/lib/actions/payment', () => ({ processRefund }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => 'pl',
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/admin/BankTransferSection', () => ({ default: () => null }));
vi.mock('@/components/admin/InvoiceSection', () => ({ default: () => null }));
vi.mock('@/components/admin/OrderDetailsSection', () => ({ default: () => null }));
afterEach(() => { cleanup(); processRefund.mockReset(); });

const tx = {
  id: '11111111-2222-3333-4444-555555555555', order_number: 1300, customer_email: 'jan@example.com',
  // Shape returned by GET /api/v1/payments: the product id lives under product.id, not product_id.
  user_id: null, product: { id: 'prod-1', name: 'Kurs', slug: 'kurs' }, amount: 7000, refunded_amount: 0,
  currency: 'pln', status: 'completed', stripe_payment_intent_id: 'pi_123', session_id: 'cs_123',
  created_at: '2026-11-01T10:00:00Z', line_items: [], metadata: {},
} as unknown as PaymentTransaction;

it('shows the order number and opens the order given in the URL @J191 @J193', () => {
  render(createElement(PaymentTransactionsTable, { transactions: [tx], initialDetailsId: tx.id }));
  expect(screen.getAllByText('#1300').length).toBeGreaterThan(0);
  expect(screen.getByText('transactionDetails')).toBeTruthy();
  const link = screen.getByRole('link', { name: 'issueLicense' }) as HTMLAnchorElement;
  expect(link.getAttribute('href')).toBe('/dashboard/licenses?email=jan%40example.com&product=prod-1');
});

it('refunds a partial amount and blocks more than what remains @J192', async () => {
  processRefund.mockResolvedValue({ success: true, message: 'ok' });
  render(createElement(PaymentTransactionsTable, { transactions: [tx] }));
  fireEvent.click(screen.getByText('refund'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'requested_by_customer' } });
  const amount = screen.getByLabelText(/amountLabel/);
  fireEvent.change(amount, { target: { value: '70,01' } });
  expect(screen.getByRole('alert').textContent).toMatch(/ExceedsRemaining/);
  const submit = screen.getByRole('button', { name: /partialRefund|fullRefundSentence/ }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(amount, { target: { value: '25' } });
  expect((screen.getByRole('button', { name: /partialRefund/ }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /partialRefund/ })); });
  expect(processRefund).toHaveBeenCalledWith({ transactionId: tx.id, amount: 2500, reason: 'requested_by_customer' });
});

it('an empty amount refunds the full remaining amount', async () => {
  processRefund.mockResolvedValue({ success: true, message: 'ok' });
  render(createElement(PaymentTransactionsTable, { transactions: [{ ...tx, refunded_amount: 2000 } as PaymentTransaction] }));
  fireEvent.click(screen.getByText('refund'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'duplicate' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /fullRefundSentence/ })); });
  expect(processRefund).toHaveBeenCalledWith({ transactionId: tx.id, amount: 5000, reason: 'duplicate' });
});

it('does not offer Stripe refunds for a booked bank transfer', () => {
  render(createElement(PaymentTransactionsTable, { transactions: [{ ...tx, payment_provider: 'bank_transfer', stripe_payment_intent_id: null }] }));
  expect(screen.queryByRole('button', { name: 'refund' })).toBeNull();
});
it('explains that a JPY refund must use whole units and permits a corrected amount', () => {
  render(createElement(PaymentTransactionsTable, { transactions: [{ ...tx, currency: 'JPY', amount: 200 }] }));
  fireEvent.click(screen.getByText('refund'));
  const input = screen.getByLabelText(/amountLabel/);
  fireEvent.change(input, { target: { value: '0.5' } });
  expect(screen.getByRole('alert').textContent).toMatch(/amountInvalidWhole/);
  expect(document.getElementById(input.getAttribute('aria-describedby')!.split(' ').at(-1)!)?.textContent).toMatch(/amountInvalidWhole/);
  fireEvent.change(input, { target: { value: '100' } });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retains the refund action for a bank-transfer order paid online through Stripe', () => {
  render(createElement(PaymentTransactionsTable, { transactions: [{ ...tx, payment_provider: 'bank_transfer' }] }));
  expect(screen.getByRole('button', { name: 'refund' })).toBeTruthy();
});
