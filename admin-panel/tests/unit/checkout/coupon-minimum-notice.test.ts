// @vitest-environment happy-dom
/** Buyer sees at the coupon that the discount was limited by the minimum payment (W146 B6). */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CouponField from '@/app/[locale]/checkout/[slug]/components/CouponField';
import { calculatePricing } from '@/hooks/usePricing';
import pl from '@/messages/pl.json';
afterEach(cleanup);

it('exposes the floor from pricing', () => {
  const coupon = { code: 'X', discount_type: 'percentage' as const, discount_value: 80 };
  expect(calculatePricing({ productPrice: 2, productCurrency: 'PLN', coupon } as never).minimumApplied).toBe(true);
  expect(calculatePricing({ productPrice: 2, productCurrency: 'PLN', coupon: { ...coupon, discount_value: 100 } } as never).minimumApplied).toBe(false);
});

it('tells the buyer the discount stops at the minimum payment', () => {
  render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, React.createElement(CouponField, {
    couponCode: 'X', appliedCoupon: { code: 'X', discount_type: 'percentage', discount_value: 80 } as never, isVerifying: false, couponError: null, currency: 'PLN',
    minimumApplied: true, showCouponInput: true, onCodeChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(),
  })));
  expect(screen.getByText(/minimalnej płatności: 2,00/)).toBeTruthy();
});
