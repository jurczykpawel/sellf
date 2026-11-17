/**
 * Co-creator share: one person per one-time product earns a fixed share (percent or amount)
 * of every purchase made after the assignment, on top of any partner commission.
 * Callers authenticate first (panel session admin or API key) and pass the service-role client.
 *
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 * @see ./actions.ts (panel) @see src/app/api/v1/products/[id]/cocreator/route.ts (API v1)
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CocreatorInfo, CocreatorRate, CreatorTermsInfo } from '@/lib/affiliates/cocreator/model';

export type CocreatorError = 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT' | 'ACCOUNT_NOT_FOUND' | 'PROGRAM_REQUIRED' | 'FORBIDDEN' | 'INTERNAL_ERROR';
export type CocreatorResult<T> = { success: true; data: T } | { success: false; errorCode: CocreatorError };

const fail = (errorCode: CocreatorError): { success: false; errorCode: CocreatorError } => ({ success: false, errorCode });

/** Maps a database error to a stable code; the message is read only for the one 22023 that needs its own text. */
export function cocreatorFailure(error: { code?: string; message?: string } | null | undefined): { success: false; errorCode: CocreatorError } {
  const code = error?.code ?? '';
  if (code === 'P0002') return fail('ACCOUNT_NOT_FOUND');
  if (code === '22023' && error?.message?.includes('Program settings required')) return fail('PROGRAM_REQUIRED');
  if (code === 'PT409' || code === '23505' || code === '40001') return fail('CONFLICT');
  if (['22023', '23514', '23503', '22P02'].includes(code)) return fail('INVALID_INPUT');
  if (code === '42501') return fail('FORBIDDEN');
  return fail('INTERNAL_ERROR');
}

interface RuleRow {
  revision: number; member_id: string | null; percentage_bps: number | null; fixed_minor: string | null; currency: string | null; created_at: string;
}

export async function readProductCocreator(client: SupabaseClient, productId: string): Promise<CocreatorResult<CocreatorInfo & { product_type: string; product_currency: string }>> {
  const product = await client.from('products').select('id,product_type,currency').eq('id', productId).maybeSingle();
  if (product.error) return cocreatorFailure(product.error);
  if (!product.data) return fail('NOT_FOUND');
  const [rule, program] = await Promise.all([
    client.from('affiliate_cocreator_rules').select('revision,member_id,percentage_bps,fixed_minor::text,currency,created_at')
      .eq('product_id', productId).order('revision', { ascending: false }).limit(1).maybeSingle(),
    client.from('affiliate_programs').select('id').maybeSingle(),
  ]);
  if (rule.error || program.error) return cocreatorFailure(rule.error ?? program.error);
  const current = rule.data as RuleRow | null;
  let cocreator: CocreatorInfo['cocreator'] = null;
  if (current?.member_id) {
    const member = await client.from('affiliate_memberships').select('id,user_id,display_name,creator_accepted_at').eq('id', current.member_id).maybeSingle();
    if (member.error || !member.data) return cocreatorFailure(member.error);
    let email: string | null = null;
    if (member.data.user_id) {
      const contact = await client.from('user_access_stats').select('email').eq('user_id', member.data.user_id).maybeSingle();
      if (contact.error) return cocreatorFailure(contact.error);
      email = contact.data?.email ?? null;
    }
    cocreator = {
      member_id: member.data.id, display_name: member.data.display_name, email,
      percentage_bps: current.percentage_bps, fixed_minor: current.fixed_minor, currency: current.currency,
      since: current.created_at, terms_accepted: member.data.creator_accepted_at !== null,
    };
  }
  return { success: true, data: {
    product_id: product.data.id, product_type: product.data.product_type, product_currency: product.data.currency,
    revision: current?.revision ?? 0, program_configured: program.data !== null, cocreator,
  } };
}

export interface CocreatorWrite {
  product_id: string;
  /** Omitted only by API callers that accept last-writer-wins. */
  expected_revision?: number;
  /** `null` removes the co-creator from future purchases. */
  person: { email: string; display_name?: string; rule: CocreatorRate } | null;
}

export async function writeProductCocreator(client: SupabaseClient, actor: string, input: CocreatorWrite): Promise<CocreatorResult<{ revision: number }>> {
  let revision = input.expected_revision;
  if (revision === undefined) {
    const latest = await client.from('affiliate_cocreator_rules').select('revision').eq('product_id', input.product_id)
      .order('revision', { ascending: false }).limit(1).maybeSingle();
    if (latest.error) return cocreatorFailure(latest.error);
    revision = latest.data?.revision ?? 0;
  }
  const rule = input.person?.rule;
  const { data, error } = await client.rpc('affiliate_cocreator_set', {
    p_actor: actor, p_product: input.product_id, p_expected_revision: revision,
    p_email: input.person?.email ?? null, p_display_name: input.person?.display_name ?? null,
    p_percentage_bps: rule?.percentage_bps ?? null,
    // PostgREST accepts bigint decimal strings; generated RPC types use number.
    p_fixed_minor: (rule?.fixed_minor ?? null) as unknown as number | null, p_currency: rule?.currency ?? null,
  }).select('revision').single();
  if (error || !data) return cocreatorFailure(error);
  return { success: true, data: { revision: data.revision } };
}

export async function readCreatorTerms(client: SupabaseClient): Promise<CocreatorResult<CreatorTermsInfo | null>> {
  const { data, error } = await client.from('affiliate_creator_terms').select('terms_version,terms,created_at')
    .order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) return cocreatorFailure(error);
  return { success: true, data: data as CreatorTermsInfo | null };
}

export async function publishCreatorTermsWith(client: SupabaseClient, actor: string,
  input: { expected_version: string | null; terms_version: string; terms: { en: string; pl: string } }): Promise<CocreatorResult<CreatorTermsInfo>> {
  const { data, error } = await client.rpc('affiliate_creator_terms_publish', {
    p_actor: actor, p_expected_version: input.expected_version, p_terms_version: input.terms_version, p_terms: input.terms,
  }).select('terms_version,terms,created_at').single();
  if (error || !data) return cocreatorFailure(error);
  return { success: true, data: data as CreatorTermsInfo };
}
