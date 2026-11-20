// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import PaidProductForm from '@/app/[locale]/checkout/[slug]/components/PaidProductForm';
import en from '@/messages/en.json';

const state = vi.hoisted(() => ({ ready: true, verifying: false, coupon: null as null | { code: string; discount_type: string; discount_value: number }, mounts: 0, updates: 0, process: null as null | ((value: boolean) => void), deadline: undefined as number | undefined, delayRefresh: false, finishRefresh: null as null | (() => void), confirm: null as null | ((value: boolean) => void), restart: null as null | (() => Promise<void>) }));
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
vi.mock('@/app/[locale]/checkout/[slug]/components/CustomPaymentForm', () => ({ default: ({ quantityInvalid, onRegisterServerUpdate, onProcessingChange, sessionDeadline, onConfirmationChange, onSessionExpired }: { quantityInvalid: boolean; onConfirmationChange(value: boolean): void; onSessionExpired(): Promise<void>; sessionDeadline?: number; onProcessingChange(value: boolean): void; onRegisterServerUpdate(runner: (update: () => Promise<unknown>) => Promise<void>): void }) => {
  React.useEffect(() => { if (!state.ready) return; onRegisterServerUpdate(async update => { state.updates++; await update(); if (state.delayRefresh) await new Promise<void>(resolve => { state.finishRefresh = resolve; }); }); }, [onRegisterServerUpdate, state.ready]);
  state.process = onProcessingChange;
  state.deadline = sessionDeadline;
  state.confirm = onConfirmationChange;
  state.restart = onSessionExpired;
  return React.createElement('input', { 'aria-label': 'Card', disabled: quantityInvalid });
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); state.ready = true; state.verifying = false; state.coupon = null; state.mounts = 0; state.updates = 0; state.delayRefresh = false; state.finishRefresh = null; });

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
  state.ready = true; state.verifying = false; state.coupon = { code: 'QUARTER', discount_type: 'percentage', discount_value: 25 }; view.rerender(tree());
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

it('bounds retries and stalled responses within the Stripe update timeout', async () => {
  let updateSignal: AbortSignal | undefined;
  let attempts = 0;
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.expireOnly) return Response.json({ success: true });
    if (!body.clientSecret) return Response.json({ clientSecret: 'cs_test_open_secret_value', checkoutSessionId: 'cs_test_open' });
    updateSignal = init.signal as AbortSignal;
    if (++attempts === 1) return Response.json({ code: 'CHECKOUT_UPDATE_IN_PROGRESS' }, { status: 409 });
    return new Promise<Response>((_resolve, reject) => updateSignal?.addEventListener('abort', () => reject(updateSignal!.reason), { once: true }));
  });
  vi.stubGlobal('fetch', fetch);
  const product = { id: 'product', slug: 'product', name: 'Product', price: 100, currency: 'PLN', is_active: true };
  const tree = () => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, { product, collectTermsOfService: false } as unknown as React.ComponentProps<typeof PaidProductForm>));
  const view = render(tree());
  await screen.findByLabelText('Card');
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Update timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
  try {
    state.coupon = { code: 'QUARTER', discount_type: 'percentage', discount_value: 25 };
    view.rerender(tree());
    await act(async () => { await Promise.resolve(); });
    expect(updateSignal).toBeInstanceOf(AbortSignal);
    expect(timeout.mock.calls[0][0]).toBeLessThan(20000);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(updateSignal?.aborted).toBe(true);
    expect(attempts).toBe(2);
    expect(timeout).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); timeout.mockRestore(); }
});

it('counts remaining lifetime from response receipt while Stripe refresh is pending', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ clientSecret: 'cs_test_open_secret_value', checkoutSessionId: 'cs_test_open', expiresInSeconds: 1800 })));
  const product = { id: 'product', slug: 'product', name: 'Product', price: 100, currency: 'PLN', is_active: true };
  const tree = () => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, { product, collectTermsOfService: false } as unknown as React.ComponentProps<typeof PaidProductForm>));
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  try {
    const view = render(tree());
    await screen.findByLabelText('Card');
    state.delayRefresh = true;
    state.coupon = { code: 'QUARTER', discount_type: 'percentage', discount_value: 25 }; view.rerender(tree());
    await waitFor(() => expect(state.finishRefresh).not.toBeNull());
    clock.mockReturnValue(11000);
    await act(async () => { state.finishRefresh!(); });
    expect(state.deadline).toBe(1801000);
  } finally { clock.mockRestore(); }
});

it('retires a fresh unpaid session on pagehide after restarting an earlier confirmation', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let opened = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); calls.push(body);
    if (body.expireOnly) return Response.json({ success: true });
    opened++;
    return Response.json({ clientSecret: `cs_test_${opened}_secret_value`, checkoutSessionId: `cs_test_${opened}` });
  }));
  const product = { id: 'product', slug: 'product', name: 'Product', price: 100, currency: 'PLN', is_active: true };
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, { product, collectTermsOfService: false } as unknown as React.ComponentProps<typeof PaidProductForm>)));
  await screen.findByLabelText('Card');
  act(() => state.confirm!(true));
  await act(async () => { await state.restart!(); });
  await waitFor(() => expect(opened).toBe(2));
  act(() => window.dispatchEvent(new Event('pagehide')));
  await waitFor(() => expect(calls.some(body => body.expireOnly && body.clientSecret === 'cs_test_2_secret_value')).toBe(true));
});

it('waits for the mounted Stripe form before applying a cart update', async () => {
  state.ready = false;
  const fetch = vi.fn(async () => Response.json({ clientSecret: 'cs_test_open_secret_value', checkoutSessionId: 'cs_test_open', bindingToken: 'binding' }));
  vi.stubGlobal('fetch', fetch);
  const product = { id: 'product', slug: 'product', name: 'Product', price: 100, currency: 'PLN', is_active: true };
  const tree = () => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, { product, collectTermsOfService: false } as unknown as React.ComponentProps<typeof PaidProductForm>));
  const view = render(tree());
  await screen.findByLabelText('Card');
  expect(fetch).toHaveBeenCalledOnce();
  state.coupon = { code: 'QUARTER', discount_type: 'percentage', discount_value: 25 };
  view.rerender(tree());
  await act(async () => {});
  expect(fetch).toHaveBeenCalledOnce();
  expect((screen.getByLabelText('Card') as HTMLInputElement).disabled).toBe(true);
  state.ready = true;
  view.rerender(tree());
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(state.updates).toBe(1);
  await waitFor(() => expect((screen.getByLabelText('Card') as HTMLInputElement).disabled).toBe(false));
  expect(state.mounts).toBe(1);
});

it('keeps a departed checkout retired when Stripe finishes loading', async () => {
  state.ready = false;
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ clientSecret: 'cs_test_open_secret_value', checkoutSessionId: 'cs_test_open', bindingToken: 'binding' }));
  vi.stubGlobal('fetch', fetch);
  const product = { id: 'product', slug: 'product', name: 'Product', price: 100, currency: 'PLN', is_active: true };
  const tree = () => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, { product, collectTermsOfService: false } as unknown as React.ComponentProps<typeof PaidProductForm>));
  const view = render(tree());
  await screen.findByLabelText('Card');
  act(() => window.dispatchEvent(new Event('pagehide')));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  state.ready = true;
  view.rerender(tree());
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toMatchObject({ expireOnly: true });
});
