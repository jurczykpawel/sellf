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
const retry = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orders/bank-transfer-actions', () => ({ retryOrderNotice: retry, getLateTransferPreview: async () => ({ success: false }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); retry.mockReset(); });
const tx = { id: 'tx', amount: 1000, currency: 'PLN', payment_provider: 'bank_transfer', status: 'awaiting_payment',
  reminder_mail_delivery_unknown: true, reminder_mail_sent_at: '2026-11-24T12:00:00Z' } as PaymentTransaction;
it('reveals retry only after five minutes without reopening the panel', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-24T12:04:59Z'));
  render(createElement(BankTransferSection, { transaction: tx, onRefresh: vi.fn() }));
  expect(screen.queryByRole('button', { name: 'retryMail' })).toBeNull();
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(screen.getByRole('button', { name: 'retryMail' })).toBeTruthy();
});
it('hides a reminder retry after the order is paid', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-24T12:10:00Z'));
  render(createElement(BankTransferSection, { transaction: { ...tx, status: 'completed' }, onRefresh: vi.fn() }));
  expect(screen.queryByRole('button', { name: 'retryMail' })).toBeNull();
});
it('reports a refused retry in a completed order panel', async () => {
  retry.mockResolvedValue({ success: false });
  render(createElement(BankTransferSection, { transaction: { ...tx, status: 'completed', reminder_mail_delivery_unknown: false,
    transfer_paid_mail_delivery_unknown: true, transfer_paid_mail_sent_at: '2026-01-01T00:00:00Z' }, onRefresh: vi.fn() }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'retryMail' })); });
  expect(screen.getByText('operationError')).toBeTruthy();
});

it('does not expose an empty operation status', () => {
  render(createElement(BankTransferSection, { transaction: { ...tx, status: 'completed', reminder_mail_delivery_unknown: false }, onRefresh: vi.fn() }));
  expect(screen.queryByRole('status')).toBeNull();
});
