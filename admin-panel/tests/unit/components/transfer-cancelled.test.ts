// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);
it.each(['en', 'pl'])('explains cancelled transfer and the online purchase option in %s', locale => {
  render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, createElement(TransferInstructions, { cancelled: true, transfer: null, amount: 1000, currency: 'PLN' })));
  expect(screen.getByRole('alert').textContent).toContain(locale === 'pl' ? 'Nie wysyłaj już przelewu' : 'Do not send a bank transfer');
  expect(screen.getByRole('alert').textContent).toContain(locale === 'pl' ? 'online' : 'online');
  expect(screen.queryByRole('region')).toBeNull();
});
