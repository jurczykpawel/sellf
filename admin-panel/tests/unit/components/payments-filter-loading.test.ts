// @vitest-environment happy-dom
/**
 * Payments status filter: the table is marked busy until the new rows arrive, and the last
 * request wins when the filter changes quickly.
 * @see src/components/admin/PaymentsDashboard.tsx
 */
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PaymentsDashboard from '@/components/admin/PaymentsDashboard';
const { page, filtersRef } = vi.hoisted(() => ({
  page: vi.fn(), filtersRef: { set: (() => {}) as (status: string) => void },
}));
vi.mock('@/lib/payments/fetch-transactions-page', () => ({ fetchPaymentTransactionsPage: page, dateRangeToDateFrom: () => null }));
vi.mock('@/lib/api/client', () => ({
  api: { getCustom: vi.fn().mockResolvedValue({ total_transactions: 0 }) }, isExpectedApiError: () => false,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/components/dashboard/CurrencySelector', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentStatsCards', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentSessionsTable', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentFilters', () => ({
  default: (props: { filters: object; onFiltersChange: (f: object) => void }) => {
    filtersRef.set = (status: string) => props.onFiltersChange({ ...props.filters, status });
    return null;
  },
}));
vi.mock('@/components/admin/PaymentTransactionsTable', () => ({
  default: ({ transactions }: { transactions: { id: string }[] }) =>
    createElement('div', { 'data-testid': 'rows' }, transactions.map(row => row.id).join(',')),
}));
afterEach(() => { cleanup(); page.mockReset(); vi.stubGlobal('fetch', undefined); });

const rows = (id: string) => ({ transactions: [{ id }], nextCursor: null, hasMore: false });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const mount = async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  page.mockResolvedValueOnce(rows('pending'));
  render(createElement(PaymentsDashboard));
  await act(async () => {});
};

it('marks the table busy until the filtered rows arrive', async () => {
  await mount();
  const next = deferred<ReturnType<typeof rows>>();
  page.mockReturnValueOnce(next.promise);
  act(() => { filtersRef.set('completed'); });
  expect(screen.getByTestId('rows').closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
  await act(async () => { next.resolve(rows('completed')); });
  expect(screen.getByTestId('rows').closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
  expect(screen.getByTestId('rows').textContent).toBe('completed');
});

it('ignores a slower answer to an earlier filter', async () => {
  await mount();
  const first = deferred<ReturnType<typeof rows>>();
  const second = deferred<ReturnType<typeof rows>>();
  page.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  act(() => { filtersRef.set('completed'); });
  act(() => { filtersRef.set('refunded'); });
  await act(async () => { second.resolve(rows('refunded')); });
  await act(async () => { first.resolve(rows('completed')); });
  expect(screen.getByTestId('rows').textContent).toBe('refunded');
});
