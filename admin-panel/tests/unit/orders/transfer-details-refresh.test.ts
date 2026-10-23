// @vitest-environment happy-dom
/** Open order details follow the current payment row. */
import { createElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/actions/payment', () => ({ processRefund: vi.fn() }));
vi.mock('@/components/admin/BankTransferSection', () => ({ default: () => null }));
vi.mock('@/components/admin/InvoiceSection', () => ({ default: ({ status }: { status: string }) => createElement('p', { 'data-testid': 'invoice-order-status' }, status) }));
import PaymentTransactionsTable from '@/components/admin/PaymentTransactionsTable';
import en from '@/messages/en.json';
import type { PaymentTransaction } from '@/types/payment';
afterEach(cleanup);
it('refreshes the selected order when its transaction changes to cancelled', () => {
  const tx: PaymentTransaction = { id: '10000000-0000-4000-8000-000000000001', session_id: '', user_id: null,
    product_id: 'product', amount: 12300, currency: 'PLN', status: 'awaiting_payment', refunded_amount: 0, metadata: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', line_items: [{ id: 'line', transaction_id: 'transaction', product_id: 'product', item_type: 'main_product', product_name: 'Workshop', quantity: 1, unit_price: 100, total_price: 100, currency: 'PLN' }] };
  const view = (transaction: PaymentTransaction) => createElement(NextIntlClientProvider, { locale: 'en', messages: en }, createElement(PaymentTransactionsTable, { transactions: [transaction] }));
  const rendered = render(view(tx));
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(screen.getByTestId('invoice-order-status').textContent).toBe('awaiting_payment');
  expect(screen.queryByText('Paid', { exact: true })).toBeNull();
  rendered.rerender(view({ ...tx, status: 'cancelled' }));
  expect(screen.getByTestId('invoice-order-status').textContent).toBe('cancelled');
});
