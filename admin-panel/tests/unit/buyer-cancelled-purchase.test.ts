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
const cancelledRow = { transaction_id: 'order', product_id: 'product', product_name: 'Cancelled transfer', amount: 4700, currency: 'PLN', status: 'cancelled', purchase_date: '2026-11-19T12:00:00Z', created_at: '2026-11-19T12:00:00Z' };
const rows = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ rpc: async () => ({ data: [...rows], error: null }), from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }) }));
import MyPurchasesPage from '@/app/[locale]/my-purchases/page';
rows.push(cancelledRow);
afterEach(cleanup);
it.each(['pl', 'en'] as const)('shows cancelled transfer as cancelled in %s', async locale => {
  render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' }, createElement(MyPurchasesPage)));
  await screen.findByText('Cancelled transfer');
  expect(screen.getByText(locale === 'pl' ? 'Anulowane — nie opłacaj tego zamówienia' : 'Cancelled — do not pay this order')).toBeTruthy();
  expect(screen.queryByText(locale === 'pl' ? 'Zakończono' : 'Completed')).toBeNull();
});

// W351 (QA3-G U4b): "Zakończono"/"Completed" read as "subscription ended" on an active subscription's payment.
it.each(['pl', 'en'] as const)('labels a completed payment as paid, not as ended, in %s', async locale => {
  rows.splice(0, rows.length, { transaction_id: 'paid-order', product_id: 'product', product_name: 'Monthly plan', amount: 3000, currency: 'PLN', status: 'completed', purchase_date: '2026-11-19T12:00:00Z', created_at: '2026-11-19T12:00:00Z' });
  try {
    render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' }, createElement(MyPurchasesPage)));
    await screen.findByText('Monthly plan');
    expect(screen.getByText(locale === 'pl' ? 'Opłacono' : 'Paid', { selector: 'span.rounded-full' })).toBeTruthy();
    expect(screen.queryByText(locale === 'pl' ? 'Zakończono' : 'Completed')).toBeNull();
  } finally { rows.splice(0, rows.length, cancelledRow); }
});

// W351 review: "Opłacono"/"Paid" only for a paid payment. Pending/abandoned rows are filtered out of the
// list today (page.tsx); any other unpaid status that reaches the badge must not claim it was paid.
it.each(['pl', 'en'] as const)('never labels an unpaid status as paid in %s', async locale => {
  rows.splice(0, rows.length,
    { transaction_id: 'partial', product_id: 'product', product_name: 'Partly refunded plan', amount: 3000, refunded_amount: 1000, currency: 'PLN', status: 'partially_refunded', purchase_date: '2026-11-19T12:00:00Z', created_at: '2026-11-19T12:00:00Z' },
    { transaction_id: 'unknown', product_id: 'product', product_name: 'Unsettled plan', amount: 3000, currency: 'PLN', status: 'processing', purchase_date: '2026-11-19T12:00:00Z', created_at: '2026-11-19T12:00:00Z' },
    { transaction_id: 'pending', product_id: 'product', product_name: 'Open checkout', amount: 3000, currency: 'PLN', status: 'pending', purchase_date: '2026-11-19T12:00:00Z', created_at: '2026-11-19T12:00:00Z' });
  try {
    render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC' }, createElement(MyPurchasesPage)));
    await screen.findByText('Unsettled plan');
    expect(screen.queryByText('Open checkout')).toBeNull();
    const badges = screen.getAllByText(/./, { selector: 'span.rounded-full' }).map(node => node.textContent);
    expect(badges.filter(text => text === (locale === 'pl' ? 'Opłacono' : 'Paid'))).toHaveLength(1);
    expect(badges).toContain(locale === 'pl' ? 'Oczekuje na płatność' : 'Payment pending');
  } finally { rows.splice(0, rows.length, cancelledRow); }
});
