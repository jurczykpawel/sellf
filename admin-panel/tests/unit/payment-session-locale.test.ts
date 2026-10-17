// @vitest-environment happy-dom
/** Recorded payment states in the session view. @see components/admin/PaymentSessionsTable.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import PaymentSessionsTable from '@/components/admin/PaymentSessionsTable';
import pl from '@/messages/pl.json';
import type { PaymentSession } from '@/types/payment';
afterEach(cleanup);
it.each([['refunded', 'Zwrócona'], ['partially_refunded', 'Częściowy zwrot'], ['disputed', 'Sporna'], ['abandoned', 'Porzucona']] as const)('renders %s in Polish without an invalid expiry date', (status, label) => {
  const session: PaymentSession = { id: 'payment', session_id: 'cs_test_record', provider_type: 'stripe', product_id: 'product', customer_email: 'buyer@example.com', amount: 10, currency: 'PLN', metadata: {}, created_at: '2026-10-17T12:00:00Z', updated_at: '2026-10-17T12:00:00Z', expires_at: '', status };
  render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, React.createElement(PaymentSessionsTable, { sessions: [session] })));
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText('Invalid Date')).toBeNull();
});
