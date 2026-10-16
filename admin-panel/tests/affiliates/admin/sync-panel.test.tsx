// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({ getAffiliateSyncOverview: vi.fn(), retryAffiliateWork: vi.fn() }));
vi.mock('@/lib/affiliates/admin/actions', () => actions);
import SyncWorkPanel from '@/components/affiliates/admin/SyncWorkPanel';
import { affiliateAdminMessages } from '@/components/affiliates/admin/messages';
const work = { payment_id: 'aaaaaaaa-0000-4000-a000-000000000001', requested_generation: '9007199254740993', attempts: 10, last_error_code: 'net_unavailable' };
beforeEach(() => {
  vi.clearAllMocks();
  actions.getAffiliateSyncOverview.mockResolvedValue({ success: true, data: { work: [work], next_cursor: work.payment_id, oldest_pending_at: new Date(Date.now() - 16 * 60_000).toISOString() } });
  actions.retryAffiliateWork.mockResolvedValue({ success: true });
});
afterEach(cleanup);
it.each(['en', 'pl'] as const)('offers localized recovery and lag warning in %s', async locale => {
  const t = affiliateAdminMessages[locale]; render(<SyncWorkPanel locale={locale} />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', t.syncLag);
  expect(screen.getByText(t.syncNet)).toBeTruthy();
  expect(screen.getByText(work.payment_id, { exact: false }).closest('details')?.open).toBe(false);
  fireEvent.submit(screen.getByLabelText(t.syncReason).closest('form')!);
  expect(actions.retryAffiliateWork).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t.syncReason), { target: { value: 'Net snapshot restored' } });
  fireEvent.click(screen.getByRole('button', { name: t.syncRetry }));
  await waitFor(() => expect(actions.retryAffiliateWork).toHaveBeenCalledWith({ payment_id: work.payment_id, generation: work.requested_generation, reason: 'Net snapshot restored' }));
  expect(await screen.findByText(t.syncRetrySuccess)).toBeTruthy();
  await waitFor(() => expect(actions.getAffiliateSyncOverview).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: t.next }));
  await waitFor(() => expect(actions.getAffiliateSyncOverview).toHaveBeenLastCalledWith({ cursor: work.payment_id }));
});
it('keeps fresh pending orders quiet and reports a changed generation', async () => {
  actions.getAffiliateSyncOverview.mockResolvedValue({ success: true, data: { work: [work], next_cursor: null, oldest_pending_at: new Date().toISOString() } });
  actions.retryAffiliateWork.mockResolvedValue({ success: false, status: 409 });
  const t = affiliateAdminMessages.en; render(<SyncWorkPanel locale="en" />);
  const reason = await screen.findByLabelText(t.syncReason);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.change(reason, { target: { value: 'Repaired' } }); fireEvent.click(screen.getByRole('button', { name: t.syncRetry }));
  expect(await screen.findByText(t.conflict)).toBeTruthy();
});
