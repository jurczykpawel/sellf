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
// The late-transfer preview is read over the v1 API: keep it pending instead of calling a real server.
vi.mock('@/lib/api/client', () => ({ api: { getCustom: () => new Promise(() => {}) } }));
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
it.each(['awaiting_payment', 'cancelled'])('brings a mismatched booked amount into view and focus for %s', async status => {
  const scrolled: Element[] = [];
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this); });
  try {
    render(createElement(BankTransferSection, { transaction: { id: 'tx', amount: 10000, currency: 'PLN', payment_provider: 'bank_transfer', status, created_at: '2026-11-01' } as PaymentTransaction, onRefresh: vi.fn() }));
    const amount = screen.getByRole('spinbutton');
    fireEvent.change(amount, { target: { value: '99.99' } });
    fireEvent.change(screen.getByLabelText('paidAt'), { target: { value: '2026-11-09' } });
    if (status === 'cancelled') fireEvent.change(screen.getByLabelText('lateReason'), { target: { value: 'Received late' } });
    await act(async () => { fireEvent.submit(amount.closest('form')!); });
    const error = document.getElementById(amount.getAttribute('aria-describedby')!);
    expect(document.activeElement).toBe(amount);
    expect(scrolled).toContain(error);
    // A second refused attempt brings it back again.
    amount.blur(); scrolled.length = 0;
    await act(async () => { fireEvent.submit(amount.closest('form')!); });
    expect(document.activeElement).toBe(amount);
    expect(scrolled).toHaveLength(1);
  } finally { scroll.mockRestore(); }
});
it.each([
  ['awaiting_payment', 'markPaid'], ['awaiting_payment', 'cancel'],
  ['awaiting_payment', 'markInvoiceIssued'], ['cancelled', 'acceptLate'],
])('shows progress and holds the lock until refresh for %s / %s', async (status, label) => {
  let finish!: (result: { success: boolean }) => void;
  let refreshed!: () => void;
  update.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const refresh = vi.fn(() => new Promise<void>(resolve => { refreshed = resolve; }));
  render(createElement(BankTransferSection, { transaction: { id: 'tx', amount: 10000, currency: 'PLN', payment_provider: 'bank_transfer', status, created_at: '2026-11-01' } as PaymentTransaction, onRefresh: refresh }));
  fireEvent.change(screen.getByLabelText('paidAt'), { target: { value: '2026-11-09' } });
  fireEvent.change(screen.getByLabelText(status === 'cancelled' ? 'lateReason' : 'reason'), { target: { value: 'Received' } });
  const button = screen.getByRole('button', { name: label });
  await act(async () => { if (button.closest('form')) fireEvent.submit(button.closest('form')!); else fireEvent.click(button); });
  expect(button.textContent).toContain(`${label}Pending`);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.querySelector('svg')).not.toBeNull();
  for (const candidate of screen.getAllByRole('button')) expect((candidate as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { if (button.closest('form')) fireEvent.submit(button.closest('form')!); else fireEvent.click(button); });
  expect(update).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ success: true }); });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { refreshed(); });
  expect((button as HTMLButtonElement).disabled).toBe(false);
});
