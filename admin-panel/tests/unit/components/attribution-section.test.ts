// @vitest-environment happy-dom
/** Seller sees where an order came from in the payment details ("Źródło" box). */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

const action = vi.hoisted(() => ({ getPurchaseAttribution: vi.fn() }));
vi.mock('@/lib/actions/attribution', () => action);
import AttributionSection from '@/components/admin/AttributionSection';

afterEach(() => { cleanup(); vi.resetAllMocks(); });
const view = {
  channel: 'email', first_channel: 'paid_social', kind: 'payment', mode: 'stored', consent: 'analytics',
  last: { source: 'listmonk', medium: 'email', campaign: 'mail-05', content: 'cta-1', term: null, utm_id: null, referrer_host: null, landing_path: '/oferta', at: null },
  first: { source: 'facebook', medium: 'paid_social', campaign: 'jesien', content: null, term: null, utm_id: null, referrer_host: null, landing_path: '/', at: null },
  sessions_count: 3, first_seen_at: '2026-10-30T10:00:00Z', days_to_purchase: 4, click: null, device_class: 'mobile', country: 'PL',
  affiliate_member_id: null, recorded_at: '2026-11-03T10:00:00Z',
};

it('shows channel, last and first touch in Polish', async () => {
  action.getPurchaseAttribution.mockResolvedValue({ success: true, data: view });
  render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, React.createElement(AttributionSection, { transactionId: 't1' })));
  expect(await screen.findByText('Źródło')).toBeTruthy();
  expect(screen.getByText('E-mail')).toBeTruthy();
  expect(screen.getByText(/listmonk \/ email/)).toBeTruthy();
  expect(screen.getByText(/mail-05/)).toBeTruthy();
  expect(screen.getByText(/facebook \/ paid_social/)).toBeTruthy();
});

it('says plainly when an order has no recorded source', async () => {
  action.getPurchaseAttribution.mockResolvedValue({ success: true, data: null });
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(AttributionSection, { transactionId: 't2' })));
  expect(await screen.findByText('No source recorded for this order')).toBeTruthy();
});
