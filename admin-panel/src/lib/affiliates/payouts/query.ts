import 'server-only';
/** Private payout projections; reservation always rechecks the database. @see contracts.ts */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreviewInfo } from '@/lib/affiliates/payouts/contracts';

interface Commission { id: string; eligible_at: string | null; dispute_seen: boolean; dispute_reviewed_at: string | null; observed_status: string; observed_refunded_gross: string; payment: { status: string; refunded_amount: string | null; work: { requested_generation: string; processed_generation: string; status: string } | null } }
interface Entry { id: string; commission_id: string | null; amount_minor: string; kind: string; created_at: string; allocations: { released_at: string | null; payout: { status: string } }[] }
export async function readPreview(client: SupabaseClient, member: string, currency: string, cutoff: string): Promise<PreviewInfo | null> {
  const [m, p] = await Promise.all([
    client.from('affiliate_memberships').select('version::text,status,user_id').eq('id', member).single(),
    client.from('affiliate_programs').select('version::text,enabled,thresholds').single(),
  ]);
  if (m.error || p.error) return null;
  const commissions = new Map<string, Commission>();
  let syncRequired = false;
  let cursor = '';
  while (true) {
    let query = client.from('affiliate_commissions').select('id,eligible_at,dispute_seen,dispute_reviewed_at,observed_status,observed_refunded_gross::text,payment:payment_transactions!inner(status,refunded_amount::text,work:affiliate_work(requested_generation::text,processed_generation::text,status))').eq('member_id', member).eq('currency', currency).order('id').limit(100);
    if (cursor) query = query.gt('id', cursor);
    const result = await query;
    if (result.error) return null;
    const rows = result.data as unknown as Commission[];
    for (const c of rows) {
      commissions.set(c.id, c);
      const w = c.payment.work;
      syncRequired ||= c.observed_status !== c.payment.status || c.observed_refunded_gross !== (c.payment.refunded_amount ?? '0') || !!w && (w.status !== 'done' || w.requested_generation !== w.processed_generation);
    }
    if (rows.length < 100) break;
    cursor = rows[rows.length - 1].id;
  }
  let failed = false;
  async function* entries(): AsyncGenerator<Entry> {
    let after = '';
    while (true) {
      let query = client.from('affiliate_ledger').select('id,commission_id,amount_minor::text,kind,created_at,allocations:affiliate_payout_allocations(released_at,payout:affiliate_payouts!inner(status))').eq('member_id', member).eq('currency', currency).order('id').limit(100);
      if (after) query = query.gt('id', after);
      const result = await query;
      if (result.error) { failed = true; return; }
      const rows = result.data as unknown as Entry[];
      yield* rows;
      if (rows.length < 100) break;
      after = rows[rows.length - 1].id;
    }
  }
  let earnings = BigInt(0), debt = BigInt(0), held = BigInt(0);
  const paid = new Set<string>();
  const earned = new Set<string>();
  for await (const e of entries()) {
    if (e.commission_id && e.kind === 'accrual' && Date.parse(e.created_at) <= Date.parse(cutoff)) earned.add(e.commission_id);
    if (e.commission_id && e.allocations.some(a => !a.released_at && a.payout.status === 'paid')) paid.add(e.commission_id);
  }
  for await (const e of entries()) {
    if (!e.commission_id || e.allocations.some(a => !a.released_at)) continue;
    const c = commissions.get(e.commission_id);
    if (!c) continue;
    const amount = BigInt(e.amount_minor);
    const mature = earned.has(c.id) && c.eligible_at !== null && Date.parse(c.eligible_at) <= Date.parse(cutoff) && ((!c.dispute_seen && c.payment.status !== 'disputed') || c.dispute_reviewed_at !== null);
    if (mature || (amount < BigInt(0) && paid.has(c.id))) {
      if (amount > BigInt(0)) earnings += amount; else debt -= amount;
    } else held += amount;
  }
  if (failed) return null;
  const threshold = p.data.thresholds[currency] as string | undefined;
  const payable = earnings - debt;
  const open = await client.from('affiliate_payouts').select('id').eq('member_id', member).eq('currency', currency).eq('status', 'reserved').limit(1);
  if (open.error) return null;
  return { member_version: m.data.version, program_version: p.data.version, earnings_minor: earnings.toString(), debt_offset_minor: debt.toString(), payable_minor: payable.toString(), held_minor: held.toString(), threshold_minor: threshold ?? null, sync_required: syncRequired,
    available: !!m.data.user_id && m.data.status === 'approved' && p.data.enabled && !syncRequired && !open.data.length && threshold !== undefined && payable > BigInt(0) && payable >= BigInt(threshold) };
}
