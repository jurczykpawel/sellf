// @vitest-environment happy-dom
import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CheckoutProfileFields, { CheckoutQuantityField, useCheckoutProfileValues } from '@/components/checkout/CheckoutProfileFields';
import { validateModuleValues } from '@/lib/checkout-modules/registry';
import type { CheckoutProfile } from '@/lib/checkout-modules/profile';
import type { UseInvoiceDataReturn } from '@/hooks/useInvoiceData';
import en from '@/messages/en.json';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('@/lib/checkout/invoice-company-lookup', () => ({ lookupInvoiceCompany: lookup, canLookUpCompany: (type: string) => type === 'pl_nip' }));
const FOUND = { ok: true, source: 'gus', party: { company_name: 'Przykładowa Sp. z o.o.', address: 'ul. Wzorcowa 12/4', postal_code: '00-001', city: 'Warszawa', country: 'PL' } };

const profile: CheckoutProfile = { v: 1, modules: [{ id: 'buyer', types: ['organization'] }, { id: 'recipient', for: ['organization'] }] };
const invoice = { fullName: '', companyName: '', nip: '', address: '', city: '', postalCode: '', country: 'PL' } as UseInvoiceDataReturn;
afterEach(() => { cleanup(); lookup.mockReset(); });
let latest: ReturnType<typeof useCheckoutProfileValues>;
function Harness({ disabled = false }: { disabled?: boolean }) {
  const state = useCheckoutProfileValues(profile, invoice, 'a@example.com', 1);
  latest = state;
  return React.createElement(React.Fragment, null,
    React.createElement(CheckoutProfileFields, { profile, state, errors: state.errors, disabled }),
    React.createElement('button', { onClick: () => state.validate() }, 'Continue'));
}
const show = (disabled = false) => React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(Harness, { disabled }));
const section = en.checkout.invoiceSection;

it('an organization gets the standard invoice section: one NIP or EU VAT field, no extra checkbox @J623', () => {
  render(show());
  expect(screen.getByLabelText(section.taxIdLabel)).toBeTruthy();
  expect(screen.queryByLabelText(section.wantInvoice)).toBeNull();
  expect(screen.getByLabelText(section.wantRecipient)).toBeTruthy();
});
it('validates before continuing and scrolls and focuses the first invalid field, with the section messages', () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  render(show());
  fireEvent.click(screen.getByText('Continue'));
  expect(document.activeElement?.id).toBe('nip');
  expect(screen.getByText(section.errors.tax_id_required)).toBeTruthy();
  expect(scroll).toHaveBeenCalled();
});
it('a Polish NIP fetches the company like the standard checkout and the module values follow the NIP path', async () => {
  lookup.mockResolvedValue(FOUND);
  render(show());
  fireEvent.change(screen.getByLabelText(section.taxIdLabel), { target: { value: '118-169-72-28' } });
  expect(await screen.findByTestId('buyer-company-card')).toBeTruthy();
  expect(latest.values.buyer).toMatchObject({ type: 'organization', nip: '118-169-72-28', company_name: 'Przykładowa Sp. z o.o.', tax_id_mode: 'tax_id', country: 'PL' });
  expect(latest.validate()).toBe(true);
});
it('the manual path: chosen country, then valid module values', () => {
  render(show());
  fireEvent.click(screen.getByText(section.toManual));
  const country = document.getElementById('country') as HTMLSelectElement;
  expect(country.value).toBe('PL');
  fireEvent.change(country, { target: { value: 'US' } });
  for (const [id, value] of [['companyName', 'Acme Inc.'], ['address', '1 Main St'], ['postalCode', '10001'], ['city', 'New York']]) {
    fireEvent.change(document.getElementById(id)!, { target: { value } });
  }
  expect(latest.values.buyer).toMatchObject({ country: 'US', tax_id_mode: 'manual', company_name: 'Acme Inc.' });
  expect(validateModuleValues(profile, latest.values, { locale: 'en', currency: 'PLN', quantity: 1 }).success).toBe(true);
});
it('the shared rules report the same codes for the profile', () => {
  const result = validateModuleValues(profile, { buyer: { type: 'organization', company_name: 'a'.repeat(201), nip: '', address: '', city: '', postal_code: '' }, recipient: { differs: false } }, { locale: 'en', currency: 'PLN', quantity: 1 });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.errors).toContainEqual({ field: 'buyer.company_name', code: 'too_long' });
});
it('server-reported module errors land on the section fields and focus once payment processing finishes', async () => {
  lookup.mockResolvedValue(FOUND);
  const { rerender } = render(show(true));
  rerender(show(false));
  fireEvent.click(screen.getByLabelText(section.wantRecipient));
  act(() => latest.setErrors([{ field: 'recipient.nip', code: 'nip_only' }]));
  rerender(show(true));
  rerender(show(false));
  expect(document.activeElement?.id).toBe('recipientNip');
  expect(screen.getByText(section.errors.nip_only)).toBeTruthy();
});
it('the recipient is sent only with a Polish NIP institution and only for an organization', () => {
  render(show());
  expect(latest.values.recipient).toEqual({ differs: false });
  fireEvent.click(screen.getByLabelText(section.wantRecipient));
  fireEvent.change(document.getElementById('recipientNip')!, { target: { value: 'DE123456789' } });
  expect(latest.values.recipient).toMatchObject({ differs: true, nip: 'DE123456789' });
  const result = validateModuleValues(profile, latest.values, { locale: 'en', currency: 'PLN', quantity: 1 });
  expect(result.success ? [] : result.errors).toContainEqual({ field: 'recipient.nip', code: 'nip_only' });
});

