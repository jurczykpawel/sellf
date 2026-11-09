// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BankTransferSection from '@/components/admin/BankTransferSection';
import type { PaymentTransaction } from '@/types/payment';
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/components/tutorials/TutorialHelpButton', () => ({ default: () => null }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
vi.mock('@/components/checkout/TransferInstructions', () => ({ default: () => null }));
const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/lib/orders/bank-transfer-actions', () => ({ updateBankTransfer: update }));
afterEach(() => { cleanup(); update.mockReset(); });
it.each(['awaiting_payment', 'cancelled'])('associates a mismatched booked amount with the amount field for %s', async status => {
  render(createElement(BankTransferSection, { transaction: { id: 'tx', amount: 10000, currency: 'PLN', payment_provider: 'bank_transfer', status, created_at: '2026-11-01' } as PaymentTransaction, onRefresh: vi.fn() }));
  const amount = screen.getByRole('spinbutton');
  fireEvent.change(amount, { target: { value: '99.99' } });
  fireEvent.change(screen.getByLabelText('paidAt'), { target: { value: '2026-11-09' } });
  if (status === 'cancelled') fireEvent.change(screen.getByLabelText('lateReason'), { target: { value: 'Received late' } });
  await act(async () => { fireEvent.submit(amount.closest('form')!); });
  expect(update).not.toHaveBeenCalled();
  expect(amount.getAttribute('aria-invalid')).toBe('true');
  const error = document.getElementById(amount.getAttribute('aria-describedby')!);
  expect(error?.textContent).toBe('amountMismatch');
  expect(amount.closest('label')?.parentElement?.contains(error)).toBe(true);
  fireEvent.change(amount, { target: { value: '100' } });
  expect(amount.getAttribute('aria-invalid')).toBe('false');
  expect(screen.queryByText('amountMismatch')).toBeNull();
});
