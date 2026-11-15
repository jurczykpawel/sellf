// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
afterEach(cleanup);
// W254: a cancelled order is no longer payable online; the notice must not offer it.
it.each(['en', 'pl'])('explains that a cancelled transfer order can no longer be paid in %s', locale => {
  render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, createElement(TransferInstructions, { cancelled: true, transfer: null, amount: 1000, currency: 'PLN' })));
  expect(screen.getByRole('alert').textContent).toContain(locale === 'pl' ? 'Nie wysyłaj przelewu' : 'Do not send a bank transfer');
  expect(screen.getByRole('alert').textContent).toContain(locale === 'pl' ? 'nie można już opłacić' : 'can no longer be paid');
  expect(screen.getByRole('alert').textContent).not.toMatch(/online/i);
  expect(screen.queryByRole('region')).toBeNull();
});
