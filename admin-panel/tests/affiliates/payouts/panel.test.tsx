// @vitest-environment happy-dom
/** Partner search selection. @see components/affiliates/payouts/PayoutPanel.tsx */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ choices: vi.fn(), preview: vi.fn() }));
vi.mock('@/lib/affiliates/payouts/reads', () => ({ getPayoutChoices: mocks.choices, previewPayout: mocks.preview }));
vi.mock('@/lib/affiliates/payouts/actions', () => ({ reservePayout: vi.fn(), markPayoutPaid: vi.fn(), cancelPayout: vi.fn(), adjustCommission: vi.fn() }));
import PayoutPanel from '@/components/affiliates/payouts/PayoutPanel';
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks();
  mocks.preview.mockResolvedValue({ success: true, data: { member_version: '1', program_version: '1', earnings_minor: '2000', debt_offset_minor: '0', payable_minor: '2000', held_minor: '0', threshold_minor: '1', available: true, sync_required: false } });
});
it('waits for explicit selection when a search returns a single partner and then loads the preview', async () => {
  const a = { id: 'aaaaaaaa-0000-4000-a000-000000000001', display_name: 'Anna', code: 'anna', status: 'approved' };
  const b = { ...a, id: 'bbbbbbbb-0000-4000-a000-000000000001', display_name: 'Beata' };
  mocks.choices.mockImplementation(async ({ search }: { search: string }) => ({ success: true, data: { members: search ? [a] : [a, b], currencies: ['PLN'], payouts: [], commissions: [] } }));
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
  mocks.choices.mockResolvedValue({ success: true, data: { members: [a], currencies: ['PLN'], payouts: [], commissions: [] } });
  render(<PayoutPanel locale="en" download={() => {}} />);
  const reserve = () => screen.getByRole('button', { name: 'Reserve for payout' }) as HTMLButtonElement;
  await waitFor(() => expect(reserve().disabled).toBe(false));
  const picker = screen.getByRole('combobox', { name: 'Partner' }); fireEvent.focus(picker);
  fireEvent.click(screen.getByRole('option', { name: 'Anna' }));
  await waitFor(() => expect(reserve().disabled).toBe(false));
});
