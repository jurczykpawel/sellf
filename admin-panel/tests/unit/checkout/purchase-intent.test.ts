// @vitest-environment happy-dom
/** Purchase intent starts the checkout session. @see app/[locale]/checkout/[slug]/components/PaidProductForm.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { Product } from '@/types';
const mocks = vi.hoisted(() => ({ track: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ stripePublishableKey: 'pk_test_example' }) }));
vi.mock('@/components/providers/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('@/lib/stripe/client', () => ({ getStripeClient: () => Promise.resolve(null) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: mocks.track }) }));
vi.mock('@/hooks/useOrderBumps', () => ({ useOrderBumps: () => ({ orderBumps: [] }) }));
vi.mock('@/hooks/useOto', () => ({ useOto: () => ({}) }));
vi.mock('@/hooks/useFreeAccess', () => ({ useFreeAccess: () => ({}) }));
vi.mock('@/hooks/useCheckoutRedirect', () => ({ useCheckoutRedirect: () => ({ hasAccess: false }) }));
vi.mock('@/app/[locale]/checkout/[slug]/components/ProductShowcase', () => ({ default: () => null }));
vi.mock('@/app/[locale]/checkout/[slug]/components/CustomPaymentForm', () => ({ default: () => null }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({ CheckoutElementsProvider: () => null }));
import PaidProductForm from '@/app/[locale]/checkout/[slug]/components/PaidProductForm';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('records a view without starting a session, then starts exactly once on purchase', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'cs_test_secret', checkoutSessionId: 'cs_test' }) });
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN', vat_rate: 0 } as Product,
    collectTermsOfService: false,
  })));
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.track).toHaveBeenCalledWith('view_item', expect.anything());
  expect(mocks.track).not.toHaveBeenCalledWith('begin_checkout', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/create-payment-intent', expect.anything()));
  expect(mocks.fetch.mock.calls.filter(call => call[0] === '/api/create-payment-intent')).toHaveLength(1);
  expect(mocks.track).toHaveBeenCalledWith('begin_checkout', expect.anything());
});
