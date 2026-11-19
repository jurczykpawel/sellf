// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'buyer' }, loading: false }) }));
vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/MySubscriptions', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ rpc: async () => ({ data: [{ transaction_id: 'order', product_id: 'product', product_name: 'Cancelled transfer', amount: 4700, currency: 'PLN', status: 'cancelled', purchase_date: '2026-11-19T12:00:00Z', created_at: '2026-11-19T12:00:00Z' }], error: null }), from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }) }));
import MyPurchasesPage from '@/app/[locale]/my-purchases/page';
afterEach(cleanup);
it.each(['pl', 'en'] as const)('shows cancelled transfer as cancelled in %s', async locale => {
  render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' }, createElement(MyPurchasesPage)));
  await screen.findByText('Cancelled transfer');
  expect(screen.getByText(locale === 'pl' ? 'Anulowane — nie opłacaj tego zamówienia' : 'Cancelled — do not pay this order')).toBeTruthy();
  expect(screen.queryByText(locale === 'pl' ? 'Zakończono' : 'Completed')).toBeNull();
});
