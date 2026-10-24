// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CustomPaymentForm from '@/app/[locale]/checkout/[slug]/components/CustomPaymentForm';
import type { ComponentProps } from 'react';
import en from '@/messages/en.json';
vi.mock('@stripe/react-stripe-js/checkout', () => ({ PaymentElement: () => null, useCheckoutElements: () => ({ type: 'loading' }) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/components/DemoCheckoutNotice', () => ({ default: () => null }));
vi.mock('@/components/checkout/CheckoutProfileFields', () => ({ default: () => null }));
vi.mock('@/components/checkout/InvoiceFields', () => ({ default: () => null }));
afterEach(cleanup);
it.each([true, false])('shows the collected profile email without asking again: %s', hasProfile => {
  const props = { product: { price: 10, currency: 'PLN', checkout_profile: hasProfile ? { v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false }] } : null }, email: 'buyer@example.com', invoice: {}, profileForm: { errors: [] }, pricing: {}, onEmailChange: vi.fn(), collectTermsOfService: false } as unknown as ComponentProps<typeof CustomPaymentForm>;
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CustomPaymentForm, props)));
  if (hasProfile) {
    expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull();
    expect(screen.getByText('buyer@example.com')).toBeTruthy();
  } else expect(screen.getByRole('textbox', { name: 'Email' })).toHaveProperty('value', 'buyer@example.com');
});
