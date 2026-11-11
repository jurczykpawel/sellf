'use server';

/** Session-admin product settings. @see supabase/migrations/20261110235900_release_2026_11_0_storefront.sql */
import { z } from 'zod';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { commissionRuleSchema, minorSchema } from '@/lib/affiliates/model';
import type { ActionResponse } from '@/lib/actions/admin-auth';

const uuid = z.uuid();
const ruleInput = z.strictObject({ product_id: uuid, expected_revision: z.number().int().min(0).max(2147483646), enabled: z.boolean(), rule: commissionRuleSchema });
const bindInput = z.strictObject({ coupon_id: uuid, member_id: uuid, expected_version: minorSchema });
const pageInput = z.strictObject({ coupon_id: uuid, cursor: uuid.nullable().default(null), search: z.string().trim().max(120).default('') });

export interface AffiliateProductInfo {
  product: { id: string; product_type: string; currency: string; is_refundable: boolean; refund_period_days: number | null };
  rule: { id: string; revision: number; enabled: boolean; percentage_bps: number | null; fixed_minor: string | null; currency: string | null } | null;
}
export interface AffiliateCouponInfo {
  binding: { member_id: string; version: string; display_name: string; code: string } | null;
  members: { id: string; code: string; display_name: string }[];
  next_cursor: string | null;
}
function failure(code?: string): ActionResponse<never> {
  const errorCode = code === 'PT409' || code === '23505' ? 'CONFLICT'
    : code === '22023' || code === '23503' || code === '23514' ? 'INVALID_INPUT'
    : code === '42501' ? 'FORBIDDEN' : 'INTERNAL_ERROR';
  return { success: false, error: errorCode, errorCode };
}
const invalid = (): ActionResponse<never> => failure('22023');

export async function createAffiliateRule(input: unknown): Promise<ActionResponse<{ id: string }>> {
  return withAdminClient(async ({ user, dataClient }) => {
    const parsed = ruleInput.safeParse(input);
    if (!parsed.success) return invalid();
    const { product_id, expected_revision, enabled, rule } = parsed.data;
    const { data, error } = await dataClient.rpc('affiliate_rule_create', {
      p_actor: user.id, p_product: product_id, p_expected_revision: expected_revision, p_enabled: enabled,
      p_percentage_bps: rule.percentage_bps ?? null, p_fixed_minor: rule.fixed_minor ?? null, p_currency: rule.currency ?? null,
    }).select('id').single();
    if (error || !data) return failure(error?.code);
    return { success: true, data: { id: data.id } };
  }, { mutating: true });
}

export async function bindAffiliateCoupon(input: unknown): Promise<ActionResponse<{ id: string }>> {
  return withAdminClient(async ({ user, dataClient }) => {
    const parsed = bindInput.safeParse(input);
    if (!parsed.success) return invalid();
    const { coupon_id, member_id, expected_version } = parsed.data;
    const { data, error } = await dataClient.rpc('affiliate_coupon_bind', {
      p_actor: user.id, p_coupon: coupon_id, p_member: member_id, p_expected_version: expected_version,
    }).select('id').single();
    if (error || !data) return failure(error?.code);
    return { success: true, data: { id: data.id } };
  }, { mutating: true });
}

export async function getAffiliateProduct(productId: string): Promise<ActionResponse<AffiliateProductInfo>> {
  return withAdminClient(async ({ dataClient }) => {
    if (!uuid.safeParse(productId).success) return invalid();
    const { data: product, error } = await dataClient.from('products')
      .select('id,product_type,currency,is_refundable,refund_period_days').eq('id', productId).maybeSingle();
    if (error) return failure(error.code);
    if (!product) return { success: false, error: 'NOT_FOUND', errorCode: 'NOT_FOUND' };
    const { data: rule, error: ruleError } = await dataClient.from('affiliate_rules')
      .select('id,revision,enabled,percentage_bps,fixed_minor::text,currency').eq('product_id', productId)
      .order('revision', { ascending: false }).limit(1).maybeSingle();
    if (ruleError) return failure(ruleError.code);
    return { success: true, data: { product, rule } };
  });
}

export async function getAffiliateCoupon(input: unknown): Promise<ActionResponse<AffiliateCouponInfo>> {
  return withAdminClient(async ({ dataClient }) => {
    const parsed = pageInput.safeParse(input);
    if (!parsed.success) return invalid();
    const { coupon_id, cursor, search } = parsed.data;
    const { data: binding, error } = await dataClient.from('affiliate_coupon_bindings')
      .select('member_id,version::text').eq('coupon_id', coupon_id).order('version', { ascending: false }).limit(1).maybeSingle();
    if (error) return failure(error.code);
    let owner = null;
    if (binding) {
      const result = await dataClient.from('affiliate_memberships').select('display_name,code').eq('id', binding.member_id).maybeSingle();
      if (result.error || !result.data) return failure(result.error?.code);
      owner = { ...binding, display_name: result.data.display_name, code: result.data.code };
    }
    let query = dataClient.from('affiliate_memberships').select('id,code,display_name')
      .eq('status', 'approved').not('user_id', 'is', null).order('id').limit(25);
    if (search) query = query.ilike('display_name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
    if (cursor) query = query.gt('id', cursor);
    const { data: members, error: memberError } = await query;
    if (memberError) return failure(memberError.code);
    return { success: true, data: { binding: owner, members: members ?? [], next_cursor: members?.length === 25 ? members[24].id : null } };
  });
}
