// @vitest-environment happy-dom
/**
 * B10 (W146): "Mark as paid" names a wrong receipt date (before the order / in the future)
 * and never leaves an old error on screen after a successful attempt.
 * @see src/components/admin/BankTransferSection.tsx
 * @see supabase/tests/transfer-paid-at-window.sql
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/lib/orders/bank-transfer-actions', () => ({ updateBankTransfer: h.update }));
vi.mock('@/components/tutorials/TutorialHelpButton', () => ({ default: () => null }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
import BankTransferSection from '@/components/admin/BankTransferSection';
import { operateTransfer } from '@/lib/orders/bank-transfer-admin';
import pl from '@/messages/pl.json';
import type { PaymentTransaction } from '@/types/payment';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
afterEach(() => { cleanup(); h.update.mockReset(); });

const tx = { id: '10000000-0000-4000-8000-000000000001', payment_provider: 'bank_transfer', status: 'awaiting_payment', amount: 12300, currency: 'PLN',
  created_at: '2026-11-03T10:00:00Z', transfer_details: null } as unknown as PaymentTransaction;
const msg = (pl as unknown as { bankTransfer: Record<string, string> }).bankTransfer;

function setup() {
  const onRefresh = vi.fn();
  const view = render(createElement(NextIntlClientProvider, { locale: 'pl', messages: pl, timeZone: 'UTC' }, createElement(BankTransferSection, { transaction: tx, onRefresh })));
  const date = view.container.querySelector('input[type="date"]') as HTMLInputElement;
  const submit = () => fireEvent.submit(date.closest('form')!);
  return { date, submit, onRefresh, view };
}

it('refuses a receipt date before the order day with its own message, without calling the server', async () => {
  const { date, submit } = setup();
  expect(date.min).toBe('2026-11-03');
  fireEvent.change(date, { target: { value: '2020-01-01' } });
  submit();
  expect(await screen.findByText(msg.paidAtBeforeOrder)).toBeTruthy();
  expect(h.update).not.toHaveBeenCalled();
});

it('clears an earlier error once the next attempt succeeds', async () => {
  h.update.mockResolvedValueOnce({ success: false, code: 'paid_at_future' }).mockResolvedValueOnce({ success: true });
  const { date, submit, onRefresh } = setup();
  fireEvent.change(date, { target: { value: '2026-11-03' } });
  submit();
  expect(await screen.findByText(msg.paidAtFuture)).toBeTruthy();
  submit();
  await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  expect(screen.queryByText(msg.paidAtFuture)).toBeNull();
  expect(screen.queryByText(msg.operationError)).toBeNull();
});

it('passes the database refusal code through the shared operation (API v1 too)', async () => {
  const db = { rpc: vi.fn(async () => ({ data: { success: false, error: 'paid_at_before_order' }, error: null })) } as unknown as SupabaseClient<Database>;
  const result = await operateTransfer(db, 'actor', tx.id, { action: 'mark-paid', amount: 12300, paidAt: '2020-01-01T00:00:00Z' });
  expect(result).toMatchObject({ success: false, code: 'paid_at_before_order' });
  expect(result.error).toMatch(/order/i);
});

it('has both messages in Polish and English', async () => {
  const en = (await import('@/messages/en.json')).default as unknown as { bankTransfer: Record<string, string> };
  for (const key of ['paidAtBeforeOrder', 'paidAtFuture']) { expect(msg[key]).toBeTruthy(); expect(en.bankTransfer[key]).toBeTruthy(); }
});
