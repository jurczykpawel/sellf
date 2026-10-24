// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import OrderSummary from '@/components/checkout/OrderSummary';
import en from '@/messages/en.json';
afterEach(cleanup);
it('replaces the stale total and labels invalid quantity', () => {
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(OrderSummary, {
    productName: 'Product', currency: 'PLN', basePrice: 30, discountAmount: 0, totalGross: 30, totalNet: 30, vatRate: 0, quantityInvalid: true,
  })));
  expect(screen.getByTestId('order-summary-total').textContent).toBe('—');
  expect(screen.getByText('(Invalid quantity)')).toBeTruthy();
});
