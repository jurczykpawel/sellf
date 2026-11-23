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

it.each([['en', 'EMAIL_TOO_LONG'], ['pl', 'EMAIL_TOO_LONG'], ['en', 'INVALID_EMAIL_FORMAT'], ['pl', 'INVALID_EMAIL_FORMAT']] as const)('localizes %s email feedback for %s beside the field and clears it on edit', async (locale, detail) => {
  const fetch = vi.fn(async () => Response.json({ success: false, error: { code: 'VALIDATION_ERROR', detail, message: 'Invalid email format' } }, { status: 400 }));
  vi.stubGlobal('fetch', fetch);
  const view = form(locale);
  await waitFor(() => expect(view.container.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(false));
  fireEvent.submit(view.container.querySelector('form')!);
  const messages = locale === 'pl' ? pl.checkout : en.checkout;
  const error = await screen.findByText(detail === 'EMAIL_TOO_LONG' ? messages.emailTooLong : messages.emailInvalidFormat);
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


it.each([['en', 'signature'], ['en', 'invalid'], ['pl', 'signature'], ['pl', 'invalid']] as const)('explains the changed cart in %s when %s changes during validation', async (locale, change) => {
  let release!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/validate-email' ? new Promise<Response>(resolve => { release = resolve; }) : Promise.resolve(Response.json({ success: true }))));
  const view = form(locale, { cartSignature: 'first' });
  fireEvent.submit(view.container.querySelector('form')!);
  view.rerender(tree(locale, { cartSignature: change === 'signature' ? 'second' : 'first', quantityInvalid: change === 'invalid' }));
  await act(async () => { release(Response.json({ success: true, data: { isValid: true } })); });
  expect(stripe.updateBillingAddress).toHaveBeenCalled();
  expect(stripe.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain(locale === 'pl' ? 'Koszyk się zmienił. Sprawdź go przed ponowną próbą płatności.' : 'Your cart has changed. Review it before paying again.');
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

it.each(['en', 'pl'] as const)('rejects a legacy name longer than the stored limit beside the field in %s', async locale => {
  const fetcher = vi.fn(async () => Response.json({ success: true, data: { isValid: true } })); vi.stubGlobal('fetch', fetcher);
  const view = form(locale, { invoice: { fullName: 'R'.repeat(200) + 'Ż', setFullName: vi.fn() } });
  fireEvent.submit(view.container.querySelector('form')!);
  const input = view.container.querySelector('#fullName')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('200');
  expect(fetcher).not.toHaveBeenCalled();
  expect(stripe.confirm).not.toHaveBeenCalled();
  view.rerender(tree(locale, { invoice: { fullName: 'R'.repeat(199) + 'Ż', setFullName: vi.fn() } }));
  expect(view.container.querySelector('#fullName')?.getAttribute('aria-invalid')).toBe('false');
});

it.each(['en','pl'] as const)('marks the pending cart in %s and explains a quantity conflict', async locale => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/validate-email'
    ? Response.json({success:true,data:{isValid:true}})
    : Response.json({success:false,code:'quantity_snapshot_mismatch'},{status:409})));
  const view=form(locale,{cartUpdating:true,quantityInvalid:true});
  const button=view.container.querySelector('button[type=submit]')!;
  expect(button.getAttribute('data-checkout-pending')).toBe('true');
  expect(screen.getByText(locale==='pl'?/Aktualizujemy koszyk/:/Updating your cart/).getAttribute('role')).toBe('status');
  view.rerender(tree(locale));
  fireEvent.submit(view.container.querySelector('form')!);
  expect((await screen.findByRole('alert')).textContent).toContain(locale==='pl'?'Koszyk się zmienił':'Your cart has changed');
  expect(stripe.confirm).not.toHaveBeenCalled();
});
