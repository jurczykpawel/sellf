'use server';

/** Session-only program/applications; all writes and audit are one T0 RPC. @see contracts.ts */
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { verifyCaptchaToken } from '@/lib/captcha/verify';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isDemoMode } from '@/lib/demo-guard';
import { applicationSchema, boundedInput, memberUpdateSchema, pageSchema, programUpdateSchema, workRetrySchema } from '@/lib/affiliates/admin/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { AdminOverview, AdminResult, ApplicationProgramInfo, MemberInfo, ProgramInfo, TermsInfo, SyncOverview, SyncWorkInfo } from '@/lib/affiliates/admin/contracts';

const programColumns = 'id,version::text,enabled,hold_days,buffer_days,terms_version,terms,thresholds';
const memberColumns = 'id,code,status,display_name,channel,accepted_terms_version,accepted_at,version::text,created_at';
const statusCodes: Record<string, number> = { UNAUTHORIZED: 401, FORBIDDEN: 403, DEMO_MODE: 403, CONFLICT: 409, TERMS_VERSION_CONFLICT: 409, INVALID_INPUT: 422, RATE_LIMITED: 429, NOT_FOUND: 404 };
function failure<T>(errorCode: string): AdminResult<T> {
  return { success: false, errorCode, error: 'Affiliate request failed', status: statusCodes[errorCode] ?? 500 };
}
function dbFailure<T>(code: string): AdminResult<T> {
  return failure(code === 'PT409' || code === '40001' || code === '23505' ? 'CONFLICT' : code === '42501' ? 'FORBIDDEN' : ['22023', '23514', '22P02'].includes(code) ? 'INVALID_INPUT' : 'INTERNAL_ERROR');
}
async function admin<T>(fn: (client: SupabaseClient, actor: string) => Promise<ActionResponse<T>>, mutating = false): Promise<AdminResult<T>> {
  noStore();
  const result = await withAdminClient(({ dataClient, user }) => fn(dataClient, user.id), { mutating });
  return { ...result, status: result.success ? 200 : statusCodes[result.errorCode ?? ''] ?? 500 };
}
function refresh(): void { revalidatePath('/[locale]/dashboard/affiliates', 'page'); revalidatePath('/[locale]/affiliates/apply', 'page'); }

