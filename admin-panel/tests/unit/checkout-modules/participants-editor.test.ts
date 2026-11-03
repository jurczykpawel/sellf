// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CheckoutProfileFields, { useCheckoutProfileValues } from '@/components/checkout/CheckoutProfileFields';
import type { CheckoutProfile } from '@/lib/checkout-modules/profile';
import type { UseInvoiceDataReturn } from '@/hooks/useInvoiceData';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const invoice = { fullName: '', companyName: '', nip: '', address: '', city: '', postalCode: '', country: 'PL' } as UseInvoiceDataReturn;
const make = (allowLater: boolean): CheckoutProfile => ({ v: 1, modules: [
  { id: 'quantity', min: 1, max: 20, mode: 'checkout' },
  { id: 'participants', required: true, prefill_from_buyer: false, ...(allowLater ? { allow_later: true } : {}) },
] });
let latest: ReturnType<typeof useCheckoutProfileValues> | undefined;
function Harness({ profile, quantity }: { profile: CheckoutProfile; quantity: number }) {
  const state = useCheckoutProfileValues(profile, invoice, 'buyer@example.com', quantity);
  latest = state;
  return React.createElement(CheckoutProfileFields, { profile, state, invoice, errors: state.errors, disabled: false });
}
function show(profile: CheckoutProfile, quantity: number, locale: 'en' | 'pl' = 'en') {
  return render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(Harness, { profile, quantity })));
}
afterEach(() => { cleanup(); latest = undefined; });

it('fills the participant rows from a pasted list', () => {
  show(make(false), 3);
  fireEvent.change(screen.getByLabelText('Paste a list'), { target: { value: 'Jan, Nowak, jan@example.com\nAnna;Kowalska;anna@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fill from list' }));
  expect((document.getElementById('participants.0.first_name') as HTMLInputElement).value).toBe('Jan');
  expect((document.getElementById('participants.1.email') as HTMLInputElement).value).toBe('anna@example.com');
  expect((document.getElementById('participants.2.email') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('status').textContent).toMatch(/2 of 3/);
});

it('imports a CSV file into the rows', async () => {
  show(make(false), 2);
  const file = new File(['first,last,email\nJan,Nowak,jan@example.com\nAnna,Kowalska,anna@example.com'], 'people.csv', { type: 'text/csv' });
  await act(async () => { fireEvent.change(screen.getByLabelText('Import CSV'), { target: { files: [file] } }); });
  await waitFor(() => expect((document.getElementById('participants.1.last_name') as HTMLInputElement).value).toBe('Kowalska'));
});

it('lets the buyer add participants later and submits an empty list', () => {
  show(make(true), 4);
  expect(document.getElementById('participants.0.first_name')).toBeTruthy();
  fireEvent.click(screen.getByLabelText("I'll add participants later"));
  expect(document.getElementById('participants.0.first_name')).toBeNull();
  expect(latest!.values.participants).toEqual([]);
  expect(latest!.validate()).toBe(true);
});

it('does not offer "later" unless the product allows it', () => {
  show(make(false), 4);
  expect(screen.queryByLabelText("I'll add participants later")).toBeNull();
});

it('keeps every participant input labelled for assistive technology and translated', () => {
  show(make(false), 10, 'pl');
  const input = document.getElementById('participants.9.email') as HTMLInputElement;
  expect(input.labels?.[0]?.textContent).toMatch(/E-?mail/i);
  expect(document.querySelectorAll('input[id^="participants."]')).toHaveLength(30);
});
