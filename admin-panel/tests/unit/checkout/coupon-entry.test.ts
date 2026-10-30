// @vitest-environment happy-dom
/** Coupon entry in the public purchase form. @see app/[locale]/checkout/[slug]/components/CouponField.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CouponField from '@/app/[locale]/checkout/[slug]/components/CouponField';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);
it.each(['en', 'pl'] as const)('keeps coupon entry absent without a URL or automatic code in %s', locale => {
  const { container } = render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(CouponField, {
    couponCode: '', appliedCoupon: null, isVerifying: false, couponError: null, currency: 'PLN', showCouponInput: false,
    onCodeChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(),
  })));
  expect(container.querySelector('input')).toBeNull();
  expect(container.textContent).toBe('');
});

it.each(['url', 'applied'] as const)('opens coupon entry for %s coupons', source => {
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CouponField, {
    couponCode: 'SAVE10', appliedCoupon: source === 'applied' ? { code: 'SAVE10', discount_type: 'percentage', discount_value: 10 } : null,
    isVerifying: false, couponError: null, currency: 'PLN', showCouponInput: source === 'url',
    onCodeChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(),
  })));
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

it.each(['en', 'pl'] as const)('labels net set-price coupons and their gross unit price in %s', locale => {
  render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(CouponField, {
    couponCode: 'B2B30', appliedCoupon: { code: 'B2B30', discount_type: 'set_price', discount_value: 30 },
    isVerifying: false, couponError: null, currency: 'PLN', showCouponInput: true,
    priceIncludesVat: false, vatDisplay: { kind: 'rate_added', rate: 23 },
    onCodeChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(),
  })));
  const label = screen.getByText(locale === 'pl' ? /Cena za sztukę:/ : /Unit price set to/);
  expect(label.textContent).toMatch(locale === 'pl' ? /30,00\s*zł netto.*36,90\s*zł brutto/ : /PLN\s*30.00 net.*PLN\s*36.90 gross/);
});

it.each(['none', 'exempt'] as const)('does not invent gross VAT for %s display', kind => {
  render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages: pl }, React.createElement(CouponField, {
    couponCode: 'B2B30', appliedCoupon: { code: 'B2B30', discount_type: 'set_price', discount_value: 30 },
    isVerifying: false, couponError: null, currency: 'PLN', showCouponInput: true,
    priceIncludesVat: false, vatDisplay: kind === 'exempt' ? { kind, note: null } : { kind },
    onCodeChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(),
  })));
  expect(screen.getByText(/Cena za sztukę:/).textContent).toMatch(/30,00\s*zł netto$/);
});
