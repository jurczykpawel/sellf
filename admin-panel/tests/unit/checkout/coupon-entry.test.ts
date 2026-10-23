// @vitest-environment happy-dom
/** Coupon entry in the public purchase form. @see app/[locale]/checkout/[slug]/components/CouponField.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CouponField from '@/app/[locale]/checkout/[slug]/components/CouponField';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);
it.each(['en', 'pl'] as const)('offers coupon entry without URL parameters in %s', locale => {
  const apply = vi.fn();
  render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(CouponField, {
    couponCode: 'SAVE10', appliedCoupon: null, isVerifying: false, couponError: null, currency: 'PLN', showCouponInput: false,
    onCodeChange: vi.fn(), onApply: apply, onRemove: vi.fn(),
  })));
  fireEvent.click(screen.getByText(locale === 'pl' ? 'Masz kod rabatowy?' : 'Have a discount code?'));
  expect(screen.getByRole('textbox', { name: locale === 'pl' ? 'Kod rabatowy' : 'Discount code' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: (locale === 'pl' ? pl : en).checkout.applyCoupon }));
  expect(apply).toHaveBeenCalledOnce();
});

it.each(['url', 'applied'] as const)('opens coupon entry for %s coupons', source => {
  const { container } = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CouponField, {
    couponCode: 'SAVE10', appliedCoupon: source === 'applied' ? { code: 'SAVE10', discount_type: 'percentage', discount_value: 10 } : null,
    isVerifying: false, couponError: null, currency: 'PLN', showCouponInput: source === 'url',
    onCodeChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(),
  })));
  expect(container.querySelector('details')?.open).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Discount code' })).toBeTruthy();
});

it.each(['en', 'pl'] as const)('explains a set-price coupon with no reduction in %s', locale => {
  const messages = locale === 'pl' ? pl : en;
  render(React.createElement(NextIntlClientProvider, { locale, messages }, React.createElement(CouponField, {
    couponCode: 'PRICE50', appliedCoupon: { code: 'PRICE50', discount_type: 'set_price', discount_value: 50 },
    noPriceReduction: true, isVerifying: false, couponError: null, currency: 'PLN', showCouponInput: true,
    onCodeChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(),
  })));
  expect(screen.getByText(messages.checkout.couponNoReduction)).toBeTruthy();
  expect(screen.queryByText(/discount applied|Zastosowano zniżkę/)).toBeNull();
});
