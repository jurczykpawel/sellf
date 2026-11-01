// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCoupon } from '@/hooks/useCoupon';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
const query = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query.value) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const fetchMock = vi.fn();

beforeEach(() => {
  query.value = '';
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('useCoupon rate limit', () => {
  it('shows a localised message with the wait time instead of the raw API text', async () => {
    fetchMock.mockResolvedValue({
      status: 429,
      json: async () => ({ error: 'rate_limited', retryAfterSeconds: 3600 }),
    });
    const { result } = renderHook(() => useCoupon({ productId: 'p1' }));

    await act(async () => { await result.current.handleVerifyCoupon('ABC'); });

    expect(result.current.couponError).toContain('couponRateLimited');
    expect(result.current.couponError).not.toContain('Too many requests');
    expect(result.current.couponError).toContain('"minutes":60');
  });
});

it.each(['', 'show_promo=true', 'coupon='])('keeps entry hidden for %s', value => {
  query.value = value;
  const { result } = renderHook(() => useCoupon({ productId: 'p1' }));
  expect(result.current.showCouponInput).toBe(false);
});
it('uses the actual code in the link to expose and prefill entry', () => {
  query.value = 'coupon=LINK10'; fetchMock.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useCoupon({ productId: 'p1' }));
  expect(result.current.showCouponInput).toBe(true);
  expect(result.current.couponCode).toBe('LINK10');
});

it('does not quote a discount when the selected checkout does not accept coupons', async () => {
  query.value = 'coupon=HALF'; fetchMock.mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useCoupon({ productId: 'subscription', enabled: false }));
  await act(async () => { void result.current.handleVerifyCoupon('HALF'); });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(result.current.appliedCoupon).toBeNull();
  expect(result.current.isVerifyingCoupon).toBe(false);
});
