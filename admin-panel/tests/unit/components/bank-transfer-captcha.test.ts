// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Product } from '@/types';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/components/providers/config-provider', () => ({ useConfig: () => ({ captcha: { provider: 'none' } }) }));
vi.mock('@/components/checkout/CustomCheckoutFieldsForm', () => ({ default: () => null }));
import BankTransferForm from '@/components/checkout/BankTransferForm';
afterEach(cleanup);
it('uses the configured captcha provider so an unconfigured development checkout can submit', async () => {
  render(createElement(BankTransferForm, {
    collectTermsOfService: false, termsAccepted: false, onTermsAcceptedChange: vi.fn(), disabled: false,
    onModuleErrors: vi.fn(), product: { id: 'p', currency: 'PLN' } as Product, email: 'buyer@example.com', onEmailChange: vi.fn(),
    moduleValues: {}, sessionId: null, bumpIds: [], fields: [], values: {}, onValuesChange: vi.fn(),
  }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'placeOrder' }) as HTMLButtonElement).disabled).toBe(false));
});
it('shows the server 422 module errors in the fields, as the online payment does (W223c, W223br) @J623', async () => {
  const errors = [{ field: 'buyer.nip', code: 'invalid_checksum' }, { field: 'recipient.postal_code', code: 'required' }];
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ errors }), { status: 422 }));
  vi.stubGlobal('fetch', fetchMock);
  const onModuleErrors = vi.fn();
  render(createElement(BankTransferForm, {
    collectTermsOfService: false, termsAccepted: false, onTermsAcceptedChange: vi.fn(), disabled: false,
    onModuleErrors, product: { id: 'p', currency: 'PLN', checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false }] } } as unknown as Product,
    email: 'buyer@example.com', onEmailChange: vi.fn(),
    moduleValues: { buyer: { type: 'person', first_name: 'Jan', last_name: 'Nowak', email: 'buyer@example.com' } }, sessionId: null, bumpIds: [], fields: [], values: {}, onValuesChange: vi.fn(),
  }));
  const button = screen.getByRole('button', { name: 'placeOrder' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  button.click();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onModuleErrors).toHaveBeenLastCalledWith(errors));
  expect((await screen.findByRole('alert')).textContent).toBe('profile.fixFields');
  expect(button.disabled).toBe(false);
  vi.unstubAllGlobals();
});
