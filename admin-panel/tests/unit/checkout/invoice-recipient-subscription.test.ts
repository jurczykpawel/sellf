// @vitest-environment happy-dom
/**
 * W223b (W223ar #7): a subscription has no order row the recipient could be kept on, so the
 * standard checkout never offers "Invoice for another institution" for it, even when the shop
 * collects recipients. One-time products keep the option. The server refuses it too.
 * @see src/app/[locale]/checkout/[slug]/components/CustomPaymentForm.tsx
 */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CustomPaymentForm from '@/app/[locale]/checkout/[slug]/components/CustomPaymentForm';
import type { ComponentProps } from 'react';
import en from '@/messages/en.json';
vi.mock('@stripe/react-stripe-js/checkout', () => ({ PaymentElement: () => null, useCheckoutElements: () => ({ type: 'loading' }) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/components/DemoCheckoutNotice', () => ({ default: () => null }));
vi.mock('@/components/checkout/CheckoutProfileFields', () => ({ default: () => null }));
afterEach(cleanup);

it.each([['one_time', true], ['subscription', false]] as const)('%s: recipient option offered = %s @J621', (productType, offered) => {
  const props = {
    product: { price: 10, currency: 'PLN', product_type: productType, checkout_profile: null },
    email: 'buyer@example.com', invoice: { fullName: '', nip: '', companyName: '', country: 'PL' }, profileForm: { errors: [] }, pricing: {},
    onEmailChange: vi.fn(), collectTermsOfService: false, collectInvoiceRecipient: true,
  } as unknown as ComponentProps<typeof CustomPaymentForm>;
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CustomPaymentForm, props)));
  fireEvent.click(screen.getByLabelText(en.checkout.invoiceSection.wantInvoice));
  expect(!!screen.queryByLabelText(en.checkout.invoiceSection.wantRecipient)).toBe(offered);
});