it('renders a single phone label with its associated input', () => {
  const profile: CheckoutProfile = { v: 1, modules: [{ id: 'phone', required: true }] };
  const state = { phone: '', setPhone: vi.fn() } as unknown as ReturnType<typeof useCheckoutProfileValues>;
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(CheckoutProfileFields, { profile, state, errors: [], disabled: false })));
  expect(screen.getAllByText('Phone')).toHaveLength(1);
  expect(screen.getByLabelText('Phone').tagName).toBe('INPUT');
});

const hydrationProfile: CheckoutProfile = { v: 1, modules: [
  { id: 'buyer', types: ['person', 'organization'] },
  { id: 'recipient', for: ['organization'] }, { id: 'phone', required: true },
  { id: 'participants', required: true, prefill_from_buyer: false },
] };
function HydrationHarness({ disabled = false }: { disabled?: boolean }) {
  const state = useCheckoutProfileValues(hydrationProfile, invoice, 'buyer@example.com', 1);
  return React.createElement(NextIntlClientProvider, { locale: 'en', messages: en },
    React.createElement(CheckoutProfileFields, { profile: hydrationProfile, state, errors: [], disabled }));
}
it('keeps every server-rendered profile control inactive until the client is ready', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(React.createElement(HydrationHarness));
  const controls = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')];
  expect(controls.length).toBeGreaterThan(5);
  expect(controls.every(control => control.disabled || control.closest('fieldset[disabled]'))).toBe(true);
});
it('keeps the server-rendered quantity inactive until the client is ready', () => {
  const html = renderToString(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en },
    React.createElement(CheckoutQuantityField, { config: { id: 'quantity', min: 1, max: 5, mode: 'checkout' }, value: '1', onChange: vi.fn(), invalid: false })));
  const container = document.createElement('div'); container.innerHTML = html;
  expect(container.querySelector('input')?.disabled).toBe(true);
});
it('enables hydrated profile controls and honors payment processing for all modules', () => {
  const { container, rerender } = render(React.createElement(HydrationHarness));
  fireEvent.change(screen.getByLabelText('Buyer type'), { target: { value: 'organization' } });
  fireEvent.click(screen.getByLabelText(section.wantRecipient));
  expect(document.getElementById('recipientNip')).not.toBeNull();
  expect([...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')].every(control => !control.disabled && !control.closest('fieldset[disabled]'))).toBe(true);
  rerender(React.createElement(HydrationHarness, { disabled: true }));
  expect([...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')].every(control => control.disabled || control.closest('fieldset[disabled]'))).toBe(true);
});
const quantityConfig = { id: 'quantity', min: 2, max: 5, mode: 'product_page' } as const;
const renderQuantity = (value: string, onChange = vi.fn(), invalid = false) => {
  render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en },
    React.createElement(CheckoutQuantityField, { config: quantityConfig, value, onChange, invalid })));
  return onChange;
};
it('lets the buyer change the quantity with large labelled step buttons that stop at the limits @J238', () => {
  const onChange = renderQuantity('3');
  expect(screen.getByLabelText('Quantity', { exact: true })).toHaveProperty('value', '3');
  fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
  expect(onChange).toHaveBeenLastCalledWith('4');
  fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
  expect(onChange).toHaveBeenLastCalledWith('2');
  cleanup();
  renderQuantity('2');
  expect(screen.getByRole('button', { name: 'Decrease quantity' })).toHaveProperty('disabled', true);
  cleanup();
  renderQuantity('5');
  expect(screen.getByRole('button', { name: 'Increase quantity' })).toHaveProperty('disabled', true);
});
it('steps from the nearest valid quantity when the typed value is invalid and states the allowed range', () => {
  const onChange = renderQuantity('abc', vi.fn(), true);
  fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
  expect(onChange).toHaveBeenLastCalledWith('2');
  expect(screen.getByText('From 2 to 5')).toBeTruthy();
});
