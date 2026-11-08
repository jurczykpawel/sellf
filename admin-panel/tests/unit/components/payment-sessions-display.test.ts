// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PaymentSessionsTable from '@/components/admin/PaymentSessionsTable';
import type { PaymentSession } from '@/types/payment';
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
afterEach(cleanup);
const session = { id: 'bank', session_id: null, product_id: null, customer_email: 'buyer@example.com', amount: 2000, currency: 'pln', status: 'awaiting_payment', created_at: '2026-11-08T10:00:00Z', expires_at: null } as unknown as PaymentSession;
it('renders transfer rows with nullable Stripe and product identifiers', () => {
  render(createElement(PaymentSessionsTable, { sessions: [session] }));
  expect(screen.getByText('buyer@example.com')).toBeTruthy();
});
it.each([['pln', 2000], ['jpy', 2000], ['usd', 2000]])('renders %s using its minor unit exponent', (currency, amount) => {
  render(createElement(PaymentSessionsTable, { sessions: [{ ...session, session_id: 'cs_example', product_id: 'product-id', currency, amount }] }));
  const expected = new Intl.NumberFormat('en', { style: 'currency', currency }).format(currency === 'jpy' ? 2000 : 20);
  expect(screen.getByText(expected.replace(/\s/g, ' '))).toBeTruthy();
});
