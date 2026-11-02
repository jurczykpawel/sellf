// @vitest-environment happy-dom
/** Regression: a slower overlapping first-page load must not replace rows appended by "Load more". */
import React, { StrictMode, createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CouponsPageContent from '@/components/CouponsPageContent';

const mocks = vi.hoisted(() => ({ fetchPage: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('@/lib/coupons/fetch-coupons-page', () => ({ fetchCouponsPage: mocks.fetchPage }));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: async () => [] }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()),
  api: { listAll: async () => ({ data: [], truncated: false }), getCustom: async () => ({}) },
  ApiError: class extends Error {},
}));
vi.mock('@/components/CouponFormModal', () => ({ default: () => null }));

type Page = { coupons: { id: string; code: string }[]; nextCursor: string | null; hasMore: boolean };
const coupon = (code: string) => ({ id: code, code, discount_type: 'percentage', discount_value: 10, is_active: true });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('ignores a first-page response for a filter that is no longer current', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('React', React);
  const resolvers: ((page: Page) => void)[] = [];
  mocks.fetchPage.mockImplementation(() => new Promise<Page>(resolve => { resolvers.push(resolve); }));

  const view = render(createElement(CouponsPageContent));
  await act(async () => {});
  fireEvent.change(view.getByRole('textbox', { name: 'search' }), { target: { value: 'PG-marker' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(resolvers).toHaveLength(2);

  await act(async () => { resolvers[1]({ coupons: [coupon('SEARCHED')], nextCursor: null, hasMore: false }); });
  await act(async () => { resolvers[0]({ coupons: [coupon('STALE')], nextCursor: null, hasMore: false }); });
  expect(view.getByText('SEARCHED')).toBeTruthy();
  expect(view.queryByText('STALE')).toBeNull();
});

it('does not offer "Load more" until the newest first-page load has settled', async () => {
  vi.stubGlobal('React', React);
  const resolvers: ((page: Page) => void)[] = [];
  mocks.fetchPage.mockImplementation(() => new Promise<Page>(resolve => { resolvers.push(resolve); }));

  const view = render(createElement(StrictMode, null, createElement(CouponsPageContent)));
  await act(async () => {});
  await act(async () => { resolvers[0]({ coupons: [coupon('FIRST')], nextCursor: 'c1', hasMore: true }); });
  expect(view.queryByRole('button', { name: 'loadMore' })).toBeNull();

  await act(async () => { resolvers[1]({ coupons: [coupon('FIRST')], nextCursor: 'c1', hasMore: true }); });
  expect(view.getByRole('button', { name: 'loadMore' })).toBeTruthy();
});
