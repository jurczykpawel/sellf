// @vitest-environment happy-dom
/** Buyer discovery shows flexible prices. @see app/[locale]/my-products/page.tsx */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const user = { id: 'buyer' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user, loading: false }) }));
vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query, neq: () => query, not: () => query, is: () => query, order: () => query,
    then: (resolve: (value: unknown) => void) => resolve({ data: table === 'products' ? [{ id: 'guide', name: 'Community Guide', slug: 'guide', description: 'Flexible', currency: 'USD', price: 19.99, allow_custom_price: true, custom_price_min: 0, is_active: true }] : [] }) };
  return query;
} }) }));
import MyProducts from '@/app/[locale]/my-products/page';
afterEach(cleanup);
it.each(['en', 'pl'] as const)('%s shows PWYW minimum and label', async locale => {
  render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC', children: React.createElement(MyProducts) }));
  await screen.findByText('Community Guide');
  expect(screen.getByText(locale === 'pl' ? /od.*0,00/ : /from.*0.00/)).toBeTruthy();
  expect(screen.getByText(locale === 'pl' ? pl.variants.payWhatYouWant : en.variants.payWhatYouWant)).toBeTruthy();
  expect(screen.queryAllByText('Premium').filter(element => element.tagName !== 'H3')).toHaveLength(0);
});
