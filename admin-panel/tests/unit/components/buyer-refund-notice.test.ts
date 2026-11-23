// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import MyPurchasesPage from '@/app/[locale]/my-purchases/page';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ rpc, from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'buyer' }, loading: false }) }));
vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/MySubscriptions', () => ({ default: () => null }));
afterEach(cleanup);
it.each([['en', en, 'My purchases'], ['pl', pl, 'Moich zakupach']] as const)('shows the available decision channel in %s', async (locale, messages, channel) => {
  rpc.mockResolvedValue({ data: [{ transaction_id: 'tx', product_name: 'Course', amount: 900, currency: 'PLN', status: 'completed', is_refundable: true, refund_eligible: true, refund_request_status: null, purchase_date: new Date().toISOString(), refund_period_days: 14 }], error: null });
  render(createElement(NextIntlClientProvider, { locale, messages, children: createElement(MyPurchasesPage) }));
  fireEvent.click(await screen.findByRole('button', { name: messages.myPurchases.requestRefund }));
  expect(screen.getByText(messages.myPurchases.refundWarning).textContent).toContain(channel);
  expect(messages.myPurchases.refundWarning).not.toMatch(/will receive a response via email|Otrzymasz odpowiedź na email/);
});
