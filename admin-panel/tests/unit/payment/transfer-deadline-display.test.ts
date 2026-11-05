import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/actions/payment', () => ({ processRefund: vi.fn() }));
vi.mock('@/components/admin/BankTransferSection', () => ({ default: () => null }));
vi.mock('@/components/admin/AttributionSection', () => ({ default: () => null }));
vi.mock('@/components/admin/InvoiceSection', () => ({ default: () => null }));
import PaymentTransactionsTable from '@/components/admin/PaymentTransactionsTable';
import { formatTransferDeadline } from '@/lib/orders/transfer-format';
import type { PaymentTransaction } from '@/types/payment';
it('shows the reservation payment deadline consistently with transfer instructions', () => {
  const tx = { id: 'tx1', order_number: 1, product_id: 'p', status: 'awaiting_payment', payment_provider: 'bank_transfer',
    amount: 100, currency: 'PLN', created_at: '2026-11-05T10:00:00Z',
    release_at: '2026-11-07T10:00:00Z', payment_due_at: '2026-11-19T10:00:00Z' } as PaymentTransaction;
  const html = renderToStaticMarkup(createElement(PaymentTransactionsTable, { transactions: [tx] }));
  expect(html).toContain(formatTransferDeadline(tx.release_at, 'pl'));
});
