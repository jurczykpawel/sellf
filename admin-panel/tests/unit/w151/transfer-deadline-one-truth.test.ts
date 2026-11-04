// @vitest-environment happy-dom
/** W146: the order page showed the payment term (18 Nov) while the mail showed the reservation end (6 Nov). One deadline, one format. */
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import { formatTransferDeadline, transferDeadline } from '@/lib/orders/transfer-format';
import pl from '@/messages/pl.json';
afterEach(cleanup);

it('picks the reservation end while it runs, else the payment term', () => {
  expect(transferDeadline({ release_at: '2026-11-06T10:09:00Z', payment_due_at: '2026-11-18T10:09:00Z' })).toBe('2026-11-06T10:09:00Z');
  expect(transferDeadline({ release_at: null, payment_due_at: '2026-11-18T10:09:00Z' })).toBe('2026-11-18T10:09:00Z');
});

it('renders the deadline exactly as the mail does', () => {
  render(createElement(NextIntlClientProvider, { locale: 'pl', messages: pl, timeZone: 'UTC' }, createElement(TransferInstructions, { transfer: { account: 'PL61109010140000071219812874' }, amount: 12300, currency: 'PLN', dueAt: '2026-11-06T10:09:00Z' })));
  expect(screen.getByText(formatTransferDeadline('2026-11-06T10:09:00Z', 'pl'))).toBeTruthy();
});

it('the order page, the admin order view and the mail all use the shared deadline', () => {
  for (const file of ['src/app/[locale]/order/[orderId]/transfer/page.tsx', 'src/components/admin/BankTransferSection.tsx']) {
    expect(readFileSync(file, 'utf8'), file).toContain('dueAt={transferDeadline(tx)}');
  }
  expect(readFileSync('src/lib/orders/transfer-mail.ts', 'utf8')).toContain('formatTransferDeadline(transferDeadline(tx), locale)');
});
