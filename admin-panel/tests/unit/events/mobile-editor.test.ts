// @vitest-environment happy-dom
/** Buyer event ranges and event-zone authoring. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EventSection } from '@/components/ProductFormModal/sections/EventSection';
import EventSessions from '@/components/checkout/EventSessions';
import { addEmbedOptions } from '@/lib/videoUtils';
import pl from '@/messages/pl.json';
import type { ProductFormData } from '@/components/ProductFormModal/types';
import type { EventSession } from '@/lib/events/presentation';
vi.mock('@/lib/events/actions', () => ({ getEventAdmin: vi.fn(), exportEventParticipants: vi.fn() }));
afterEach(cleanup);
const wrap = (child: React.ReactNode) => React.createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, child);
it.each([['2026-10-22', '16'], ['2026-01-22', '17']])('stores Warsaw 18:00 as UTC on %s', (day, hour) => {
  const formData = { event_mode: true, currency: 'PLN', price: 30, sessions: [{ starts_at: `${day}T${hour}:00:00.000Z`, timezone: 'Europe/Warsaw', sales_open: true, sort: 0, tiers: [{ label: '', price: 30, sort: 0 }] }] } as ProductFormData;
  const setFormData = vi.fn();
  render(wrap(React.createElement(EventSection, { formData, setFormData })));
  const start = screen.getByLabelText(/Początek/);
  expect((start as HTMLInputElement).value).toBe(`${day}T18:00`);
  fireEvent.change(start, { target: { value: `${day}T18:30` } });
  expect(setFormData.mock.calls[0][0](formData).sessions[0].starts_at).toBe(`${day}T${hour}:30:00.000Z`);
  const end = screen.getByLabelText(/Koniec sprzedaży/);
  fireEvent.change(end, { target: { value: `${day}T18:00` } });
  expect(setFormData.mock.calls[1][0](formData).sessions[0].tiers[0].sale_ends_at).toBe(`${day}T${hour}:00:00.000Z`);
});
it('gives event actions visible button borders and padding', () => {
  render(wrap(React.createElement(EventSection, { formData: { event_mode: true, sessions: [{ starts_at: '', timezone: 'Europe/Warsaw', tiers: [{}] }] } as ProductFormData, setFormData: vi.fn() })));
  for (const name of ['Dodaj próg', 'Usuń próg', 'Usuń termin', 'Dodaj termin']) expect(screen.getByRole('button', { name }).className).toMatch(/border/);
});
it('shows the time range with a single timezone label', () => {
  render(wrap(React.createElement(EventSessions, { sessions: [{ id: 's', startsAt: '2026-10-22T16:00:00Z', endsAt: '2026-10-22T18:00:00Z', timezone: 'Europe/Warsaw', soldOut: true }] as EventSession[], currency: 'PLN', selected: null, onSelect: vi.fn() })));
  expect(screen.getByText(/18:00–20:00/).textContent).toContain('(Europe/Warsaw)');
});
it('adds the single video playlist only when looping', () => {
  const url = 'https://www.youtube.com/embed/abcdefghijk';
  expect(new URL(addEmbedOptions(url, { loop: true })).searchParams.get('playlist')).toBe('abcdefghijk');
  expect(new URL(addEmbedOptions(url)).searchParams.has('playlist')).toBe(false);
});
it('keeps a focus-visible skip link before buyer menus with focusable targets', async () => {
  const { readFileSync } = await import('node:fs');
  const locale = readFileSync('src/app/[locale]/layout.tsx', 'utf8');
  expect(locale).toContain('href="#buyer-content"');
  expect(locale).toContain('focus:not-sr-only');
  for (const file of ['src/components/DashboardLayout.tsx', 'src/app/[locale]/checkout/[slug]/components/ProductPurchaseView.tsx']) expect(readFileSync(file, 'utf8')).toMatch(/id="buyer-content" tabIndex=\{-1\}/);
});
it('reserves mobile space for the profile toolbar and hides unavailable event coupons', async () => {
  const { readFileSync } = await import('node:fs');
  expect(readFileSync('src/app/[locale]/checkout/[slug]/components/ProductPurchaseView.tsx', 'utf8')).toContain('pt-20 sm:pt-0');
  expect(readFileSync('src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx', 'utf8')).toMatch(/!isSubscription && !hasAccess && !error && !isPwywFree && eventReady/);
});
