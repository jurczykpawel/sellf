// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/pl.json';
import { parseCustomAmountInput } from '@/lib/payment/custom-amount';
import PaidProductForm from '@/app/[locale]/checkout/[slug]/components/PaidProductForm';
import type { Product } from '@/types';

const navigation = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(navigation.query) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ config: { stripePublishableKey: 'pk_test_example' } }) }));
vi.mock('@/components/providers/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
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
  it('validates before payment, preserves commas and updates the total without blur', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const product = { id: 'product', slug: 'pwyw', name: 'Support', price: 10, currency: 'PLN', allow_custom_price: true, custom_price_min: 5 } as Product;
    render(React.createElement(NextIntlClientProvider, { locale: 'pl', messages },
      React.createElement(PaidProductForm, { product, collectTermsOfService: false, layoutMode: 'embedded' })));
    const input = screen.getByRole('textbox');
    const button = screen.getByRole('button', { name: messages.checkout.continueToPayment });
    fireEvent.change(input, { target: { value: '4' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(button.closest('form')!);
    expect(screen.getByRole('button', { name: messages.checkout.continueToPayment })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '4,99' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '5,55' } });
    expect((input as HTMLInputElement).value).toBe('5,55');
    expect(screen.getByTestId('order-summary-total').textContent).toContain('5,55');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('5,55');
    fireEvent.change(input, { target: { value: '5,555' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Wpisz poprawną kwotę/)).toBeTruthy();
    expect(screen.queryByText(messages.checkout.loadingPaymentMethods)).toBeNull();
    fireEvent.change(input, { target: { value: '5' } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(input, { target: { value: '0' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
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
