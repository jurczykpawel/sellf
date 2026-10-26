// @vitest-environment happy-dom
/** Partner search selection. @see components/affiliates/payouts/PayoutPanel.tsx */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ choices: vi.fn(), preview: vi.fn(), paid: vi.fn(), adjust: vi.fn() }));
vi.mock('@/lib/affiliates/payouts/reads', () => ({ getPayoutChoices: mocks.choices, previewPayout: mocks.preview }));
vi.mock('@/lib/affiliates/payouts/actions', () => ({ reservePayout: vi.fn(), markPayoutPaid: mocks.paid, cancelPayout: vi.fn(), adjustCommission: mocks.adjust }));
import PayoutPanel from '@/components/affiliates/payouts/PayoutPanel';
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks();
  mocks.preview.mockResolvedValue({ success: true, data: { member_version: '1', program_version: '1', earnings_minor: '2000', debt_offset_minor: '0', payable_minor: '2000', held_minor: '0', threshold_minor: '1', available: true, sync_required: false } });
});
it('waits for explicit selection when a search returns a single partner and then loads the preview', async () => {
  const a = { id: 'aaaaaaaa-0000-4000-a000-000000000001', display_name: 'Anna', code: 'anna', status: 'approved' };
  const b = { ...a, id: 'bbbbbbbb-0000-4000-a000-000000000001', display_name: 'Beata' };
  mocks.choices.mockImplementation(async ({ search }: { search: string }) => ({ success: true, data: { programConfigured: true, members: search ? [a] : [a, b], currencies: ['PLN'], payouts: [], commissions: [] } }));
  render(<PayoutPanel locale="en" download={() => {}} />);
  const picker = screen.getByRole('combobox', { name: 'Partner' });
  await waitFor(() => expect(mocks.choices).toHaveBeenCalled());
  fireEvent.focus(picker); fireEvent.change(picker, { target: { value: 'Anna' } });
  await waitFor(() => expect(mocks.choices).toHaveBeenCalledWith(expect.objectContaining({ search: 'Anna' })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('option', { name: 'Anna' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Reserve for payout' }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ member_id: a.id }));
});
it('keeps the preview when the already selected partner is selected again', async () => {
  const a = { id: 'aaaaaaaa-0000-4000-a000-000000000001', display_name: 'Anna', code: 'anna', status: 'approved' };
  mocks.choices.mockResolvedValue({ success: true, data: { programConfigured: true, members: [a], currencies: ['PLN'], payouts: [], commissions: [] } });
  render(<PayoutPanel locale="en" download={() => {}} />);
  const reserve = () => screen.getByRole('button', { name: 'Reserve for payout' }) as HTMLButtonElement;
  await waitFor(() => expect(reserve().disabled).toBe(false));
  const picker = screen.getByRole('combobox', { name: 'Partner' }); fireEvent.focus(picker);
  fireEvent.click(screen.getByRole('option', { name: 'Anna' }));
  await waitFor(() => expect(reserve().disabled).toBe(false));
});

it.each(['CHF', 'KRW'])('marks a %s payout paid and submits an exact adjustment', async currency => {
  const partner = { id: 'aaaaaaaa-0000-4000-a000-000000000001', display_name: 'Anna', code: 'anna', status: 'approved' };
  const payout = { id: 'aaaaaaaa-0000-4000-a000-000000000002', member_id: partner.id, currency, earnings_minor: '1234', version: '1', status: 'reserved', needs_review: false, payee_reference: 'Anna' };
  const commission = { id: 'aaaaaaaa-0000-4000-a000-000000000003', version: '1', currency, product_name: 'Course', paid_at: '2026-01-01T00:00:00Z' };
  mocks.choices.mockResolvedValue({ success: true, data: { programConfigured: true, members: [partner], currencies: [currency], payouts: [payout], commissions: [commission] } });
  mocks.paid.mockResolvedValue({ success: false }); mocks.adjust.mockResolvedValue({ success: false });
  render(<PayoutPanel locale="en" initialPayout={payout} download={() => {}} />);
  await screen.findByText('Anna · Current reservation');
  const amount = screen.getByLabelText(`Amount actually transferred (${currency})`) as HTMLInputElement;
  expect(amount.value).toBe(currency === 'KRW' ? '1234' : '12.34');
  fireEvent.change(screen.getByLabelText('Bank transfer reference'), { target: { value: 'bank-1' } });
  fireEvent.change(screen.getByLabelText('Invoice or approved document number'), { target: { value: 'invoice-1' } });
  fireEvent.click(screen.getByLabelText(/settles the entire/));
  fireEvent.submit(amount.closest('form')!);
  await waitFor(() => expect(mocks.paid).toHaveBeenCalledWith(expect.objectContaining({ currency, bank_amount_minor: '1234' })));
  const picker = screen.getByRole('combobox', { name: 'Product and purchase date' });
  fireEvent.focus(picker); fireEvent.keyDown(picker, { key: 'ArrowDown' }); fireEvent.keyDown(picker, { key: 'Enter' });
  const correction = screen.getByLabelText(`Correction amount (use − to reduce) (${currency})`);
  fireEvent.change(correction, { target: { value: currency === 'KRW' ? '-1234' : '-12,34' } });
  const form = correction.closest('form')!;
  fireEvent.change(form.querySelector('[name=reason]')!, { target: { value: 'Correction confirmed' } });
  fireEvent.change(form.querySelector('[name=evidence_reference]')!, { target: { value: 'record-1' } });
  fireEvent.submit(form);
  await waitFor(() => expect(mocks.adjust).toHaveBeenCalledWith(expect.objectContaining({ commission_id: commission.id, amount_minor: '-1234' })));

});

it.each(['en', 'pl'] as const)('%s: zero balance has no ready-to-pay heading', async locale => {
  const a = { id: 'aaaaaaaa-0000-4000-a000-000000000001', display_name: 'Anna', code: 'anna', status: 'approved' };
  mocks.choices.mockResolvedValue({ success: true, data: { programConfigured: true, members: [a], currencies: ['PLN'], payouts: [], commissions: [] } });
  mocks.preview.mockResolvedValue({ success: true, data: { payable_minor: '0', available: false } });
  render(<PayoutPanel locale={locale} download={() => {}} />);
  expect(await screen.findByText(locale === 'pl' ? 'Anna · Brak kwoty do wypłaty' : 'Anna · No amount available for payout')).toBeTruthy();
  expect(screen.queryByText(/Anna · (Ready to pay|Gotowe do wypłaty)/)).toBeNull();
});
