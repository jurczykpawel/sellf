'use server';
/** Additional order context for the admin transaction dialog. */
import { z } from 'zod';
import { withAdminClient } from '@/lib/actions/admin-auth';
import type { ActionResponse } from '@/lib/actions/admin-auth';

export interface PaymentPartnerDetail {
  id: string; partner: string; coupon: string | null; currency: string;
  percentage_bps: number | null; fixed_minor: number | null;
  accrued_minor: number; current_minor: number; paid_minor: number;
  status: 'accrued' | 'held' | 'reversed' | 'paid';
}
interface CommissionRow {
  id: string; currency: string; accrued_minor: number; eligible_at: string | null;
  dispute_seen: boolean; dispute_reviewed_at: string | null;
  member: { display_name: string; code: string }; binding: { coupon: { code: string } };
  rule: { percentage_bps: number | null; fixed_minor: number | null }; payment: { status: string };
  ledger: { amount_minor: number; allocations: { released_at: string | null; payout: { status: string } }[] }[];
}
export async function getPaymentPartnerDetails(transactionId: string): Promise<ActionResponse<PaymentPartnerDetail[]>> {
  if (!z.uuid().safeParse(transactionId).success) return { success: false, error: 'Invalid transaction' };
  return withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient.from('affiliate_commissions').select(`
      id,currency,accrued_minor,eligible_at,dispute_seen,dispute_reviewed_at,
      member:affiliate_memberships(display_name,code),binding:affiliate_coupon_bindings(coupon:coupons(code)),
      rule:affiliate_rules(percentage_bps,fixed_minor),payment:payment_transactions(status),
      ledger:affiliate_ledger(amount_minor,allocations:affiliate_payout_allocations(released_at,payout:affiliate_payouts(status)))
    `).eq('payment_id', transactionId);
    if (error) return { success: false, error: 'Payment details unavailable' };
    const rows = data as unknown as CommissionRow[];
    return { success: true, data: rows.map(c => {
      let current = 0, paid = 0, reserved = false;
      for (const entry of c.ledger) {
        const amount = Number(entry.amount_minor);
        current += amount;
        for (const allocation of entry.allocations) {
          if (allocation.released_at) continue;
          if (allocation.payout.status === 'paid') paid += amount;
          if (allocation.payout.status === 'reserved') reserved = true;
        }
      }
      const eligible = c.eligible_at !== null && Date.parse(c.eligible_at) <= Date.now()
        && ((!c.dispute_seen && c.payment.status !== 'disputed') || c.dispute_reviewed_at !== null);
      return { id: c.id, partner: c.member.display_name || c.member.code, coupon: c.binding.coupon.code,
        currency: c.currency, percentage_bps: c.rule.percentage_bps, fixed_minor: c.rule.fixed_minor,
        accrued_minor: Number(c.accrued_minor), current_minor: current, paid_minor: paid,
        status: current <= 0 ? 'reversed' : reserved ? 'held' : paid >= current ? 'paid' : eligible ? 'accrued' : 'held' };
    }) };
  });
}

export interface PaymentEventDetail {
  quantity: number; status: string;
  session: { title: string | null; starts_at: string; ends_at: string | null; timezone: string; venue: string | null; online_url: string | null };
  tier: { label: string | null; price: number; sort: number };
}
export async function getPaymentEventDetails(transactionId: string): Promise<ActionResponse<PaymentEventDetail | null>> {
  if (!z.uuid().safeParse(transactionId).success) return { success: false, error: 'Invalid transaction' };
  return withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient.from('seat_reservations').select(`quantity,status,
      session:product_sessions(title,starts_at,ends_at,timezone,venue,online_url),
      tier:product_price_tiers(label,price,sort)`).eq('transaction_id', transactionId).maybeSingle();
    return error ? { success: false, error: 'Event details unavailable' } : { success: true, data: data as unknown as PaymentEventDetail | null };
  });
}
