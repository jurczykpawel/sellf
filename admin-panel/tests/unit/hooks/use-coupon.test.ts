// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { calculatePricing } from '@/hooks/usePricing';
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
  vi.useRealTimers();
  vi.clearAllMocks();
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

it('keeps the OTO scope when a previous email lookup finishes later', async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<unknown>();
  fetchMock.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useCoupon({ productId: 'p1', email: 'buyer@example.com', isOtoMode: true }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  await act(async () => {
    result.current.applyOtoCoupon({ id: 'oto', code: 'OTO', discount_type: 'percentage', discount_value: 10, allowed_product_ids: ['p1'] }, 'OTO');
  });
  await act(async () => {
    pending.resolve({ json: async () => ({ found: true, code: 'OTO', discount_type: 'percentage', discount_value: 10, exclude_order_bumps: false }) });
  });
  const price = calculatePricing({ baseProductId: 'p1', productPrice: 100, productCurrency: 'USD', bumps: [{ id: 'bump', price: 20, selected: true }], coupon: result.current.appliedCoupon });
  expect(price.discountAmount).toBe(10);
  expect(price.totalPayable).toBe(110);
  vi.useRealTimers();
});
it('names an automatically applied coupon in its confirmation', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue({ json: async () => ({ found: true, code: 'BUYER10', discount_type: 'percentage', discount_value: 10 }) });
  renderHook(() => useCoupon({ productId: 'p1', email: 'buyer@example.com' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(toast.success).toHaveBeenCalledWith('couponAutoApplied:{"code":"BUYER10"}');
  vi.useRealTimers();
});
