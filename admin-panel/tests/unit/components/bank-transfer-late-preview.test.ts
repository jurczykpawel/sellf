// @vitest-environment happy-dom
/**
 * The late-transfer preview reads the payments API directly. Server actions from one page run one at a time, so a preview
 * fetched as an action waited behind every other detail the payment panel loads; on a busy server the administrator saw an
 * empty "Preview before acceptance" box for seconds (W355, J184 red in the release gate).
 * @see src/components/admin/BankTransferSection.tsx, src/app/api/v1/payments/[id]/late-transfer-preview/route.ts
 */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BankTransferSection from '@/components/admin/BankTransferSection';
import type { LateTransferPreview } from '@/lib/orders/late-transfer-preview';
import type { PaymentTransaction } from '@/types/payment';
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key }));
vi.mock('@/components/tutorials/TutorialHelpButton', () => ({ default: () => null }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
vi.mock('@/components/checkout/TransferInstructions', () => ({ default: () => null }));
// A busy action queue: no server action called from the panel ever answers.
vi.mock('@/lib/orders/bank-transfer-actions', () => ({ updateBankTransfer: () => new Promise(() => {}), retryOrderNotice: () => new Promise(() => {}) }));
const getCustom = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ api: { getCustom } }));
afterEach(() => { cleanup(); getCustom.mockReset(); });

const cancelled = { id: '6f1c2f4e-1b1a-4d8e-9a43-2b8f0f0c9d11', amount: 10000, currency: 'PLN', payment_provider: 'bank_transfer', status: 'cancelled',
  cancel_reason: 'payment_window_expired', created_at: '2026-11-20T10:00:00Z' } as unknown as PaymentTransaction;
const preview: LateTransferPreview = { amount: 10000, currency: 'PLN', unitPrice: 100, unitPriceToday: null, priceChanged: true,
  seats: { remaining: 0, tierRemaining: 0, quantity: 1, oversold: true, started: false }, coupon: null, invoiceCorrected: false };

it('loads the late-transfer preview from the payments API, independent of the server-action queue', async () => {
  getCustom.mockResolvedValue(preview);
  render(createElement(BankTransferSection, { transaction: cancelled, onRefresh: vi.fn() }));
  expect(await screen.findByText(/latePrice .*"today":"latePriceTodayUnavailable"/)).toBeTruthy();
  expect(screen.getByText('lateSeatsOversold')).toBeTruthy();
  expect(getCustom).toHaveBeenCalledWith(`payments/${cancelled.id}/late-transfer-preview`);
  // Over the limit the acceptance needs the explicit confirmation as soon as the preview says so.
  expect(screen.getByRole('checkbox', { name: 'lateOversoldConfirm' })).toBeTruthy();
});

it('says the preview is unavailable when the API refuses it', async () => {
  getCustom.mockRejectedValue(new Error('NOT_FOUND'));
  render(createElement(BankTransferSection, { transaction: cancelled, onRefresh: vi.fn() }));
  expect(await screen.findByText('latePreviewError')).toBeTruthy();
});
