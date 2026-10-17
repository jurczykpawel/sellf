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
  fireEvent.click(screen.getByRole('button', { name: locale === 'pl' ? 'Masz kod rabatowy?' : 'Have a discount code?' }));
  expect(screen.getByRole('textbox', { name: locale === 'pl' ? 'Kod rabatowy' : 'Discount code' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: (locale === 'pl' ? pl : en).checkout.applyCoupon }));
  expect(apply).toHaveBeenCalledOnce();
});
