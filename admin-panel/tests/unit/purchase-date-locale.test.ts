// @vitest-environment happy-dom
/** Purchase and renewal dates follow the page language. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MyPurchasesPage from '@/app/[locale]/my-purchases/page';
import { formatAdminDate } from '@/lib/timezone';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/contexts/AuthContext', () => {
  const user = { id: 'buyer', email: 'buyer@example.com' };
  return { useAuth: () => ({ user, loading: false }) };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  rpc: async () => ({ data: [{ transaction_id: 'tx', product_name: 'Course', purchase_date: '2026-10-18T12:00:00Z', amount: 3000, currency: 'PLN', status: 'completed', is_refundable: false }] }),
  from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }),
}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each(['en', 'pl'] as const)('renders purchase and renewal dates using %s', async locale => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ subscriptions: [{
    id: 'subscription', status: 'active', cancel_at_period_end: false, current_period_end: '2026-11-18T12:00:00Z',
    product: { name: 'Membership', currency: 'PLN', recurring_price: 30, billing_interval: 'month', billing_interval_count: 1 },
  }] }) }));
  const messages = locale === 'pl' ? pl : en;
  render(React.createElement(NextIntlClientProvider, { locale, messages }, React.createElement(MyPurchasesPage)));
  const purchaseDate = formatAdminDate('2026-10-18T12:00:00Z', locale, false);
  const renewalDate = formatAdminDate('2026-11-18T12:00:00Z', locale, false);
  expect(await screen.findByText(`${messages.myPurchases.purchasedOn} ${purchaseDate}`)).toBeTruthy();
  expect(await screen.findByText(text => text.includes(renewalDate))).toBeTruthy();
});
