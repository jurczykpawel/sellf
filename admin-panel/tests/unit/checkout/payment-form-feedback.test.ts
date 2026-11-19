// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import CustomPaymentForm from '@/app/[locale]/checkout/[slug]/components/CustomPaymentForm';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const stripe = vi.hoisted(() => ({ confirm: vi.fn(), updateEmail: vi.fn(async () => ({})), updateBillingAddress: vi.fn(async () => ({ type: 'success' })) }));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckoutElements: () => ({ type: 'success', checkout: stripe }),
  PaymentElement: ({ onReady }: { onReady(): void }) => { React.useEffect(onReady, [onReady]); return null; },
}));
vi.mock('@/hooks/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }) }));
vi.mock('@/components/checkout/InvoiceSection', () => ({ default: () => null }));
vi.mock('@/components/DemoCheckoutNotice', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

function tree(locale: 'en' | 'pl', extra = {}) {
  return React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(CustomPaymentForm, {
    product: { id: 'product', price: 100, currency: 'PLN' },
    email: 'buyer@example.com', invoice: { fullName: 'Test Buyer' },
    profileForm: { errors: [], setErrors: vi.fn(), validate: () => true },
    onEmailChange: vi.fn(), collectTermsOfService: false, termsAccepted: true,
    onTermsAcceptedChange: vi.fn(), pricing: { basePrice: 100, totalPayable: 100 },
    clientSecret: 'cs_test_open_secret_value', bindingToken: 'binding', ...extra,
  } as unknown as React.ComponentProps<typeof CustomPaymentForm>));
}

function form(locale: 'en' | 'pl', extra = {}) { return render(tree(locale, extra)); }

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
  const view = form('pl', { sessionDeadline: performance.now() - 1, onSessionExpired: vi.fn() });
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

it.each([false, true])('keeps a fresh %s event checkout usable with client clock two hours ahead', async eventMode => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
  const view = form('en', { product: { id: 'product', price: 100, currency: 'PLN', event_mode: eventMode }, expiresAt: Math.floor(Date.now() / 1000) - 3600, sessionDeadline: performance.now() + 1800_000 });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(view.container.querySelector('button[type=submit]')).not.toBeNull();
  expect(view.container.textContent).not.toContain('Your payment session has expired.');
  vi.restoreAllMocks();
});


it.each(['signature', 'invalid'])('stops confirmation if cart %s changes during buyer validation', async change => {
  let release!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/validate-email' ? new Promise<Response>(resolve => { release = resolve; }) : Promise.resolve(Response.json({ success: true }))));
  const view = form('en', { cartSignature: 'first' });
  fireEvent.submit(view.container.querySelector('form')!);
  view.rerender(tree('en', { cartSignature: change === 'signature' ? 'second' : 'first', quantityInvalid: change === 'invalid' }));
  await act(async () => { release(Response.json({ success: true, data: { isValid: true } })); });
  expect(stripe.updateBillingAddress).toHaveBeenCalled();
  expect(stripe.confirm).not.toHaveBeenCalled();
  expect(view.container.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(change === 'invalid');
});

it('retains payment authentication past the local deadline and expires after a declined confirmation', async () => {
  let finish!: (value: unknown) => void;
  stripe.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: { isValid: true } })));
  const view = form('en', { sessionDeadline: performance.now() + 100 });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(stripe.confirm).toHaveBeenCalledOnce());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  expect(view.container.textContent).not.toContain('Your payment session has expired.');
  expect(view.container.querySelector('form')).not.toBeNull();
  await act(async () => { finish({ type: 'error', error: { message: 'Declined' } }); });
  await screen.findByText('Your payment session has expired.');
});

it('does not send a session deadline in buyer details', async () => {
  const fetch = vi.fn(async () => Response.json({ success: true, data: { isValid: true } }));
  vi.stubGlobal('fetch', fetch);
  stripe.confirm.mockResolvedValueOnce({ type: 'error', error: { message: 'Declined' } });
  const view = form('en', { expiresAt: Math.floor(Date.now() / 1000) + 1800, sessionDeadline: performance.now() + 10000 });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(stripe.confirm).toHaveBeenCalled());
  const [, init] = fetch.mock.calls.find(([url]) => url === '/api/update-payment-metadata')! as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string)).not.toHaveProperty('expiresAt');
  expect(JSON.parse(init.body as string)).not.toHaveProperty('sessionDeadline');
});

it.each([en, pl])('keeps email validation messages in checkout only', messages => {
  expect(messages.navigation).not.toHaveProperty('emailTooLong');
  expect(messages.navigation).not.toHaveProperty('emailInvalidFormat');
  expect(messages.checkout.emailTooLong).toBeTruthy();
  expect(messages.checkout.emailInvalidFormat).toBeTruthy();
});
