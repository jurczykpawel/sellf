'use server';
/** Session admin preview. @see query.ts */
import { z } from 'zod';
import { AFFILIATE_PROGRAM_DEFAULTS } from '@/lib/affiliates/program-defaults';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { previewSchema, payoutProjection } from '@/lib/affiliates/payouts/contracts';
import { readPreview } from '@/lib/affiliates/payouts/query';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { MemberChoice, PayoutInfo, PreviewInfo, PayoutChoices } from '@/lib/affiliates/payouts/contracts';
export async function previewPayout(input: unknown): Promise<ActionResponse<PreviewInfo>> {
  return withAdminClient(async ({ dataClient }) => {
    const parsed = previewSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'invalid_input', errorCode: '422' };
    const data = await readPreview(dataClient, parsed.data.member_id, parsed.data.currency, parsed.data.cutoff);
    return data ? { success: true, data } : { success: false, error: 'unavailable', errorCode: '422' };
  });
}

const choicesSchema = z.strictObject({ search: z.string().max(120).default(''), commission_search: z.string().max(120).default(''), member_id: z.uuid().optional() });
export async function getPayoutChoices(input: unknown): Promise<ActionResponse<PayoutChoices>> {
  return withAdminClient(async ({ dataClient }) => {
    const parsed = choicesSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'invalid_input', errorCode: '422' };
    const { search, member_id, commission_search } = parsed.data;
    const [members, program, payouts, commissions, selectedMember] = await Promise.all([
      dataClient.from('affiliate_memberships').select('id,display_name,code,status').ilike('display_name', `%${search.replace(/[\\%_]/g, '\\$&')}%`).order('display_name').limit(100),
      dataClient.from('affiliate_programs').select('thresholds').maybeSingle(),
      member_id ? dataClient.from('affiliate_payouts').select(payoutProjection).eq('member_id', member_id).order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      member_id ? dataClient.from('affiliate_commissions').select('id,version::text,currency,paid_at,rule:affiliate_rules!inner(product:products!inner(name))').eq('member_id', member_id).ilike('rule.product.name', `%${commission_search.replace(/[\\%_]/g, '\\$&')}%`).order('paid_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      member_id ? dataClient.from('affiliate_memberships').select('id,display_name,code,status').eq('id', member_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (members.error || program.error || payouts.error || commissions.error || selectedMember.error) return { success: false, error: 'unavailable', errorCode: '422' };
    const rows = commissions.data as unknown as { id: string; version: string; currency: string; paid_at: string; rule: { product: { name: string } } }[];
    return { success: true, data: { programConfigured: program.data !== null, members: selectedMember.data && !members.data.some(m => m.id === member_id) ? [...members.data.slice(0, 99), selectedMember.data as MemberChoice] : members.data, currencies: Object.keys(program.data?.thresholds ?? AFFILIATE_PROGRAM_DEFAULTS.thresholds), payouts: payouts.data as unknown as PayoutInfo[], commissions: rows.map(c => ({ id: c.id, version: c.version, currency: c.currency, paid_at: c.paid_at, product_name: c.rule.product.name })) } };
  });
}
