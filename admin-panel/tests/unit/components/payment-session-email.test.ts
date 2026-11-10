// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import PaymentSessionsTable from '@/components/admin/PaymentSessionsTable';
import type { PaymentSession } from '@/types/payment';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);
it.each(['en', 'pl'])('shows unknown instead of the guest placeholder in %s', locale => {
  const base: PaymentSession = { id: 's', session_id: null, product_id: null, provider_type: 'stripe', customer_email: 'pending@sellf.app', amount: 1000, currency: 'PLN', status: 'pending', metadata: {}, created_at: '2026-11-01', updated_at: '2026-11-01', expires_at: null };
  const { container } = render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, createElement(PaymentSessionsTable, { sessions: [base, { ...base, id: 'real', customer_email: 'buyer@example.com' }, { ...base, id: 'empty', customer_email: '' }] })));
  expect(container.textContent).not.toContain('pending@sellf.app');
  expect(screen.getAllByText(locale === 'pl' ? 'Nieznany klient' : 'Unknown customer')).toHaveLength(2);
  expect(screen.getByText('buyer@example.com')).toBeTruthy();
});
