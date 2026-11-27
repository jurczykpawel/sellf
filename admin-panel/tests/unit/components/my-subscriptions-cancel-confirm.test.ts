// @vitest-environment happy-dom
/**
 * "Cancel subscription" in My purchases asks for confirmation first: one click used to schedule the
 * cancellation at once (W351, QA3-G U4a). The dialog is keyboard-operable and focus returns to the button.
 * @see src/components/MySubscriptions.tsx
 */
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import MySubscriptions from '@/components/MySubscriptions';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const fetchMock = vi.fn();
let cancelled = false;
const subscription = () => ({ id: 'sub-1', status: 'active', current_period_start: '2026-11-27T00:00:00Z', current_period_end: '2026-12-27T00:00:00Z',
  cancel_at_period_end: cancelled, canceled_at: null, trial_end: null, stripe_subscription_id: 'sub_x',
  product: { id: 'p', name: 'Pro plan', slug: 'pro', currency: 'PLN', recurring_price: 30, billing_interval: 'month', billing_interval_count: 1 } });
beforeEach(() => {
  cancelled = false;
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { cancelled = true; return new Response('{}', { status: 200 }); }
    return new Response(JSON.stringify({ subscriptions: [subscription()] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const copy = {
  pl: { cancel: 'Anuluj subskrypcję', title: 'Anulować subskrypcję?', keep: 'Nie, zostaw', confirm: 'Tak, anuluj', resume: 'Wznów subskrypcję' },
  en: { cancel: 'Cancel subscription', title: 'Cancel this subscription?', keep: 'No, keep it', confirm: 'Yes, cancel', resume: 'Resume subscription' },
};
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

it.each(['pl', 'en'] as const)('asks before cancelling and dismissing returns focus to the button (%s)', async locale => {
  await act(async () => { render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' }, createElement(MySubscriptions))); });
  const opener = await screen.findByRole('button', { name: copy[locale].cancel });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: copy[locale].title });
  expect(dialog.textContent).toContain('Pro plan');
  expect(posts()).toHaveLength(0);
  // The safe choice has focus: Enter right after opening does not cancel.
  expect(document.activeElement).toBe(screen.getByRole('button', { name: copy[locale].keep }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(posts()).toHaveLength(0);

  fireEvent.click(opener);
  fireEvent.click(screen.getByRole('button', { name: copy[locale].keep }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(posts()).toHaveLength(0);
});

it.each(['pl', 'en'] as const)('cancels only after confirmation and moves focus to the resume button (%s)', async locale => {
  await act(async () => { render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' }, createElement(MySubscriptions))); });
  fireEvent.click(await screen.findByRole('button', { name: copy[locale].cancel }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy[locale].confirm })); });
  expect(posts().map(([url]) => url)).toEqual(['/api/subscriptions/sub-1/cancel']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(await screen.findByRole('button', { name: copy[locale].resume }));
});
