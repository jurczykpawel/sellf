'use server';
/** Session admin payout commands; monetary decisions remain in T0 RPCs. @see contracts.ts */
import { revalidatePath } from 'next/cache';
import { getAffiliateLivemode } from '@/lib/stripe/affiliate-mode';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { reserveSchema, paidSchema, cancelSchema, adjustmentSchema, payoutProjection } from '@/lib/affiliates/payouts/contracts';
import type { z } from 'zod';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { AdjustmentInfo, PayoutInfo } from '@/lib/affiliates/payouts/contracts';

async function command<T = PayoutInfo>(schema: z.ZodType, input: unknown, rpc: string, fields: Record<string, string>, projection = payoutProjection): Promise<ActionResponse<T>> {
  return withAdminClient(async ({ user, dataClient }) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success || JSON.stringify(input).length > 32768) return { success: false, error: 'invalid_input', errorCode: '422' };
    const values = parsed.data as Record<string, unknown>;
    const args: Record<string, unknown> = { p_actor: user.id };
    for (const [key, value] of Object.entries(values)) args[fields[key] ?? `p_${key}`] = value;
    if (rpc === 'affiliate_reserve' || rpc === 'affiliate_mark_paid') args.p_livemode = await getAffiliateLivemode();
    const { data, error } = await dataClient.rpc(rpc, args).select(projection).single();
    if (error) {
      const conflict = ['PT409', '23505'].includes(error.code);
      return { success: false, error: conflict ? 'conflict' : 'unavailable', errorCode: conflict ? '409' : '422' };
    }
    revalidatePath('/[locale]/dashboard/affiliates', 'layout');
    revalidatePath('/[locale]/my-affiliate', 'page');
    return { success: true, data: data as unknown as T };
  }, { mutating: true });
}
export async function reservePayout(input: unknown): Promise<ActionResponse<PayoutInfo>> {
  return command(reserveSchema, input, 'affiliate_reserve', { member_id: 'p_member' });
}
export async function markPayoutPaid(input: unknown): Promise<ActionResponse<PayoutInfo>> {
  return command(paidSchema, input, 'affiliate_mark_paid', { payout_id: 'p_payout', version: 'p_expected_version' });
}
export async function cancelPayout(input: unknown): Promise<ActionResponse<PayoutInfo>> {
  return command(cancelSchema, input, 'affiliate_cancel_payout', { payout_id: 'p_payout', version: 'p_expected_version' });
}
export async function adjustCommission(input: unknown): Promise<ActionResponse<AdjustmentInfo>> {
  return command<AdjustmentInfo>(adjustmentSchema, input, 'affiliate_manual_adjustment', { commission_id: 'p_commission', version: 'p_expected_version' }, 'id,member_id,currency,amount_minor::text');
}
