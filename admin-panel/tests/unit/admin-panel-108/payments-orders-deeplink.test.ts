// @vitest-environment happy-dom
/**
 * `/dashboard/payments?order=1300` searches that order and opens it; the Orders tab
 * lists every kind of order with type/status filters.
 * @see src/components/admin/PaymentsDashboard.tsx
 * @see src/components/admin/OrdersTable.tsx
 */
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PaymentsDashboard from '@/components/admin/PaymentsDashboard';

const { page, replace, params, tableProps } = vi.hoisted(() => ({
  page: vi.fn(), replace: vi.fn(), params: { value: new URLSearchParams() },
  tableProps: { last: null as null | { initialDetailsId?: string | null } },
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => params.value, usePathname: () => '/pl/dashboard/payments' }));
vi.mock('@/lib/payments/fetch-transactions-page', () => ({ fetchPaymentTransactionsPage: page, dateRangeToDateFrom: () => null }));
vi.mock('@/lib/api/client', () => ({ api: { getCustom: vi.fn().mockResolvedValue({ total_transactions: 0 }) }, isExpectedApiError: () => false }));
const stableT = (key: string) => key;
vi.mock('next-intl', () => ({ useTranslations: () => stableT, useLocale: () => 'pl', useFormatter: () => ({ dateTime: () => '' }) }));
vi.mock('@/lib/actions/orders-missing-participants', () => ({ getOrdersMissingParticipants: vi.fn().mockResolvedValue({ success: true, data: [] }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/components/dashboard/CurrencySelector', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentStatsCards', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentSessionsTable', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentFilters', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentTransactionsTable', () => ({
  default: (props: { initialDetailsId?: string | null }) => { tableProps.last = props; return createElement('div', { 'data-testid': 'tx' }, props.initialDetailsId ?? 'none'); },
}));
afterEach(() => { cleanup(); page.mockReset(); replace.mockReset(); vi.unstubAllGlobals(); params.value = new URLSearchParams(); });

const fetchMock = (orders: unknown[], nextCursor: string | null = null) => vi.fn(async (url: string) => ({
  ok: true, json: async () => (String(url).startsWith('/api/admin/orders') ? { orders, nextCursor } : []),
}));

it('opens the order number from the URL @J191', async () => {
  params.value = new URLSearchParams('order=1300');
  vi.stubGlobal('fetch', fetchMock([]));
  page.mockResolvedValue({ transactions: [{ id: 'tx-a', order_number: 1300 }], nextCursor: null, hasMore: false });
  await act(async () => { render(createElement(PaymentsDashboard)); });
  expect(page).toHaveBeenCalledWith(undefined, expect.objectContaining({ search: '1300' }));
  expect(screen.getByTestId('tx').textContent).toBe('tx-a');
});

it('lists all orders with a type filter on the Orders tab @J190', async () => {
  const fetch = fetchMock([
    { id: 'access:a2', type: 'free', status: 'active', createdAt: '2026-11-01T10:00:00Z', orderNumber: null, email: 'free@x.pl', productName: 'Poradnik', productId: 'p', productSlug: 'p', amount: null, currency: null, transactionId: null },
    { id: 'tx:t1', type: 'paid', status: 'completed', createdAt: '2026-11-02T10:00:00Z', orderNumber: 1300, email: 'a@x.pl', productName: 'Kurs', productId: 'p2', productSlug: 'k', amount: 9900, currency: 'pln', transactionId: 't1' },
  ]);
  vi.stubGlobal('fetch', fetch);
  page.mockResolvedValue({ transactions: [], nextCursor: null, hasMore: false });
  await act(async () => { render(createElement(PaymentsDashboard)); });
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /orders.title/ })); });
  expect(screen.getByText('free@x.pl')).toBeTruthy();
  expect(screen.getByText('#1300')).toBeTruthy();
  await act(async () => { fireEvent.change(screen.getByLabelText('typeFilter'), { target: { value: 'lead' } }); });
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/orders?type=lead'), expect.anything());
});

it('loads the next page of orders with the cursor @J190', async () => {
  const row = { id: 'access:a2', type: 'manual', status: 'active', createdAt: '2026-11-01T10:00:00Z', orderNumber: null, email: 'm@x.pl', productName: 'Kurs', productId: 'p', productSlug: 'p', amount: null, currency: null, transactionId: null };
  const fetch = fetchMock([row], 'CURSOR1');
  vi.stubGlobal('fetch', fetch);
  page.mockResolvedValue({ transactions: [], nextCursor: null, hasMore: false });
  await act(async () => { render(createElement(PaymentsDashboard)); });
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /orders.title/ })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'loadMore' })); });
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('cursor=CURSOR1'), expect.anything());
});
