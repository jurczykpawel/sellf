// @vitest-environment happy-dom
/** Purchase intent starts the checkout session. @see app/[locale]/checkout/[slug]/components/PaidProductForm.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { Product } from '@/types';
import type { AppliedCoupon } from '@/types/coupon';
const mocks = vi.hoisted(() => ({ track: vi.fn(), fetch: vi.fn(), confirm: vi.fn(), stripe: vi.fn(() => Promise.resolve(null)), coupon: null as AppliedCoupon | null, verifying: false, transfer: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ stripePublishableKey: 'pk_test_example' }) }));
vi.mock('@/components/providers/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('@/lib/stripe/client', () => ({ getStripeClient: mocks.stripe }));
vi.mock('@/lib/orders/transfer-public', () => ({ getTransferAvailability: mocks.transfer }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: mocks.track }) }));
vi.mock('@/hooks/useOrderBumps', () => ({ useOrderBumps: () => ({ orderBumps: [] }) }));
vi.mock('@/hooks/useOto', () => ({ useOto: () => ({}) }));
vi.mock('@/hooks/useFreeAccess', () => ({ useFreeAccess: () => ({}) }));
vi.mock('@/hooks/useCheckoutRedirect', () => ({ useCheckoutRedirect: () => ({ hasAccess: false }) }));
vi.mock('@/app/[locale]/checkout/[slug]/components/ProductShowcase', () => ({ default: () => null }));
vi.mock('@/hooks/useInvoiceData', () => ({ useInvoiceData: () => ({ fullName: 'Test Buyer', setFullName: vi.fn(), isLoadingProfile: false }) }));
vi.mock('@/components/DemoCheckoutNotice', () => ({ default: () => null }));
vi.mock('@/app/[locale]/checkout/[slug]/components/PwywSection', () => ({ default: ({ isFreeAccess }: { isFreeAccess: boolean }) => isFreeAccess ? React.createElement('div', { 'data-testid': 'free-access-view' }, 'Free access') : null }));
vi.mock('@/components/checkout/InvoiceFields', () => ({ default: () => null }));
vi.mock('@/hooks/useCoupon', () => ({ useCoupon: () => ({ appliedCoupon: mocks.coupon, couponCode: '', setCouponCode: vi.fn(), showCouponInput: false, isVerifyingCoupon: mocks.verifying, couponError: null, removeCoupon: vi.fn(), handleVerifyCoupon: vi.fn(), applyOtoCoupon: vi.fn() }) }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutElementsProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useCheckoutElements: () => ({ type: 'success', checkout: { confirm: mocks.confirm, updateEmail: async () => ({ type: 'success' }), updateBillingAddress: async () => ({ type: 'success' }) } }),
  PaymentElement: ({ onReady }: { onReady: () => void }) => {
    React.useEffect(() => { onReady(); }, [onReady]);
    return React.createElement('div', { 'data-testid': 'payment-fields' });
  },
}));
import PaidProductForm from '@/app/[locale]/checkout/[slug]/components/PaidProductForm';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.coupon = null; mocks.verifying = false; });
it.each(['en', 'pl'] as const)('%s: starts online payment exactly once without a separate continue step', async locale => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'cs_test_secret', checkoutSessionId: 'cs_test' }) });
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN', vat_rate: 0 } as Product,
    collectTermsOfService: false,
  })));
  expect(mocks.track).toHaveBeenCalledWith('view_item', expect.anything());
  const label = locale === 'pl' ? 'Przejdź do płatności' : 'Continue to payment';
  expect(screen.queryByRole('button', { name: label, exact: true })).toBeNull();
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/create-payment-intent', expect.anything()));
  expect(mocks.stripe).toHaveBeenCalledWith('pk_test_example');
  expect(mocks.fetch.mock.calls.filter(call => call[0] === '/api/create-payment-intent')).toHaveLength(1);
  expect(mocks.track).toHaveBeenCalledWith('begin_checkout', expect.anything());
  expect(mocks.track.mock.calls.filter(([event]) => event === 'add_to_cart')).toEqual([['add_to_cart', { value: 49, currency: 'PLN', items: [{ item_id: 'test-product', item_name: 'Course', price: 49, quantity: 1 }] }]]);
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
  expect(screen.queryByRole('button', { name: label, exact: true })).toBeNull();
  expect(screen.getByRole('button', { name: locale === 'pl' ? /Zapłać.*49/ : /Pay.*49/ })).toBeTruthy();
});

it.each([false, true])('closes an unpaid session on departure (cached: %s)', async persisted => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'cs_test_first_secret_value', checkoutSessionId: 'cs_test_first', bindingToken: 'binding-first' }) });
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN', vat_rate: 0 } as Product,
    collectTermsOfService: false,
  })));
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
  act(() => { window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted })); });
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
  const [url, options] = mocks.fetch.mock.calls[1];
  expect(url).toBe('/api/create-payment-intent');
  expect(options.keepalive).toBe(true);
  expect(JSON.parse(options.body)).toEqual({ productId: 'test-product', clientSecret: 'cs_test_first_secret_value', checkoutSessionId: 'cs_test_first', bindingToken: 'binding-first', expireOnly: true });
  if (persisted) {
    await act(async () => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })); });
    expect(screen.queryByRole('button', { name: 'Continue to payment', exact: true })).toBeNull();
      await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
    expect(mocks.track.mock.calls.filter(([event]) => event === 'begin_checkout')).toHaveLength(2);
  }
});

it('preserves confirmation redirects and restores departure cleanup after a failed confirmation', async () => {
  mocks.fetch.mockImplementation(async url => ({ ok: true, json: async () => url === '/api/validate-email'
    ? { success: true, data: { isValid: true } }
    : { clientSecret: 'cs_test_first_secret_value', checkoutSessionId: 'cs_test_first', bindingToken: 'binding-first' } }));
  let finishConfirmation!: (result: unknown) => void;
  mocks.confirm.mockImplementation(() => new Promise(resolve => { finishConfirmation = resolve; }));
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN', vat_rate: 0 } as Product,
    collectTermsOfService: false,
  })));
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
  fireEvent.change(screen.getByRole('textbox', { name: 'Email', exact: true }), { target: { value: 'buyer@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  await act(async () => { window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false })); });
  const expirations = () => mocks.fetch.mock.calls.filter(([, options]) => JSON.parse(options.body).expireOnly);
  expect(expirations()).toHaveLength(0);
  await act(async () => finishConfirmation({ type: 'error', error: { message: 'Please try another payment method' } }));
  expect(screen.getByText('Please try another payment method')).toBeTruthy();
  await act(async () => { window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false })); });
  await waitFor(() => expect(expirations()).toHaveLength(1));
});

it('automatically reloads payment after returning to a cached page from confirmation', async () => {
  mocks.fetch.mockImplementation(async url => ({ ok: true, json: async () => url === '/api/validate-email'
    ? { success: true, data: { isValid: true } }
    : { clientSecret: 'cs_test_first_secret_value', checkoutSessionId: 'cs_test_first', bindingToken: 'binding-first' } }));
  mocks.confirm.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN', vat_rate: 0 } as Product,
    collectTermsOfService: false,
  })));
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
  fireEvent.change(screen.getByRole('textbox', { name: 'Email', exact: true }), { target: { value: 'buyer@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  await act(async () => { window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true })); });
  await act(async () => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })); });
  expect(screen.queryByRole('button', { name: 'Continue to payment', exact: true })).toBeNull();
  await waitFor(() => expect(mocks.fetch.mock.calls.filter(([, options]) => JSON.parse(options.body).expireOnly)).toHaveLength(1));
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
  await act(async () => { window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false })); });
  await waitFor(() => expect(mocks.fetch.mock.calls.filter(([, options]) => JSON.parse(options.body).expireOnly)).toHaveLength(2));
});

it('keeps the order breakdown and decline action available before, during and after payment initialization', async () => {
  let finishRequest!: (value: unknown) => void;
  mocks.fetch.mockImplementation(() => new Promise(resolve => { finishRequest = resolve; }));
  mocks.coupon = { code: 'SAVE20', discount_type: 'percentage', discount_value: 20 };
  vi.stubGlobal('fetch', mocks.fetch);
  const decline = vi.fn();
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 100, currency: 'USD', vat_rate: 0 } as Product,
    collectTermsOfService: false,
    afterCheckoutSlot: React.createElement('button', { type: 'button', 'data-testid': 'oto-decline-button', onClick: decline }, 'No thanks'),
  })));
  function expectDecisionControls() {
    expect(screen.getAllByText('Total', { exact: true })).toHaveLength(1);
    expect(screen.getByText('Discount (SAVE20)', { exact: true })).toBeTruthy();
    expect(screen.getByText('-$20.00', { exact: true })).toBeTruthy();
    expect(screen.getByTestId('order-summary-total').textContent).toBe('$80.00');
    expect(screen.getAllByTestId('oto-decline-button')).toHaveLength(1);
  }
  expectDecisionControls();
  fireEvent.click(screen.getByTestId('oto-decline-button'));
  expect(decline).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mocks.fetch.mock.calls.filter(call => call[0] === '/api/create-payment-intent')).toHaveLength(1));
  expectDecisionControls();
  await act(async () => finishRequest({ ok: true, json: async () => ({ clientSecret: 'cs_test_secret', checkoutSessionId: 'cs_test' }) }));
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
  expectDecisionControls();
  expect(mocks.fetch.mock.calls.filter(call => call[0] === '/api/create-payment-intent')).toHaveLength(1);
});


it.each([['month', 'month'], ['year', 'year']] as const)('retains the %s subscription interval in the total through payment initialization', async (interval, label) => {
  let finishRequest!: (value: unknown) => void;
  mocks.fetch.mockImplementation(() => new Promise(resolve => { finishRequest = resolve; }));
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Subscription', slug: 'subscription', price: 0, product_type: 'subscription', recurring_price: 99, billing_interval: interval, billing_interval_count: 1, currency: 'USD', vat_rate: 0 } as Product,
    collectTermsOfService: false,
  })));
  function expectInterval() {
    expect(screen.getAllByTestId('order-summary-total')).toHaveLength(1);
    expect(screen.getByTestId('order-summary-total').textContent).toBe(`$99.00 / ${label}`);
  }
  expectInterval();
  await waitFor(() => expect(mocks.fetch.mock.calls.filter(call => call[0] === '/api/create-payment-intent')).toHaveLength(1));
  expectInterval();
  await act(async () => finishRequest({ ok: true, json: async () => ({ clientSecret: 'cs_test_secret', checkoutSessionId: 'cs_test' }) }));
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
  expectInterval();
  expect(mocks.fetch.mock.calls.filter(call => call[0] === '/api/create-payment-intent')).toHaveLength(1);
});

it('keeps checkout quantity editable before and during payment initialization', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'cs_test_secret', checkoutSessionId: 'cs_test' }) });
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN', vat_rate: 0,
      checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 10, mode: 'checkout' }] } } as Product,
    collectTermsOfService: false,
  })));
  const quantity = screen.getByLabelText('Quantity');
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  fireEvent.change(quantity, { target: { value: '0' } });
  expect(screen.getByLabelText('Quantity')).toBe(quantity);
  expect((quantity as HTMLInputElement).value).toBe('0');
  const creates = () => mocks.fetch.mock.calls.filter(([, options]) => !JSON.parse(options.body).expireOnly);
  expect(creates()).toHaveLength(1);
  fireEvent.change(quantity, { target: { value: '2' } });
  await waitFor(() => expect(creates()).toHaveLength(2));
  expect(JSON.parse(creates()[1][1].body).quantity).toBe(2);
});

it.each([true, false])('resolves transfer availability before deciding how to initialize (enabled=%s)', async enabled => {
  let resolve!: (value: { enabled: boolean; dueDays: number }) => void;
  mocks.transfer.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mocks.fetch.mockImplementation(() => new Promise(() => {})); vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN', checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] }] } } as Product,
    collectTermsOfService: false,
  })));
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.stripe).not.toHaveBeenCalled();
  await act(async () => resolve({ enabled, dueDays: 14 }));
  if (enabled) {
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Continue to payment', exact: true })).toBeNull();
    const online = screen.getByRole('radio', { name: 'Pay online', exact: true }) as HTMLInputElement;
    expect(online.checked).toBe(false);
    expect((screen.getByRole('radio', { name: /bank transfer/i }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(online);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  }
  else await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
});
it('waits for a linked coupon before creating the first online session', async () => {
  mocks.verifying = true; mocks.fetch.mockImplementation(() => new Promise(() => {})); vi.stubGlobal('fetch', mocks.fetch);
  const element = () => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN' } as Product, collectTermsOfService: false,
  }));
  const view = render(element()); expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.verifying = false; view.rerender(element());
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
});

it('locks shared profile fields while confirming payment and unlocks after a decline', async () => {
  mocks.fetch.mockImplementation(async url => ({ ok: true, json: async () => url === '/api/validate-email'
    ? { success: true, data: { isValid: true } }
    : { clientSecret: 'cs_test_first_secret_value', checkoutSessionId: 'cs_test_first', bindingToken: 'binding-first' } }));
  let finish!: (value: unknown) => void;
  mocks.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Course', slug: 'course', price: 49, currency: 'PLN', vat_rate: 0,
      checkout_profile: { v: 1, modules: [{ id: 'phone', required: false }] } } as Product,
    collectTermsOfService: false,
  })));
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
  fireEvent.change(screen.getByRole('textbox', { name: 'Email', exact: true }), { target: { value: 'buyer@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect((document.getElementById('phone') as HTMLInputElement).disabled).toBe(true);
  await act(async () => finish({ type: 'error', error: { message: 'Choose another payment method' } }));
  expect((document.getElementById('phone') as HTMLInputElement).disabled).toBe(false);
});

it('collects event email before creating a hold and starts automatically after a valid address is committed', async () => {
  mocks.fetch.mockImplementation(async url => ({ ok: true, json: async () => url.includes('/availability')
    ? { sessions: [{ id: 'event-session', startsAt: '2099-01-01T12:00:00Z', endsAt: null, timezone: 'UTC', title: 'Workshop', venue: null, extraDays: null, remaining: 5, soldOut: false,
      currentTier: { id: 'tier', label: null, price: 49, seatsLeft: 5, endsAt: null }, nextTierPrice: null, cheaperSoldOut: false }] }
    : { clientSecret: 'cs_test_first_secret_value', checkoutSessionId: 'cs_test_first', bindingToken: 'binding-first' } }));
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Workshop', slug: 'workshop', price: 49, currency: 'PLN', event_mode: true } as Product,
    collectTermsOfService: false,
  })));
  await screen.findByRole('radio');
  const creates = () => mocks.fetch.mock.calls.filter(([url, options]) => url === '/api/create-payment-intent' && !JSON.parse(options.body).expireOnly);
  expect(creates()).toHaveLength(0);
  const email = screen.getByLabelText(en.events.email);
  fireEvent.change(email, { target: { value: 'incomplete' } }); fireEvent.blur(email);
  expect(creates()).toHaveLength(0);
  fireEvent.change(email, { target: { value: 'attendee@example.com' } }); fireEvent.blur(email);
  await waitFor(() => expect(creates()).toHaveLength(1));
  expect(JSON.parse(creates()[0][1].body)).toMatchObject({ email: 'attendee@example.com', sessionId: 'event-session' });
  expect(screen.queryByRole('button', { name: 'Continue to payment', exact: true })).toBeNull();
});

it.each(['product_page', 'checkout'] as const)('keeps %s quantity editable when a coupon initially makes the basket free', async mode => {
  mocks.coupon = { id: 'coupon', code: 'FIXED350', discount_type: 'fixed', discount_value: 350, currency: 'PLN' } as AppliedCoupon;
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'cs_test_secret', checkoutSessionId: 'cs_test' }) });
  vi.stubGlobal('fetch', mocks.fetch);
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(PaidProductForm, {
    product: { id: 'test-product', name: 'Workshop', slug: 'workshop', price: 100, currency: 'PLN', vat_rate: 0,
      checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode }] } } as Product,
    collectTermsOfService: false,
  })));
  expect(screen.getByTestId('free-access-view')).toBeTruthy();
  const creates = () => mocks.fetch.mock.calls.filter(([url, options]) => url === '/api/create-payment-intent' && !JSON.parse(options.body).expireOnly);
  expect(creates()).toHaveLength(0);
  const quantity = screen.getByLabelText('Quantity') as HTMLInputElement;
  act(() => quantity.focus());
  fireEvent.change(quantity, { target: { value: '5' } });
  await waitFor(() => expect(creates()).toHaveLength(1));
  expect(JSON.parse(creates()[0][1].body)).toMatchObject({ quantity: 5, couponCode: 'FIXED350' });
  expect(screen.getByLabelText('Quantity')).toBe(quantity);
  expect(document.activeElement).toBe(quantity);
  await waitFor(() => expect(screen.getByTestId('payment-fields')).toBeTruthy());
});
