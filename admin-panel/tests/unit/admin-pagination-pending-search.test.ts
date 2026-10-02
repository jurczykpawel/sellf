// @vitest-environment happy-dom
/** Regression: pagination must wait for the debounced search's first page. */
import React, { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CouponsPageContent from '@/components/CouponsPageContent';
import PaymentsDashboard from '@/components/admin/PaymentsDashboard';

const mocks = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  fetchPaymentsPage: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock('next-intl', () => ({ useTranslations: () => mocks.translate }));
vi.mock('@/lib/coupons/fetch-coupons-page', () => ({ fetchCouponsPage: mocks.fetchPage }));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: async () => [] }));
vi.mock('@/lib/api/client', () => ({
  api: {
    listAll: async () => ({ data: [], truncated: false }),
    getCustom: async () => ({}),
  },
  ApiError: class extends Error {},
}));
vi.mock('@/components/CouponFormModal', () => ({ default: () => null }));
vi.mock('@/lib/payments/fetch-transactions-page', () => ({
  fetchPaymentTransactionsPage: mocks.fetchPaymentsPage,
  dateRangeToDateFrom: () => undefined,
}));
vi.mock('@/components/admin/PaymentStatsCards', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentTransactionsTable', () => ({ default: () => null }));
vi.mock('@/components/admin/PaymentSessionsTable', () => ({ default: () => null }));
vi.mock('@/components/dashboard/CurrencySelector', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('keeps payment pagination disabled through debounce and the filtered first-page request', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  const firstPage = { transactions: [], nextCursor: 'unfiltered-cursor', hasMore: true };
  let resolveSearch!: (page: typeof firstPage) => void;
  mocks.fetchPaymentsPage
    .mockResolvedValueOnce(firstPage)
    .mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve; }))
    .mockResolvedValueOnce({ transactions: [], nextCursor: null, hasMore: false });

  const view = render(createElement(PaymentsDashboard));
  await act(async () => {});
  const button = view.getByRole('button', { name: 'loadMore' }) as HTMLButtonElement;
  fireEvent.change(view.getByRole('textbox', { name: 'search' }), { target: { value: 'buyer@example.com' } });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(mocks.fetchPaymentsPage).toHaveBeenCalledTimes(1);

  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(mocks.fetchPaymentsPage).toHaveBeenCalledTimes(2);

  await act(async () => { resolveSearch({ ...firstPage, nextCursor: 'searched-cursor' }); });
  expect(button.disabled).toBe(false);
  await act(async () => { fireEvent.click(button); });
  expect(mocks.fetchPaymentsPage).toHaveBeenLastCalledWith('searched-cursor', {
    status: 'all', search: 'buyer@example.com', dateRange: 'all',
  });
});

it('blocks the old cursor while search is pending, then loads more with the searched cursor', async () => {
  vi.useFakeTimers();
  const firstPage = { coupons: [], nextCursor: 'unfiltered-cursor', hasMore: true };
  let resolveSearch!: (page: typeof firstPage) => void;
  mocks.fetchPage
    .mockResolvedValueOnce(firstPage)
    .mockImplementationOnce(() => new Promise(resolve => { resolveSearch = resolve; }))
    .mockResolvedValueOnce({ coupons: [], nextCursor: null, hasMore: false });

  const view = render(createElement(CouponsPageContent));
  await act(async () => {});
  const button = view.getByRole('button', { name: 'loadMore' }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);

  fireEvent.change(view.getByRole('textbox', { name: 'search' }), { target: { value: 'PG-marker' } });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(mocks.fetchPage).toHaveBeenCalledTimes(1);

  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(view.queryByRole('button', { name: 'loadMore' })).toBeNull();
  expect(mocks.fetchPage).toHaveBeenLastCalledWith(undefined, { type: 'all', search: 'PG-marker' });

  await act(async () => { resolveSearch({ ...firstPage, nextCursor: 'searched-cursor' }); });
  const searchedButton = view.getByRole('button', { name: 'loadMore' }) as HTMLButtonElement;
  expect(searchedButton.disabled).toBe(false);
  await act(async () => { fireEvent.click(searchedButton); });
  expect(mocks.fetchPage).toHaveBeenLastCalledWith('searched-cursor', { type: 'all', search: 'PG-marker' });
  expect(view.queryByRole('button', { name: 'loadMore' })).toBeNull();
});
