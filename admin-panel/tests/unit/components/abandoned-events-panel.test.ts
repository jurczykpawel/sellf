// @vitest-environment happy-dom
/**
 * The admin sees business events abandoned before webhook delivery and can put one back in the
 * queue; with none abandoned the panel stays out of the way.
 * @see src/components/webhooks/AbandonedEventsPanel.tsx
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AbandonedEventsPanel from '@/components/webhooks/AbandonedEventsPanel';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

const abandoned = { id: 'e1', event_type: 'license.issued', product_id: null, created_at: '2026-11-15T08:00:00Z', attempts: 8, last_error: 'Cannot read properties of null', abandoned_at: '2026-11-15T16:00:00Z' };
const state = { events: [] as unknown[] };
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') {
    state.events = [];
    return new Response(JSON.stringify({ data: { status: 'rescheduled' } }), { status: 200 });
  }
  return new Response(JSON.stringify({ data: state.events, pagination: { has_more: false, next_cursor: null } }), { status: 200 });
});
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); fetchMock.mockClear(); vi.unstubAllGlobals(); });

const view = (locale: 'pl' | 'en') => createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'Europe/Warsaw' }, createElement(AbandonedEventsPanel));

it('lists abandoned events and retries one (PL)', async () => {
  state.events = [abandoned];
  render(view('pl'));
  expect(await screen.findByText('Zdarzenia porzucone przed wysyłką')).toBeTruthy();
  expect(screen.getByText('license.issued')).toBeTruthy();
  expect(screen.getByText('Cannot read properties of null')).toBeTruthy();
  expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/webhooks/events?status=abandoned');
  fireEvent.click(screen.getByRole('button', { name: 'Ponów' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/webhooks/events/e1/retry', expect.objectContaining({ method: 'POST' })));
  await waitFor(() => expect(screen.queryByText('Zdarzenia porzucone przed wysyłką')).toBeNull());
});

it('uses English texts and renders nothing without abandoned events', async () => {
  state.events = [abandoned];
  render(view('en'));
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  cleanup();
  state.events = [];
  const { container } = render(view('en'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(container.textContent).toBe('');
});
