/** Portal component fixtures. @see ui.test.tsx @see browser.test.tsx */
import type { PortalData } from '@/lib/affiliates/portal/model';
export const fixture: PortalData = {
  member: { code: 'demo-partner', status: 'approved' },
  balances: [{ currency: 'PLN', accrued: '4000', reversed: '500', paid: '1000', reserved: '0', held: '2000', eligible: '500', debt: '0', balance: '2500' }, { currency: 'EUR', accrued: '12000', reversed: '0', paid: '0', reserved: '0', held: '2000', eligible: '10000', debt: '0', balance: '12000' }],
  commissions: [{ product: 'Affiliate PLN Course', status: 'held', reference: 'af000000-0000-4000-a000-000000000001', currency: 'PLN', accrued_minor: '2000', current_minor: '1500', paid_at: '2026-01-02T00:00:00Z', eligible_at: null, livemode: false, sync_pending: true, needs_review: true },
    { reference: 'af000000-0000-4000-a000-000000000002', product: 'Affiliate EUR Toolkit', status: 'eligible', currency: 'EUR', accrued_minor: '10000', current_minor: '10000', paid_at: '2026-09-02T09:00:00Z', eligible_at: '2026-10-02T09:00:00Z', livemode: true, sync_pending: false, needs_review: false },
    { reference: 'af000000-0000-4000-a000-000000000003', product: 'Affiliate PLN Course', status: 'held', currency: 'PLN', accrued_minor: '2000', current_minor: '2000', paid_at: '2026-10-15T09:00:00Z', eligible_at: '2026-11-15T09:00:00Z', livemode: true, sync_pending: false, needs_review: false },
    { reference: 'af000000-0000-4000-a000-000000000004', product: 'Affiliate PLN Course', status: 'paid', currency: 'PLN', accrued_minor: '1000', current_minor: '1000', paid_at: '2026-08-01T09:00:00Z', eligible_at: '2026-09-01T09:00:00Z', livemode: true, sync_pending: false, needs_review: false },
    { reference: 'af000000-0000-4000-a000-000000000005', product: 'Affiliate EUR Toolkit', status: 'reversed', currency: 'EUR', accrued_minor: '2000', current_minor: '0', paid_at: '2026-07-01T09:00:00Z', eligible_at: null, livemode: true, sync_pending: false, needs_review: false }],
  codes: [{ code: 'PARTNER10', active: true }], rules: [{ product: 'Affiliate PLN Course', enabled: true, percentage_bps: 2000, fixed_minor: null, currency: null }],
  as_of: '2026-10-16T12:00:00Z', next_cursor: 'af000000-0000-4000-a000-000000000001', sync_pending: true, needs_review: true,
  lag: { pending: 2, needs_review: 1, retrying: 1, next_attempt_at: '2026-10-16T11:00:00Z', errors: { sync_failed: 1, session_unresolved: 0, awaiting_fulfillment: 0 } },
};
