import type { PayoutInfo } from '@/lib/affiliates/payouts/contracts';
const member = 'af000000-0000-4000-a000-000000000001';
let payout: PayoutInfo = { id: 'af000000-0000-4000-a000-000000000099', member_id: member, currency: 'PLN', earnings_minor: '125000', version: '1', status: 'reserved', needs_review: false, payee_reference: 'anna-nowak' };
export async function getPayoutChoices() { return { success: true, data: { members: [{ id: member, display_name: 'Anna Nowak', code: 'anna-nowak' }], currencies: ['PLN', 'EUR'], payouts: [payout], commissions: [{ id: member, version: '1', currency: 'PLN', paid_at: '2026-09-12T12:00:00Z', product_name: 'Automatyzacje w praktyce' }] } }; }
export async function previewPayout() { return { success: true, data: { member_version: '1', program_version: '1', earnings_minor: '0', debt_offset_minor: '0', payable_minor: '0', held_minor: '45000', threshold_minor: '10000', available: false, sync_required: false } }; }
export async function reservePayout() { return { success: true, data: payout }; }
export async function markPayoutPaid() { payout = { ...payout, version: '2', status: 'paid' }; return { success: true, data: payout }; }
export async function cancelPayout() { payout = { ...payout, version: '2', status: 'cancelled' }; return { success: true, data: payout }; }
export async function adjustCommission() { return { success: true, data: {} }; }
