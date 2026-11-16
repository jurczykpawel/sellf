// @vitest-environment happy-dom
/**
 * "I have sent the transfer" after the reservation deadline (before the release job cancels)
 * only tells the seller. The page must not promise an extension; it says the seller was told and may accept a transfer
 * that arrives after the cancellation. Before the deadline the reservation is extended as before.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TransferDeclaration from '@/components/checkout/TransferDeclaration';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const id = '10000000-0000-4000-8000-000000000001';
const LATE_PL = 'Daliśmy znać sprzedawcy. Jeśli przelew dojdzie po anulowaniu, sprzedawca może go przyjąć';
const LATE_EN = 'We have let the seller know. If the transfer arrives after the cancellation, the seller can accept it';
function renderDeclaration(locale: 'pl' | 'en', props: { overdue?: boolean; declaredAt?: string | null } = {}) {
  return render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' },
    createElement(TransferDeclaration, { orderId: id, token: 't', declaredAt: props.declaredAt ?? null, overdue: props.overdue ?? false })));
}
function answer(body: object) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock); return fetchMock;
}

describe('"I have sent the transfer" past the deadline', () => {
  it('keeps the button, does not promise an extension and says the seller was told (PL)', async () => {
    answer({ declaredAt: '2026-11-15T12:05:00Z', releaseAt: '2026-11-15T12:00:00Z', afterDeadline: true });
    renderDeclaration('pl', { overdue: true });
    expect(document.body.textContent).not.toContain('rezerwacja zostanie przedłużona');
    fireEvent.click(screen.getByRole('button', { name: 'Wysłałem przelew' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(LATE_PL));
    expect(screen.getByRole('status').textContent).not.toContain('Rezerwacja przedłużona');
  });
  it('says the same in English', async () => {
    answer({ declaredAt: '2026-11-15T12:05:00Z', releaseAt: '2026-11-15T12:00:00Z', afterDeadline: true });
    renderDeclaration('en', { overdue: true });
    fireEvent.click(screen.getByRole('button', { name: 'I have sent the transfer' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(LATE_EN));
    expect(screen.getByRole('status').textContent).not.toContain('Reservation extended');
  });
  it('after a reload of an overdue order already declared, shows the same notice', () => {
    renderDeclaration('pl', { overdue: true, declaredAt: '2026-11-15T12:05:00Z' });
    expect(screen.getByRole('status').textContent).toContain(LATE_PL);
  });
  it('before the deadline the reservation is extended as before', async () => {
    answer({ declaredAt: '2026-11-15T10:00:00Z', releaseAt: '2026-11-18T10:00:00Z', afterDeadline: false });
    renderDeclaration('pl');
    fireEvent.click(screen.getByRole('button', { name: 'Wysłałem przelew' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Rezerwacja przedłużona do'));
    expect(screen.getByRole('status').textContent).not.toContain(LATE_PL);
  });
});
