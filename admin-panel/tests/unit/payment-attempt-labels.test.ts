// @vitest-environment happy-dom
/** Payments list: unpaid checkout attempts are labelled as attempts, paid orders are not. */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
vi.mock('@/lib/actions/payment', () => ({ processRefund: vi.fn() }));
import PaymentTransactionsTable from '@/components/admin/PaymentTransactionsTable';
import type { PaymentTransaction } from '@/types/payment';

afterEach(cleanup);
const row = (id: string, status: string) => ({
  id, session_id: `cs_test_${id}`, user_id: null, customer_email: 'a@example.com', amount: 10000, currency: 'PLN',
  status, refunded_amount: 0, created_at: '2026-10-18T03:18:00Z', stripe_payment_intent_id: null, product_id: 'p', metadata: {},
}) as unknown as PaymentTransaction;

it.each([['en', en, /Payment attempt/], ['pl', pl, /Próba płatności/]] as const)('labels pending and abandoned rows as attempts in %s', (locale, messages, note) => {
  render(createElement(NextIntlClientProvider, { locale, messages: messages as never },
    createElement(PaymentTransactionsTable, { transactions: [row('11111111', 'completed'), row('22222222', 'pending'), row('33333333', 'abandoned')] })));
  expect(screen.getAllByText(note)).toHaveLength(2);
});
