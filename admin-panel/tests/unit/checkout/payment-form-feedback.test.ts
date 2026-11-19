// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import CustomPaymentForm from '@/app/[locale]/checkout/[slug]/components/CustomPaymentForm';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const stripe = vi.hoisted(() => ({ confirm: vi.fn(), updateEmail: vi.fn(async () => ({})) }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckoutElements: () => ({ type: 'success', checkout: stripe }),
  PaymentElement: ({ onReady }: { onReady(): void }) => { React.useEffect(onReady, [onReady]); return null; },
}));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/components/checkout/InvoiceSection', () => ({ default: () => null }));
vi.mock('@/components/DemoCheckoutNotice', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function form(locale: 'en' | 'pl', extra = {}) {
  return render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(CustomPaymentForm, {
    product: { id: 'product', price: 100, currency: 'PLN' },
    email: 'buyer@example.com', invoice: { fullName: 'Test Buyer' },
    profileForm: { errors: [], setErrors: vi.fn(), validate: () => true },
    onEmailChange: vi.fn(), collectTermsOfService: false, termsAccepted: true,
    onTermsAcceptedChange: vi.fn(), pricing: { basePrice: 100, totalPayable: 100 },
    clientSecret: 'cs_test_open_secret_value', bindingToken: 'binding', ...extra,
  } as unknown as React.ComponentProps<typeof CustomPaymentForm>)));
}

it.each(['en', 'pl'] as const)('offers a fresh checkout after expiry in %s without confirming payment', async locale => {
  const restart = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/validate-email'
    ? Response.json({ success: true, data: { isValid: true } })
    : Response.json({ success: false, code: 'checkout_session_expired' }, { status: 409 })));
  const view = form(locale, { onSessionExpired: restart });
  await waitFor(() => expect(view.container.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(false));
  fireEvent.submit(view.container.querySelector('form')!);
  await screen.findByText(locale === 'pl' ? 'Sesja płatności wygasła.' : 'Your payment session has expired.');
  fireEvent.click(screen.getByRole('button', { name: locale === 'pl' ? 'Rozpocznij nowy koszyk' : 'Start a new checkout' }));
  expect(restart).toHaveBeenCalledOnce();
  expect(stripe.confirm).not.toHaveBeenCalled();
  expect(view.container.querySelector('button[type=submit]')).toBeNull();
});

it('retires the pay button when the session deadline passes without a submit', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const view = form('pl', { expiresAt: Math.floor(Date.now() / 1000) - 1, onSessionExpired: vi.fn() });
  await screen.findByText('Sesja płatności wygasła.');
  expect(view.container.querySelector('button[type=submit]')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['en', 'pl'] as const)('localizes an overlong email beside the email field in %s and clears it on edit', async locale => {
  const fetch = vi.fn(async () => Response.json({ success: false, error: { code: 'EMAIL_TOO_LONG', message: 'Invalid email format' } }, { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  const view = form(locale);
  await waitFor(() => expect(view.container.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(false));
  fireEvent.submit(view.container.querySelector('form')!);
  const error = await screen.findByText(locale === 'pl' ? 'Adres e-mail może mieć maksymalnie 254 znaki.' : 'Email addresses can have at most 254 characters.');
  const email = view.container.querySelector('input[type=email]')!;
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(email.getAttribute('aria-describedby')).toBe(error.id);
  expect(view.container.textContent).not.toContain('Invalid email format');
  fireEvent.change(email, { target: { value: 'new@example.com' } });
  expect(error.isConnected).toBe(false);
  expect(stripe.confirm).not.toHaveBeenCalled();
});
