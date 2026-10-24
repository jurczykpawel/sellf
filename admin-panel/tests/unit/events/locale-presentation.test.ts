// @vitest-environment happy-dom
/** Event seat counts and reservation labels follow the page locale. */
import React from 'react';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EventSection } from '@/components/ProductFormModal/sections/EventSection';
import { exportEventParticipants } from '@/lib/events/actions';
import { participantCsv } from '@/lib/events/presentation';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { ProductFormData } from '@/components/ProductFormModal/types';

const orders = ['held', 'confirmed', 'released'].map(status => ({ transaction_id: `order-${status}`, status, customer_email: `${status}@example.com` }));
vi.mock('@/lib/events/actions', () => ({
  getEventAdmin: async () => ({ success: true, data: { sold: 1, held: 1, orders, availability: {
    starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', title: 'Workshop', remaining: 1,
    current_tier: { price: 30, seats_left: 1, ends_at: null }, next_tier_price: null,
  } } }),
  exportEventParticipants: vi.fn(),
}));
afterEach(cleanup);
it.each([
  [0, 'Zostało 0 miejsc'], [1, 'Zostało 1 miejsce'], [2, 'Zostały 2 miejsca'], [5, 'Zostało 5 miejsc'],
  [12, 'Zostało 12 miejsc'], [21, 'Zostało 21 miejsc'], [22, 'Zostały 22 miejsca'], [101, 'Zostało 101 miejsc'], [1.5, 'Zostało 1,5 miejsca'],
])('Polish seats: %s', (count, expected) => {
  const t = createTranslator({ locale: 'pl', messages: pl, namespace: 'events' });
  expect(t('seatsLeft', { count })).toBe(`${expected} w tej cenie`);
});
it.each([[1, '1 seat'], [2, '2 seats'], [0, '0 seats']])('English seats: %s', (count, expected) => {
  const t = createTranslator({ locale: 'en', messages: en, namespace: 'events' });
  expect(t('seatsLeft', { count })).toBe(`${expected} left at this price`);
});
it.each(['pl', 'en'] as const)('%s translates reservation statuses only in the event panel', async locale => {
  const messages = locale === 'pl' ? pl : en;
  const formData = { event_mode: true, currency: 'PLN', price: 30, sessions: [{ id: '11111111-1111-4111-a111-111111111111',
    starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', sales_open: true, sort: 0, tiers: [],
  }] } as ProductFormData;
  render(React.createElement(NextIntlClientProvider, { locale, messages }, React.createElement(EventSection, { formData, setFormData: vi.fn() })));
  expect(screen.getByRole('button', { name: messages.events.preview }).className.split(' ')).toEqual(expect.arrayContaining(['border', 'bg-sf-raised', 'px-4', 'py-2', 'focus-visible:ring-2']));
  fireEvent.click(screen.getByRole('button', { name: messages.events.preview }));
  const table = await screen.findByRole('table');
  for (const label of locale === 'pl' ? ['Zarezerwowane', 'Potwierdzone', 'Zwolnione'] : ['Reserved', 'Confirmed', 'Released']) {
    expect(within(table).getByRole('cell', { name: label, exact: true })).toBeTruthy();
  }
  const csv = participantCsv(orders);
  expect(csv).toContain('"Order","Status","First name","Last name","Email"');
  for (const { status } of orders) expect(csv).toContain(`,"${status}",`);
});

it.each(['pl', 'en'] as const)('%s downloads a named participant file', async locale => {
  const messages = locale === 'pl' ? pl : en;
  vi.mocked(exportEventParticipants).mockResolvedValue({ success: true, data: '\uFEFFcsv' });
  const create = vi.fn(() => 'blob:participants'); const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const formData = { slug: 'warsztat', event_mode: true, currency: 'PLN', price: 30, sessions: [{ id: '11111111-1111-4111-a111-111111111111', starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', sales_open: true, sort: 0, tiers: [] }] } as ProductFormData;
  render(React.createElement(NextIntlClientProvider, { locale, messages }, React.createElement(EventSection, { formData, setFormData: vi.fn() })));
  fireEvent.click(screen.getByRole('button', { name: messages.events.preview }));
  fireEvent.click(await screen.findByRole('button', { name: messages.events.export }));
  await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(click.mock.instances[0].download).toBe(`${locale === 'pl' ? 'uczestnicy' : 'participants'}-warsztat-2099-06-01.csv`);
  expect(create.mock.calls[0]).toHaveLength(1);
  expect(revoke).toHaveBeenCalledWith('blob:participants');
  click.mockRestore(); vi.unstubAllGlobals();
});