export async function getAdminOverview(input: unknown = {}): Promise<AdminResult<AdminOverview>> {
  return admin(async client => {
    const parsed = pageSchema.safeParse(input);
    if (!parsed.success || !boundedInput(input)) return failure('INVALID_INPUT');
    const { cursor, limit, status } = parsed.data;
    let query = client.from('affiliate_memberships').select(memberColumns).order('id', { ascending: false }).limit(limit);
    if (cursor) query = query.lt('id', cursor);
    if (status) query = query.eq('status', status);
    const [program, members] = await Promise.all([client.from('affiliate_programs').select(programColumns).maybeSingle(), query]);
    if (program.error || members.error) return dbFailure((program.error ?? members.error)!.code);
    const rows = members.data as unknown as MemberInfo[];
    return { success: true, data: { program: program.data as unknown as ProgramInfo | null, members: rows, next_cursor: rows.length === limit ? rows.at(-1)!.id : null } };
  });
}
export async function updateProgram(input: unknown): Promise<AdminResult<ProgramInfo>> {
  return admin(async (client, actor) => {
    const parsed = programUpdateSchema.safeParse(input);
    if (!parsed.success || !boundedInput(input)) return failure('INVALID_INPUT');
    const p = parsed.data;
    // A published label identifies one wording, so stale application forms cannot accept a different text.
    const history = await client.from('affiliate_program_versions').select('terms_version,terms')
      .eq('terms_version', p.terms_version).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (history.error) return dbFailure(history.error.code);
    const published = history.data as ProgramInfo | undefined;
    if (published && (published.terms.en !== p.terms.en || published.terms.pl !== p.terms.pl)) return failure('TERMS_VERSION_CONFLICT');
    const { data, error } = await client.rpc('affiliate_program_update', {
      p_actor: actor, p_expected_version: p.version, p_enabled: p.enabled, p_terms_version: p.terms_version,
      p_terms: p.terms, p_hold_days: p.hold_days, p_buffer_days: p.buffer_days, p_thresholds: p.thresholds,
    }).select(programColumns).single();
    if (error) return dbFailure(error.code);
    refresh(); return { success: true, data: data as unknown as ProgramInfo };
  }, true);
}
export async function updateMember(input: unknown): Promise<AdminResult<MemberInfo>> {
  return admin(async (client, actor) => {
    const parsed = memberUpdateSchema.safeParse(input);
    if (!parsed.success || !boundedInput(input)) return failure('INVALID_INPUT');
    const p = parsed.data;
    const { data, error } = await client.rpc('affiliate_member_update', { p_actor: actor, p_member: p.member_id, p_expected_version: p.version, p_status: p.status, p_reason: p.reason }).select(memberColumns).single();
    if (error) return dbFailure(error.code);
    refresh(); return { success: true, data: data as unknown as MemberInfo };
  }, true);
}
export async function getAcceptedTerms(memberId: string): Promise<AdminResult<TermsInfo>> {
  return admin(async client => {
    if (!memberUpdateSchema.shape.member_id.safeParse(memberId).success) return failure('INVALID_INPUT');
    const { data: member, error } = await client.from('affiliate_memberships').select('accepted_terms_version,accepted_at').eq('id', memberId).maybeSingle();
    if (error) return dbFailure(error.code);
    if (!member) return failure('NOT_FOUND');
    // Resolve by acceptance timestamp as well as label: a label alone does not identify edited terms.
    const history = await client.from('affiliate_program_versions').select('terms_version,terms')
      .lte('created_at', member.accepted_at).order('created_at', { ascending: false }).order('version', { ascending: false }).limit(1).maybeSingle();
    if (history.error) return dbFailure(history.error.code);
    const snapshot = history.data as ProgramInfo | undefined;
    if (!snapshot || snapshot.terms_version !== member.accepted_terms_version) return failure('NOT_FOUND');
    return { success: true, data: { terms_version: snapshot.terms_version, terms: snapshot.terms } };
  });
}
async function verifiedSession() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { result: failure<never>('UNAUTHORIZED') };
  if (!user.email_confirmed_at || !user.email) return { result: failure<never>('FORBIDDEN') };
  return { user };
}
export async function getApplicationProgram(): Promise<AdminResult<ApplicationProgramInfo | null>> {
  noStore();
  try {
    const session = await verifiedSession(); if (session.result) return session.result;
    const { data, error } = await createAdminClient().from('affiliate_programs').select('enabled,terms_version,terms').maybeSingle();
    return error ? dbFailure(error.code) : { success: true, status: 200, data: data as ApplicationProgramInfo | null };
  } catch { return failure('INTERNAL_ERROR'); }
}
export async function applyToProgram(input: unknown): Promise<AdminResult<MemberInfo>> {
  noStore();
  try {
    if (isDemoMode()) return failure('DEMO_MODE');
    const session = await verifiedSession(); if (session.result) return session.result;
    const parsed = applicationSchema.safeParse(input);
    if (!parsed.success || !boundedInput(input)) return failure('INVALID_INPUT');
    const user = session.user;
    if (!await checkRateLimit('affiliate_apply_ip', 5, 15)
      || !await checkRateLimitForIdentifier('affiliate_apply_email', 5, 1440, `email:${user.email!.trim().toLowerCase()}`)) return failure('RATE_LIMITED');
    if (!(await verifyCaptchaToken(parsed.data.captcha_token)).success) return failure('INVALID_INPUT');
    const p = parsed.data;
    const { data, error } = await createAdminClient().rpc('affiliate_apply', { p_user: user.id, p_code: p.code, p_display_name: p.display_name, p_channel: p.channel, p_terms_version: p.terms_version }).select(memberColumns).single();
    if (error) return dbFailure(error.code);
    refresh(); return { success: true, status: 200, data: data as unknown as MemberInfo };
  } catch { return failure('INTERNAL_ERROR'); }
}

export async function getAffiliateSyncOverview(input: unknown = {}): Promise<AdminResult<SyncOverview>> {
  return admin(async client => {
    const parsed = pageSchema.omit({ status: true }).safeParse(input);
    if (!parsed.success || !boundedInput(input)) return failure('INVALID_INPUT');
    const { cursor, limit } = parsed.data;
    let query = client.from('affiliate_work').select('payment_id,requested_generation::text,attempts,last_error_code,payment:payment_transactions(created_at,product:products(name))')
      .eq('status', 'needs_review').order('payment_id').limit(limit);
    if (cursor) query = query.gt('payment_id', cursor);
    const [failed, oldest] = await Promise.all([query,
      client.from('affiliate_work').select('next_attempt_at')
        .eq('status', 'pending').order('next_attempt_at').limit(1),
    ]);
    if (failed.error || oldest.error) return dbFailure((failed.error ?? oldest.error)!.code);
    const work = failed.data as unknown as SyncWorkInfo[];
    return { success: true, data: { work, next_cursor: work.length === limit ? work.at(-1)!.payment_id : null, oldest_pending_at: oldest.data?.[0]?.next_attempt_at ?? null } };
  });
}
export async function retryAffiliateWork(input: unknown): Promise<AdminResult<undefined>> {
  return admin(async (client, actor) => {
    const parsed = workRetrySchema.safeParse(input);
    if (!parsed.success || !boundedInput(input)) return failure('INVALID_INPUT');
    const p = parsed.data;
    const { error } = await client.rpc('affiliate_work_retry', { p_actor: actor, p_payment: p.payment_id, p_generation: p.generation, p_reason: p.reason });
    if (error) return dbFailure(error.code);
    refresh(); return { success: true };
  }, true);
}
