// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/pl.json';
import { parseCustomAmountInput } from '@/lib/payment/custom-amount';
import PaidProductForm from '@/app/[locale]/checkout/[slug]/components/PaidProductForm';
import type { Product } from '@/types';

const navigation = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(navigation.query) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ stripePublishableKey: 'pk_test_example' }) }));
vi.mock('@/components/providers/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('@/lib/stripe/client', () => ({ getStripeClient: () => Promise.resolve(null) }));
vi.mock('@/hooks/useInvoiceData', () => ({ useInvoiceData: () => ({ fullName: 'Test Buyer', setFullName: vi.fn(), isLoadingProfile: false }) }));
vi.mock('@/hooks/useOrderBumps', () => ({ useOrderBumps: () => ({ orderBumps: [] }) }));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/hooks/useCoupon', () => ({ useCoupon: () => ({ appliedCoupon: null }) }));
vi.mock('@/hooks/useOto', () => ({ useOto: () => ({ otoInfo: null }) }));
vi.mock('@/hooks/useCheckoutRedirect', () => ({ useCheckoutRedirect: () => ({ hasAccess: false }) }));
vi.mock('@/hooks/useFreeAccess', () => ({ useFreeAccess: () => ({ captcha: { isLoading: false }, pwywFreeEmail: '' }) }));
vi.mock('@/lib/actions/checkout', () => ({ signOutAndRedirectToCheckout: vi.fn() }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
vi.mock('@/app/[locale]/checkout/[slug]/components/CustomPaymentForm', () => ({ default: () => null }));
vi.mock('@/app/[locale]/checkout/[slug]/components/ProductShowcase', () => ({ default: () => null }));
vi.mock('@/app/[locale]/checkout/[slug]/components/CouponField', () => ({ default: () => null }));
vi.mock('@/lib/orders/transfer-public', () => ({ getTransferAvailability: vi.fn() }));

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); navigation.query = ""; });
describe('PWYW amount input', () => {
  it.each([['4', 4], ['4,99', 4.99], ['5', 5], ['5.55', 5.55], ['0', 0]])('parses %s', (raw, amount) => {
    expect(parseCustomAmountInput(raw, 'PLN')).toBe(amount);
  });
  it.each(['5,555', '1e3', 'abc', '−5', '-5', '', ' ', 'Infinity'])('rejects %j', raw => {
    expect(parseCustomAmountInput(raw, 'PLN')).toBeNull();
  });
  it.each([[' 7 ', 7], ['\t4,99\n', 4.99], ['\u00a05.55 ', 5.55]])('trims pasted whitespace around %j', (raw, amount) => {
    expect(parseCustomAmountInput(raw, 'PLN')).toBe(amount);
    expect(parseCustomAmountInput(' 500 ', 'JPY')).toBe(500);
  });
  it.each(['7 0', '   '])('still rejects %j', raw => {
    expect(parseCustomAmountInput(raw, 'PLN')).toBeNull();
  });
  it('requires whole JPY amounts', () => {
    expect(parseCustomAmountInput('500', 'JPY')).toBe(500);
    expect(parseCustomAmountInput('500,5', 'JPY')).toBeNull();
  });
  it('validates before initialization, preserves commas and updates the total without blur', async () => {
    navigation.query = 'amount=4';
    const request = vi.fn(() => new Promise(() => {})); vi.stubGlobal('fetch', request);
    const product = { id: 'product', slug: 'pwyw', name: 'Support', price: 10, currency: 'PLN', allow_custom_price: true, custom_price_min: 5 } as Product;
    render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages }, React.createElement(PaidProductForm, { product, collectTermsOfService: false, layoutMode: 'embedded' })));
    const input = screen.getByRole('textbox');
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Przejdź do płatności' })).toBeNull();
    expect(screen.queryByText(messages.checkout.loadingPaymentMethods)).toBeNull();
    fireEvent.change(input, { target: { value: '4,99' } }); expect(request).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '5,55' } });
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect((input as HTMLInputElement).value).toBe('5,55');
    expect(screen.getByTestId('order-summary-total').textContent).toContain('5,55');
    fireEvent.blur(input); expect((input as HTMLInputElement).value).toBe('5,55');
    fireEvent.change(input, { target: { value: '5,555' } });
    expect(screen.getByText(/Wpisz poprawną kwotę/)).toBeTruthy();
    expect(screen.queryByText(messages.checkout.loadingPaymentMethods)).toBeNull();
    for (const invalid of ['0', '']) { fireEvent.change(input, { target: { value: invalid } }); expect(request).toHaveBeenCalledOnce(); }
  });
});

// The language menu navigates to a fresh localized product route.
describe('PWYW amount across localized routes', () => {
  it.each(['0', '7.25', '7,25'])('restores %s from the URL', raw => {
    navigation.query = `amount=${encodeURIComponent(raw)}`;
    const product = { id: 'product', slug: 'pwyw', name: 'Support', price: 19.99, currency: 'USD', allow_custom_price: true, custom_price_min: 0 } as Product;
    render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages },
      React.createElement(PaidProductForm, { product, collectTermsOfService: false, layoutMode: 'embedded' })));
    expect((screen.getByDisplayValue(raw) as HTMLInputElement).value).toBe(raw);
  });
});

it('shows only payable saved presets and starts at a valid amount', () => {
  const product = { id: 'product', slug: 'pwyw', name: 'Support', price: 0, currency: 'JPY', allow_custom_price: true, custom_price_min: 100, show_price_presets: true, custom_price_presets: [5, 10, 25, 100, 150.5, 200] } as Product;
  render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages }, React.createElement(PaidProductForm, { product, collectTermsOfService: false, layoutMode: 'embedded' })));
  const input = screen.getByRole('textbox') as HTMLInputElement;
  expect(input.value).toBe('100');
  expect(screen.getAllByRole('button').map(button => button.textContent?.trim().replace(/\s+/g, ' ')).filter(label => label?.includes('JPY'))).toEqual(['100 JPY', '200 JPY']);
});
