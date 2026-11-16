// @vitest-environment happy-dom
/** The seller sees in the order's payment details that the buyer declared the transfer after the reservation deadline. */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BankTransferSection from '@/components/admin/BankTransferSection';
import type { PaymentTransaction } from '@/types/payment';
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/components/tutorials/TutorialHelpButton', () => ({ default: () => null }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
vi.mock('@/components/checkout/TransferInstructions', () => ({ default: () => null }));
vi.mock('@/lib/orders/bank-transfer-actions', () => ({ updateBankTransfer: vi.fn(), getLateTransferPreview: async () => ({ success: false }) }));
afterEach(cleanup);
const base = { id: 'tx', amount: 10000, currency: 'PLN', payment_provider: 'bank_transfer', created_at: '2026-11-01', release_at: '2026-11-15T12:00:00+00:00', transfer_declared_note: 'Wysłane wczoraj' };
const badge = () => screen.getByText(/declaredBadge/).textContent;
it.each(['awaiting_payment', 'cancelled'])('marks a declaration made after the deadline as late (%s)', status => {
  render(createElement(BankTransferSection, { transaction: { ...base, status, transfer_declared_at: '2026-11-15T12:05:00.123456+00:00' } as unknown as PaymentTransaction, onRefresh: vi.fn() }));
  expect(badge()).toContain('(declaredAfterDeadline)');
  expect(badge()).toContain('Wysłane wczoraj');
});
it('a declaration before the deadline is not marked late', () => {
  render(createElement(BankTransferSection, { transaction: { ...base, status: 'awaiting_payment', release_at: '2026-11-18T10:00:00+00:00', transfer_declared_at: '2026-11-15T10:00:00+00:00' } as unknown as PaymentTransaction, onRefresh: vi.fn() }));
  expect(badge()).not.toContain('declaredAfterDeadline');
});
