// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CheckoutProfileFields, { useCheckoutProfileValues } from '@/components/checkout/CheckoutProfileFields';
import { validateModuleValues } from '@/lib/checkout-modules/registry';
import type { CheckoutProfile } from '@/lib/checkout-modules/profile';
import type { UseInvoiceDataReturn } from '@/hooks/useInvoiceData';
import en from '@/messages/en.json';

const profile: CheckoutProfile = { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false }, { id: 'recipient', for: ['organization'] }] };
const invoice = { fullName: '', companyName: '', nip: '', address: '', city: '', postalCode: '', country: 'PL' } as UseInvoiceDataReturn;
afterEach(cleanup);
function Harness() {
  const state = useCheckoutProfileValues(profile, invoice, 'a@example.com', 1);
  return React.createElement(React.Fragment, null,
    React.createElement(CheckoutProfileFields, { profile, state, invoice, errors: state.errors, disabled: false }),
    React.createElement('button', { onClick: () => state.validate() }, 'Continue'));
}
it('validates before continuing and scrolls and focuses the first invalid field', () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(Harness)));
  fireEvent.click(screen.getByText('Continue'));
  expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  expect(document.activeElement?.id).toBe('buyer.company_name');
  expect(scroll).toHaveBeenCalled();
});
it('uses country selectors defaulting to PL for both parties', () => {
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(Harness)));
  fireEvent.click(screen.getByRole('checkbox'));
  for (const id of ['buyer.country', 'recipient.country']) {
    const select = document.getElementById(id) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('PL');
    expect(select.options.length).toBeGreaterThan(20);
  }
});
it('preserves the character limit in validation errors', () => {
  const result = validateModuleValues(profile, { buyer: { type: 'organization', company_name: 'a'.repeat(201), nip: '', address: '', city: '', postal_code: '' }, recipient: { differs: false } }, { locale: 'en', currency: 'PLN', quantity: 1 });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.errors).toContainEqual({ field: 'buyer.company_name', code: 'too_big', maximum: 200 });
});
it('renders the character limit beside the field', () => {
  const state = { buyerType: 'organization', person: { first_name: '', last_name: '', email: '' }, party: { company_name: 'a'.repeat(201), nip: '', address: '', postal_code: '', city: '', country: 'PL' }, differs: false } as ReturnType<typeof useCheckoutProfileValues>;
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CheckoutProfileFields, { profile, state, invoice, errors: [{ field: 'buyer.company_name', code: 'too_big', maximum: 200 }], disabled: false })));
  expect(screen.getByRole('alert').textContent).toBe('Maximum 200 characters.');
});
it('focuses a server-reported recipient error once payment processing finishes', () => {
  const state = { buyerType: 'organization', person: { first_name: '', last_name: '', email: '' }, party: { company_name: '', nip: '', address: '', postal_code: '', city: '', country: 'PL' }, differs: true, recipient: { company_name: '', nip: '', address: '', postal_code: '', city: '', country: 'PL' } } as ReturnType<typeof useCheckoutProfileValues>;
  const errors = [{ field: 'recipient.city', code: 'required' }];
  const show = (disabled: boolean) => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CheckoutProfileFields, { profile, state, invoice, errors, disabled }));
  const { rerender } = render(show(true));
  rerender(show(false));
  expect(document.activeElement?.id).toBe('recipient.city');
});
it.each(['GB', 'US'])('allows selecting and validating %s for buyer and recipient', country => {
  const party = { company_name: 'Example', nip: '5250001003', address: 'Street 1', postal_code: '12345', city: 'City', country: 'PL' };
  const setCountry = vi.fn();
  const setRecipient = vi.fn();
  const state = { buyerType: 'organization', person: { first_name: '', last_name: '', email: '' }, party, differs: true, recipient: party, setRecipient } as unknown as ReturnType<typeof useCheckoutProfileValues>;
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CheckoutProfileFields, { profile, state, invoice: { ...invoice, setCountry }, errors: [], disabled: false })));
  for (const id of ['buyer.country', 'recipient.country']) {
    const select = document.getElementById(id) as HTMLSelectElement;
    expect(Array.from(select.options).some(option => option.value === country)).toBe(true);
    fireEvent.change(select, { target: { value: country } });
  }
  expect(setCountry).toHaveBeenCalledWith(country);
  expect(setRecipient).toHaveBeenCalled();
  expect(validateModuleValues(profile, { buyer: { type: 'organization', ...party, country }, recipient: { differs: true, ...party, country } }, { locale: 'en', currency: 'PLN', quantity: 1 }).success).toBe(true);
});

it('renders a single phone label with its associated input', () => {
  const profile: CheckoutProfile = { v: 1, modules: [{ id: 'phone', required: true }] };
  const state = { phone: '', setPhone: vi.fn() } as unknown as ReturnType<typeof useCheckoutProfileValues>;
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CheckoutProfileFields, { profile, state, invoice, errors: [], disabled: false })));
  expect(screen.getAllByText('Phone')).toHaveLength(1);
  expect(screen.getByLabelText('Phone').tagName).toBe('INPUT');
});
