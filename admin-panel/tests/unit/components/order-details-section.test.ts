// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import OrderDetailsSection from '@/components/admin/OrderDetailsSection';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import details from '../fixtures/order-details.json';

afterEach(cleanup);
function show(orderDetails: unknown, locale = 'en', custom = false) {
  return render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en },
    React.createElement(OrderDetailsSection, { details: orderDetails, customFields: custom ? [{ id: 'note', label: 'Diet', value: 'Vegetarian', type: 'text' }] : [] })));
}
describe('admin checkout data section', () => {
  it('renders buyer, recipient, phone, quantity, five participants and custom answers', () => {
    show(details, 'en', true);
    expect(screen.getByText('Checkout data')).toBeTruthy();
    for (const text of ['Organization', 'Gmina Przykładowa', '5250001003', 'Główna 1', 'Szkoła Podstawowa nr 1', '+48500100200', 'Vegetarian']) expect(screen.getByText(text, { exact: false })).toBeTruthy();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(6);
    expect(screen.getByText('anna5@example.com')).toBeTruthy();
  });
  it('omits a recipient identical to the buyer and renders Polish labels', () => {
    show({ ...details, recipient: { v: 1, differs: false } }, 'pl');
    expect(screen.getByText('Dane z koszyka')).toBeTruthy();
    expect(screen.queryByText('Odbiorca')).toBeNull();
  });
  it('warns when required order details were not collected', () => {
    show({ details_missing: true });
    expect(screen.getByRole('alert').textContent).toContain('incomplete');
  });
  it('keeps orders without profile details unchanged and shows custom fields alone', () => {
    const { unmount, container } = show({ buyer: { v: 1, needs_invoice: true } });
    expect(container.querySelector('section')).toBeNull();
    unmount();
    show(null, 'en', true);
    expect(screen.getByText('Vegetarian')).toBeTruthy();
  });
  it('renders person details without company fields', () => {
    show({ buyer: { v: 1, type: 'person', first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' } });
    expect(screen.getByText('Person')).toBeTruthy();
    expect(screen.getByText('Jan Nowak')).toBeTruthy();
    expect(screen.getByText('jan@example.com')).toBeTruthy();
    expect(screen.queryByText('Tax ID')).toBeNull();
  });
});

it('names each missing module and explains deferred participants', () => {
  show({ details_missing: true, missing_modules: ['participants', 'phone'] }, 'pl');
  expect(screen.getByRole('alert').textContent).toContain('Uczestnicy: do uzupełnienia przez kupującego');
  expect(screen.getByRole('alert').textContent).toContain('Telefon: brak danych');
});

it.each(['en', 'pl'])('shows saved embed company data without a buyer type in %s', locale => {
  show({ buyer: { v: 1, company_name: 'Embedded Company', nip: '5252248481', address: 'Krótka 2', city: 'Kraków' } }, locale);
  for (const value of ['Embedded Company', '5252248481', 'Krótka 2', 'Kraków']) expect(screen.getByText(value)).toBeTruthy();
});
