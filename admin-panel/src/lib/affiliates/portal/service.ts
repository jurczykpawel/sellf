/** Session portal reads. Route shells apply portalMetadata and portalResponse headers. @see model.ts */
import 'server-only';
import { connection, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { portalQuerySchema } from '@/lib/affiliates/portal/model';
import type { Metadata } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortalData, PortalResult } from '@/lib/affiliates/portal/model';

type Query = z.infer<typeof portalQuerySchema>;
export const portalMetadata: Metadata = { robots: { index: false, follow: false } };
export const portalHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Cookie' };
export function portalResponse(result: PortalResult): NextResponse {
  const status = result.success ? 200 : ({ unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 422, unavailable: 503 } as const)[result.error];
  return NextResponse.json(result, { status, headers: portalHeaders });
}

async function readData(client: SupabaseClient, member: { id: string; code: string; status: string }, query: Query, admin: boolean): Promise<PortalResult> {
  const as_of = new Date().toISOString();
  const [summary, page] = await Promise.all([
    client.rpc('affiliate_portal_summary', { p_member: member.id, p_as_of: as_of }),
    client.rpc('affiliate_portal_page', { p_member: member.id, p_currency: query.currency ?? null,
      p_cursor: query.cursor ?? null, p_limit: query.limit, p_as_of: as_of }),
  ]);
  if (summary.error || page.error || !summary.data || !page.data) throw new Error('Read unavailable');
  const data: PortalData = {
    member: { code: member.code, status: member.status }, as_of,
    ...summary.data as Pick<PortalData, 'balances' | 'codes' | 'rules' | 'sync_pending' | 'needs_review'>,
    ...page.data as Pick<PortalData, 'commissions' | 'next_cursor'>,
  };
  if (admin) {
    const results = await Promise.all([
      client.from('affiliate_work').select('payment_id', { count: 'exact', head: true }).neq('status', 'done'),
      client.from('affiliate_work').select('payment_id', { count: 'exact', head: true }).eq('status', 'needs_review'),
      client.from('affiliate_work').select('payment_id', { count: 'exact', head: true }).neq('status', 'done').gt('attempts', 0),
      client.from('affiliate_work').select('next_attempt_at').in('status', ['pending', 'leased']).order('next_attempt_at').limit(1),
      ...['sync_failed', 'session_unresolved', 'awaiting_fulfillment'].map(code => client.from('affiliate_work').select('payment_id', { count: 'exact', head: true }).neq('status', 'done').eq('last_error_code', code)),
    ]);
    if (results.some(r => r.error)) throw new Error('Read unavailable');
    data.sync_pending ||= (results[0].count ?? 0) > 0;
    data.needs_review ||= (results[1].count ?? 0) > 0;
    data.lag = { pending: results[0].count ?? 0, needs_review: results[1].count ?? 0, retrying: results[2].count ?? 0, next_attempt_at: results[3].data?.[0]?.next_attempt_at ?? null,
      errors: { sync_failed: results[4].count ?? 0, session_unresolved: results[5].count ?? 0, awaiting_fulfillment: results[6].count ?? 0 } };
  }
  return { success: true, data };
}
export async function readPartnerPortal(input: unknown = {}): Promise<PortalResult> {
  const parsed = portalQuerySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  await connection();
  try {
    const session = await createClient();
    const { data: { user }, error } = await session.auth.getUser();
    if (error || !user) return { success: false, error: 'unauthorized' };
    const client = createAdminClient();
    const member = await client.from('affiliate_memberships').select('id,code,status').eq('user_id', user.id).maybeSingle();
    if (member.error) return { success: false, error: 'unavailable' };
    if (!member.data) return { success: false, error: 'not_found' };
    return await readData(client, member.data, parsed.data, false);
  } catch { return { success: false, error: 'unavailable' }; }
}
export async function readAdminPortal(memberId: unknown, input: unknown = {}): Promise<PortalResult> {
  const id = z.uuid().safeParse(memberId); const parsed = portalQuerySchema.safeParse(input);
  if (!id.success || !parsed.success) return { success: false, error: 'invalid_input' };
  await connection();
  try { const session = await createClient(); await requireAdminApi(session); } catch { return { success: false, error: 'forbidden' }; }
  try {
    const client = createAdminClient();
    const member = await client.from('affiliate_memberships').select('id,code,status').eq('id', id.data).maybeSingle();
    if (member.error) return { success: false, error: 'unavailable' };
    if (!member.data) return { success: false, error: 'not_found' };
    return await readData(client, member.data, parsed.data, true);
  } catch { return { success: false, error: 'unavailable' }; }
}
