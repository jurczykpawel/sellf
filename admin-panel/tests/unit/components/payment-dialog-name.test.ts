// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PaymentTransactionsTable from '@/components/admin/PaymentTransactionsTable';
import type { PaymentTransaction } from '@/types/payment';
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/actions/payment', () => ({ processRefund: vi.fn() }));
vi.mock('@/components/admin/BankTransferSection', () => ({ default: ({ onRefresh, transaction }: { onRefresh: () => Promise<void>; transaction: PaymentTransaction }) => transaction.status === 'awaiting_payment' ? createElement('button', { onClick: () => void onRefresh() }, 'book-transfer') : null }));
vi.mock('@/components/admin/AttributionSection', () => ({ default: () => null }));
vi.mock('@/components/admin/InvoiceSection', () => ({ default: () => null }));
vi.mock('@/components/admin/OrderDetailsSection', () => ({ default: () => null }));
afterEach(cleanup);
it('labels transaction details by the heading inside the dialog', () => {
  const tx = { id: 't', product_id: 'p', amount: 900, refunded_amount: 0, currency: 'PLN', status: 'completed', created_at: '2026-11-08', metadata: {} } as PaymentTransaction;
  render(createElement(PaymentTransactionsTable, { transactions: [tx] }));
  fireEvent.click(screen.getByRole('button', { name: 'details' }));
  const dialog = screen.getByRole('dialog', { name: 'transactionDetails' });
  expect(dialog.contains(document.getElementById(dialog.getAttribute('aria-labelledby')!))).toBe(true);
});

it('keeps details open and renders the fresh status after booking a transfer', async () => {
  const tx = { id: 't', product_id: 'p', amount: 2000, currency: 'PLN', status: 'awaiting_payment', created_at: '2026-11-08', metadata: {} } as PaymentTransaction;
  const refreshed = { ...tx, status: 'completed' as const };
  const refresh = async () => { view.rerender(createElement(PaymentTransactionsTable, { transactions: [refreshed], onRefreshData: refresh })); };
  const view = render(createElement(PaymentTransactionsTable, { transactions: [tx], onRefreshData: refresh }));
  fireEvent.click(screen.getByRole('button', { name: 'details' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'book-transfer' })); });
  expect(screen.getByRole('dialog', { name: 'transactionDetails' }).textContent).toContain('statuses.completed');
  expect(screen.queryByRole('button', { name: 'book-transfer' })).toBeNull();
});
