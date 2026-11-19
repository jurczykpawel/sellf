// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import PaidProductForm from '@/app/[locale]/checkout/[slug]/components/PaidProductForm';
import en from '@/messages/en.json';

const state = vi.hoisted(() => ({ verifying: false, coupon: null as null | { code: string; discount_type: string; discount_value: number }, mounts: 0, updates: 0, process: null as null | ((value: boolean) => void) }));
const params = new URLSearchParams('email=buyer@example.com');
vi.mock('next/navigation', () => ({ useSearchParams: () => params, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ stripePublishableKey: 'pk_test_fixture' }) }));
vi.mock('@/components/providers/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('@/lib/stripe/client', () => ({ getStripeClient: () => 'stripe' }));
vi.mock('@/hooks/useOrderBumps', () => ({ useOrderBumps: () => ({ orderBumps: [] }) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/hooks/useCartTracking', () => ({ useCartTracking: () => {} }));
vi.mock('@/hooks/useOto', () => ({ useOto: () => ({}) }));
vi.mock('@/hooks/useFreeAccess', () => ({ useFreeAccess: () => ({}) }));
vi.mock('@/hooks/useCheckoutRedirect', () => ({ useCheckoutRedirect: () => ({}) }));
vi.mock('@/hooks/useInvoiceData', () => ({ useInvoiceData: () => ({ fullName: 'Buyer' }) }));
vi.mock('@/hooks/useCoupon', () => ({ useCoupon: () => ({ appliedCoupon: state.coupon, isVerifyingCoupon: state.verifying, showCouponInput: false }) }));
vi.mock('@/app/[locale]/checkout/[slug]/components/ProductShowcase', () => ({ default: () => null }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({ CheckoutElementsProvider: ({ children }: { children: React.ReactNode }) => {
  React.useEffect(() => { state.mounts++; }, []); return children;
} }));
vi.mock('@/app/[locale]/checkout/[slug]/components/CustomPaymentForm', () => ({ default: ({ quantityInvalid, onRegisterServerUpdate, onProcessingChange }: { quantityInvalid: boolean; onProcessingChange(value: boolean): void; onRegisterServerUpdate(runner: (update: () => Promise<unknown>) => Promise<void>): void }) => {
  React.useEffect(() => { onRegisterServerUpdate(async update => { state.updates++; await update(); }); }, [onRegisterServerUpdate]);
  state.process = onProcessingChange;
  return React.createElement('input', { 'aria-label': 'Card', disabled: quantityInvalid });
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); state.verifying = false; state.coupon = null; state.mounts = 0; state.updates = 0; });

it('preserves the active session and entered card while checking and applying a coupon', async () => {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); calls.push(body);
    return Response.json({ clientSecret: 'cs_test_open_secret_value', checkoutSessionId: 'cs_test_open', bindingToken: 'binding' });
  }));
  const product = { id: 'product', slug: 'product', name: 'Product', description: '', price: 100, currency: 'PLN', is_active: true };
  const tree = () => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, { product, collectTermsOfService: false } as unknown as React.ComponentProps<typeof PaidProductForm>));
  const view = render(tree());
  const card = await screen.findByLabelText('Card');
  fireEvent.change(card, { target: { value: 'entered card' } });
  state.verifying = true; view.rerender(tree());
  await waitFor(() => expect(calls.some(call => call.expireOnly)).toBe(false));
  expect(screen.getByLabelText('Card')).toBe(card);
  expect((card as HTMLInputElement).disabled).toBe(true);
  state.verifying = false; state.coupon = { code: 'QUARTER', discount_type: 'percentage', discount_value: 25 }; view.rerender(tree());
  await waitFor(() => expect(calls.some(call => call.couponCode === 'QUARTER')).toBe(true));
  expect(calls.at(-1)?.clientSecret).toBe('cs_test_open_secret_value');
  expect(screen.getByLabelText('Card')).toBe(card);
  expect((card as HTMLInputElement).value).toBe('entered card');
  expect(state.mounts).toBe(1);
  expect(state.updates).toBe(1);
});

it('locks cart controls and pauses updates throughout payment processing', async () => {
  const fetch = vi.fn(async () => Response.json({ clientSecret: 'cs_test_open_secret_value', checkoutSessionId: 'cs_test_open' }));
  vi.stubGlobal('fetch', fetch);
  const product = { id: 'product', slug: 'product', name: 'Product', price: 100, currency: 'PLN', is_active: true, checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person'] }, { id: 'quantity', min: 1, max: 5, mode: 'checkout' }] } };
  const tree = () => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, { product, collectTermsOfService: false } as unknown as React.ComponentProps<typeof PaidProductForm>));
  const view = render(tree());
  await screen.findByLabelText('Card');
  act(() => state.process!(true));
  expect(view.container.querySelector('#checkoutQuantity')!.closest('fieldset')?.disabled).toBe(true);
  state.coupon = { code: 'QUARTER', discount_type: 'percentage', discount_value: 25 }; view.rerender(tree());
  await act(async () => { await Promise.resolve(); });
  expect(fetch).toHaveBeenCalledTimes(1);
});
