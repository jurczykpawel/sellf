// @vitest-environment happy-dom
/**
 * W254c: past the reservation deadline, before the release job cancels the order, the buyer's order page used to say
 * "reserved until <a date in the past>" next to the transfer details, an invitation to pay an order about to be cancelled.
 * Now it says the deadline passed and the order will be cancelled soon, without the transfer details.
 */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import { isReservationOverdue } from '@/lib/orders/transfer-format';
import { quoteOrderPayment } from '@/lib/orders/quick-pay';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);

const now = new Date('2026-11-15T12:00:00Z');
const order = { status: 'awaiting_payment', release_at: '2026-11-15T11:59:00Z' };

describe('isReservationOverdue', () => {
  it('is true only for an unpaid order whose reservation deadline has passed', () => {
    expect(isReservationOverdue(order, now)).toBe(true);
    expect(isReservationOverdue({ ...order, release_at: '2026-11-15T12:00:00Z' }, now)).toBe(true);
    expect(isReservationOverdue({ ...order, release_at: '2026-11-15T12:01:00Z' }, now)).toBe(false);
    // An invoice hold or a plain payment term has no release_at: never overdue on this page.
    expect(isReservationOverdue({ ...order, release_at: null }, now)).toBe(false);
    for (const status of ['completed', 'cancelled', 'refunded']) expect(isReservationOverdue({ ...order, status }, now)).toBe(false);
  });
  it('is the same rule the online payment uses to refuse a new attempt', () => {
    const tx = { payment_provider: 'bank_transfer', amount: 10000, currency: 'PLN', product_id: 'p', ...order };
    expect(quoteOrderPayment(tx, now)).toEqual({ mode: 'unavailable', reason: 'payment_window_closed' });
    expect(quoteOrderPayment({ ...tx, release_at: '2026-11-15T12:01:00Z' }, now)).toMatchObject({ mode: 'settle' });
  });
});

describe('order page past the deadline', () => {
  const account = 'PL61109010140000071219812874';
  const renderPage = (locale: 'pl' | 'en') => render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' },
    createElement(TransferInstructions, { overdue: true, transfer: { account, holder: 'Sprzedawca', title: 'Zamówienie 7' }, amount: 10000, currency: 'PLN', dueAt: order.release_at })));
  it('tells the buyer the deadline passed and hides the transfer details (PL)', () => {
    renderPage('pl');
    expect(screen.getByRole('alert').textContent).toContain('Termin płatności minął — zamówienie zostanie wkrótce anulowane');
    expect(document.body.textContent).not.toContain('6110 9010');
    expect(screen.queryByRole('region', { name: pl.bankTransfer.instructions })).toBeNull();
  });
  it('tells the buyer the deadline passed and hides the transfer details (EN)', () => {
    renderPage('en');
    expect(screen.getByRole('alert').textContent).toContain('The payment deadline has passed — the order will be cancelled soon');
    expect(document.body.textContent).not.toContain('6110 9010');
  });
});
