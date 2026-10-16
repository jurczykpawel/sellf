/** Session portal reads. Route shells apply portalMetadata and portalResponse headers. @see model.ts */
import 'server-only';
import { connection, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildBalances, pageCommissions, getCommissionStatus, isSyncPending, portalQuerySchema } from '@/lib/affiliates/portal/model';
import type { Metadata } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommissionFact, LedgerFact, PortalData, PortalResult } from '@/lib/affiliates/portal/model';

type Query = z.infer<typeof portalQuerySchema>;
export const portalMetadata: Metadata = { robots: { index: false, follow: false } };
export const portalHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Cookie' };
export function portalResponse(result: PortalResult): NextResponse {
  const status = result.success ? 200 : ({ unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 422, unavailable: 503 } as const)[result.error];
  return NextResponse.json(result, { status, headers: portalHeaders });
}

/** Each page and monetary projection stays bounded and exact. */
async function scan<T extends { id: string }>(client: SupabaseClient, table: string, select: string, member?: string): Promise<T[]> {
  const rows: T[] = []; let cursor: string | undefined;
  for (;;) {
    let query = client.from(table).select(select).order('id').limit(100);
    if (member) query = query.eq('member_id', member);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.returns<T[]>();
    if (error || !data) throw new Error('Read unavailable');
    rows.push(...data);
    if (data.length < 100) return rows;
    cursor = data[data.length - 1].id;
  }
}
const commissionSelect = 'rule:affiliate_rules!inner(product:products!inner(name)),id,currency,eligible_at,paid_at,accrued_minor::text,livemode,dispute_seen,dispute_reviewed_at,observed_status,observed_refunded_gross::text,payment:payment_transactions!inner(status,refunded_amount::text,work:affiliate_work(requested_generation::text,processed_generation::text,status))';
interface Binding { id: string; retired_at: string | null; coupon: { code: string; is_active: boolean; allowed_product_ids: string[] | null } }
interface Rule { id: string; product_id: string; revision: number; enabled: boolean; percentage_bps: number | null; fixed_minor: string | null; currency: string | null; product: { name: string; is_active: boolean; product_type: string } }
async function readData(client: SupabaseClient, member: { id: string; code: string; status: string }, query: Query, admin: boolean): Promise<PortalResult> {
  const as_of = new Date().toISOString();
  const [commissions, ledger, bindings, rules, payouts] = await Promise.all([
    scan<CommissionFact>(client, 'affiliate_commissions', commissionSelect, member.id),
    scan<LedgerFact>(client, 'affiliate_ledger', 'id,commission_id,currency,kind,amount_minor::text,allocations:affiliate_payout_allocations(released_at,payout:affiliate_payouts!inner(status))', member.id),
    scan<Binding>(client, 'affiliate_coupon_bindings', 'id,retired_at,coupon:coupons!inner(code,is_active,allowed_product_ids)', member.id),
    scan<Rule>(client, 'affiliate_rules', 'id,product_id,revision,enabled,percentage_bps,fixed_minor::text,currency,product:products!inner(name,is_active,product_type)'),
    scan<{ id: string; needs_review: boolean }>(client, 'affiliate_payouts', 'id,needs_review', member.id),
  ]);
  const current = new Map<string, bigint>();
  for (const e of ledger) if (e.commission_id) current.set(e.commission_id, (current.get(e.commission_id) ?? BigInt(0)) + BigInt(e.amount_minor));
  const remaining = pageCommissions(commissions, { ...query, limit: query.limit + 1 });
  const page = remaining.slice(0, query.limit);
  const latest = new Map<string, Rule>();
  for (const r of rules) if (!latest.has(r.product_id) || latest.get(r.product_id)!.revision < r.revision) latest.set(r.product_id, r);
  const activeBindings = bindings.filter(b => b.retired_at === null);
  const data: PortalData = {
    member: { code: member.code, status: member.status }, as_of,
    balances: buildBalances(commissions, ledger, as_of),
    commissions: page.map(c => ({ product: c.rule.product.name, status: getCommissionStatus(c, ledger.filter(e => e.commission_id === c.id), as_of), reference: c.id, currency: c.currency, paid_at: c.paid_at, eligible_at: c.eligible_at, accrued_minor: c.accrued_minor,
      current_minor: String(current.get(c.id) ?? BigInt(0)), livemode: c.livemode, sync_pending: isSyncPending(c),
      needs_review: c.payment.work?.status === 'needs_review' || c.dispute_seen && c.dispute_reviewed_at === null })),
    codes: activeBindings.map(b => ({ code: b.coupon.code, active: b.coupon.is_active })),
    rules: [...latest.values()].filter(r => r.product.is_active && r.product.product_type !== 'subscription' && activeBindings.some(b => b.coupon.is_active
      && (!b.coupon.allowed_product_ids?.length || b.coupon.allowed_product_ids.includes(r.product_id))))
      .map(r => ({ product: r.product.name, percentage_bps: r.percentage_bps, fixed_minor: r.fixed_minor, currency: r.currency, enabled: r.enabled })),
    next_cursor: remaining.length > query.limit ? page[page.length - 1].id : null,
    sync_pending: commissions.some(isSyncPending),
    needs_review: payouts.some(p => p.needs_review) || commissions.some(c => c.payment.work?.status === 'needs_review' || c.dispute_seen && c.dispute_reviewed_at === null),
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
