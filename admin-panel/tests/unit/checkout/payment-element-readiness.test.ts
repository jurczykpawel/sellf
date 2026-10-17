// @vitest-environment happy-dom
/** Checkout session readiness does not imply the payment Element can accept input. */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CustomPaymentForm from '@/app/[locale]/checkout/[slug]/components/CustomPaymentForm';
import en from '@/messages/en.json';
import type { Product } from '@/types';
import type { PricingResult } from '@/hooks/usePricing';

const stripe = vi.hoisted(() => ({ ready: undefined as undefined | (() => void), result: { type: 'success', checkout: {} } }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckoutElements: () => stripe.result,
  PaymentElement: ({ onReady }: { onReady?: () => void }) => { stripe.ready = onReady; return null; },
}));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/hooks/useInvoiceData', () => ({ useInvoiceData: () => ({ fullName: 'Test Buyer', setFullName: vi.fn(), isLoadingProfile: false }) }));
vi.mock('@/components/DemoCheckoutNotice', () => ({ default: () => null }));
vi.mock('@/components/checkout/InvoiceFields', () => ({ default: () => null }));
vi.mock('@/components/checkout/OrderSummary', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); stripe.result.type = 'success'; });

function setup() {
  return render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en },
    React.createElement(CustomPaymentForm, {
      product: { id: 'test-product', name: 'Course', currency: 'PLN' } as Product,
      email: 'buyer@example.com', collectTermsOfService: false,
      pricing: { basePrice: 100, discountAmount: 0, totalGross: 100, totalNet: 100, vatRate: 0 } as PricingResult,
    })));
}

it('blocks submission until the payment Element is fully rendered, then exposes readiness', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const view = setup();
  const button = view.getByRole('button', { name: /Pay/ }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.hasAttribute('data-checkout-pending')).toBe(true);
  fireEvent.submit(button.closest('form')!);
  expect(fetch).not.toHaveBeenCalled();
  expect(stripe.ready).toBeTypeOf('function');
  act(() => stripe.ready!());
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute('data-checkout-pending')).toBe(false);
});

it('retains the session loading gate even after the Element is ready', () => {
  stripe.result.type = 'loading';
  const view = setup();
  act(() => stripe.ready!());
  const button = view.getByRole('button', { name: /Pay/ }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.hasAttribute('data-checkout-pending')).toBe(true);
});
