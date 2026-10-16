/** Accounting oracle for SQL projection fixtures. */
import type { CurrencyBalance, CommissionStatus } from '@/lib/affiliates/portal/model';
export interface CommissionFact {
  rule: { product: { name: string } };
  id: string; currency: string; eligible_at: string | null; paid_at: string; accrued_minor: string; livemode: boolean;
  dispute_seen: boolean; dispute_reviewed_at: string | null; observed_status: string; observed_refunded_gross: string;
  payment: { status: string; refunded_amount: string | null; work: { requested_generation: string; processed_generation: string; status: string } | null };
}
export interface LedgerFact {
  id: string; commission_id: string | null; currency: string; kind: 'accrual' | 'reversal' | 'restoration' | 'manual_adjustment' | 'settlement'; amount_minor: string;
  allocations: { released_at: string | null; payout: { status: string } }[];
}
export function isSyncPending(c: CommissionFact): boolean {
  const w = c.payment.work;
  return c.observed_status !== c.payment.status || c.observed_refunded_gross !== (c.payment.refunded_amount ?? '0')
    || !!w && (w.status !== 'done' || BigInt(w.requested_generation) > BigInt(w.processed_generation));
}
export function buildBalances(commissions: CommissionFact[], entries: LedgerFact[], now: string): CurrencyBalance[] {
  commissions = commissions.filter(c => c.livemode);
  entries = entries.filter(e => e.commission_id === null || commissions.some(c => c.id === e.commission_id));
  const facts = new Map(commissions.map(c => [c.id, c]));
  const paid = new Set(entries.filter(e => e.allocations.some(a => a.released_at === null && a.payout.status === 'paid')).map(e => e.commission_id));
  const currencies = [...new Set(entries.map(e => e.currency))].sort();
  return currencies.map(currency => {
    let accrued = BigInt(0), reversed = BigInt(0), settled = BigInt(0), reserved = BigInt(0), available = BigInt(0), balance = BigInt(0);
    const heldByCommission = new Map<string, bigint>();
    for (const e of entries.filter(e => e.currency === currency)) {
      const amount = BigInt(e.amount_minor); balance += amount;
      if (e.kind === 'accrual') accrued += amount;
      if (e.kind === 'reversal' || e.kind === 'restoration') reversed -= amount;
      if (e.kind === 'settlement') { settled -= amount; continue; }
      const allocation = e.allocations.find(a => a.released_at === null);
      if (allocation) { if (allocation.payout.status === 'reserved') reserved += amount; continue; }
      const c = facts.get(e.commission_id!);
      if (!c) throw new Error('Missing commission');
      const mature = c.eligible_at !== null && Date.parse(c.eligible_at) <= Date.parse(now)
        && ((!c.dispute_seen && c.payment.status !== 'disputed') || c.dispute_reviewed_at !== null);
      if (mature || amount < BigInt(0) && paid.has(c.id)) available += amount;
      else heldByCommission.set(c.id, (heldByCommission.get(c.id) ?? BigInt(0)) + amount);
    }
    let held = BigInt(0);
    for (const amount of heldByCommission.values()) { if (amount > BigInt(0)) held += amount; else available += amount; }
    return { currency, accrued: String(accrued), reversed: String(reversed), paid: String(settled), reserved: String(reserved), held: String(held),
      eligible: String(available > BigInt(0) ? available : BigInt(0)), debt: String(available < BigInt(0) ? -available : BigInt(0)), balance: String(balance) };
  });
}

export function getCommissionStatus(c: CommissionFact, entries: LedgerFact[], now: string): CommissionStatus {
  const current = entries.reduce((sum, e) => sum + BigInt(e.amount_minor), BigInt(0));
  if (current <= BigInt(0)) return 'reversed';
  if (entries.some(e => e.allocations.some(a => a.released_at === null && a.payout.status === 'reserved'))) return 'reserved';
  const paid = entries.reduce((sum, e) => sum + (e.allocations.some(a => a.released_at === null && a.payout.status === 'paid') ? BigInt(e.amount_minor) : BigInt(0)), BigInt(0));
  if (paid >= current) return 'paid';
  return c.eligible_at !== null && Date.parse(c.eligible_at) <= Date.parse(now)
    && ((!c.dispute_seen && c.payment.status !== 'disputed') || c.dispute_reviewed_at !== null) ? 'eligible' : 'held';
}

/** Purchase-time ordering with a stable tie-breaker; cursors belong to this member. */
export function pageCommissions<T extends { id: string; paid_at: string; currency: string }>(facts: T[], query: { limit: number; cursor?: string; currency?: string }): T[] {
  const ordered = facts.filter(c => !query.currency || c.currency === query.currency)
    .sort((a, b) => Date.parse(b.paid_at) - Date.parse(a.paid_at) || b.id.localeCompare(a.id));
  const start = query.cursor ? ordered.findIndex(c => c.id === query.cursor) + 1 : 0;
  if (query.cursor && start === 0) return [];
  return ordered.slice(start, start + query.limit);
}
