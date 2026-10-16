/** Portal accounting fixtures. @see src/lib/affiliates/portal/model.ts */
import { describe, expect, it } from 'vitest';
import { buildBalances, isSyncPending, portalQuerySchema } from '@/lib/affiliates/portal/model';
import type { CommissionFact, LedgerFact } from '@/lib/affiliates/portal/model';
const now = '2026-10-16T12:00:00Z';
const commission = (id: string, eligible_at: string | null = '2026-01-01T00:00:00Z'): CommissionFact => ({
  rule: { product: { name: 'Affiliate PLN Course' } }, id, currency: 'PLN', eligible_at, paid_at: now, accrued_minor: '2000', livemode: true,
  dispute_seen: false, dispute_reviewed_at: null, observed_status: 'completed', observed_refunded_gross: '0',
  payment: { status: 'completed', refunded_amount: '0', work: null },
});
const entry = (id: string, commission_id: string | null, kind: LedgerFact['kind'], amount_minor: string, allocations: LedgerFact['allocations'] = []): LedgerFact => ({ id, commission_id, kind, amount_minor, currency: 'PLN', allocations });
const allocated = (status: 'paid' | 'reserved') => [{ released_at: null, payout: { status } }];
describe('portal balances', () => {
  it('reconciles mature, unlimited, reserved, paid and subsequent refund debt', () => {
    const result = buildBalances([commission('a'), commission('b', null), commission('c'), commission('d')], [
      entry('1', 'a', 'accrual', '2000'), entry('2', 'b', 'accrual', '2000'), entry('3', 'b', 'reversal', '-500'),
      entry('4', 'c', 'accrual', '2000', allocated('reserved')), entry('5', 'd', 'accrual', '4000', allocated('paid')),
      entry('6', null, 'settlement', '-4000'), entry('7', 'd', 'reversal', '-3000'),
    ], now);
    expect(result).toEqual([{ currency: 'PLN', accrued: '10000', reversed: '3500', paid: '4000', reserved: '2000', held: '1500', eligible: '0', debt: '1000', balance: '2500' }]);
  });
  it('restorations reduce reversed totals; currencies and large integers stay exact', () => {
    const c = commission('a'); c.currency = 'EUR';
    const e = entry('1', 'a', 'accrual', '9007199254740993'); e.currency = 'EUR';
    expect(buildBalances([c], [e], now)[0]).toMatchObject({ currency: 'EUR', eligible: '9007199254740993' });
    expect(buildBalances([commission('b')], [entry('2', 'b', 'accrual', '2000'), entry('3', 'b', 'reversal', '-1000'), entry('4', 'b', 'restoration', '500')], now)[0]).toMatchObject({ reversed: '500', eligible: '1500' });
  });
  it('matures exactly at the boundary and holds disputed earnings until review', () => {
    const c = commission('a', now); c.dispute_seen = true;
    expect(buildBalances([c], [entry('1', 'a', 'accrual', '2000')], now)[0].held).toBe('2000');
    c.dispute_reviewed_at = now;
    expect(buildBalances([c], [entry('1', 'a', 'accrual', '2000')], now)[0].eligible).toBe('2000');
    c.eligible_at = '2026-10-16T12:00:00.001Z';
    expect(buildBalances([c], [entry('1', 'a', 'accrual', '2000')], now)[0].held).toBe('2000');
  });
  it('released allocations are available again and held funds do not pay due debt', () => {
    const rows = [entry('1', 'a', 'accrual', '2000', [{ released_at: now, payout: { status: 'cancelled' } }]), entry('2', 'b', 'accrual', '2000', allocated('paid')), entry('3', null, 'settlement', '-2000'), entry('4', 'b', 'reversal', '-1000')];
    expect(buildBalances([commission('a', null), commission('b', null)], rows, now)[0]).toMatchObject({ held: '2000', eligible: '0', debt: '1000', balance: '1000' });
  });
  it.each([{ limit: 101 }, { limit: 0 }, { cursor: 'not-a-uuid' }, { member_id: 'other' }, { currency: 'pln' }])('rejects invalid query %j', query => expect(portalQuerySchema.safeParse(query).success).toBe(false));
  it('defaults to 25 and permits at most 100 with strict currency/cursor', () => {
    expect(portalQuerySchema.parse({}).limit).toBe(25);
    expect(portalQuerySchema.parse({ limit: 100 }).limit).toBe(100);
  });
});

it('detects source differences and exact generation backlog', () => {
  const c = commission('a');
  expect(isSyncPending(c)).toBe(false);
  c.payment.work = { status: 'done', requested_generation: '9007199254740993', processed_generation: '9007199254740992' };
  expect(isSyncPending(c)).toBe(true);
  c.payment.work = null; c.payment.refunded_amount = '1'; expect(isSyncPending(c)).toBe(true);
  c.payment.refunded_amount = '0'; c.payment.status = 'disputed'; expect(isSyncPending(c)).toBe(true);
});
it('projects held, mature, reserved, paid and reversed commission states', async () => {
  const { getCommissionStatus } = await import('@/lib/affiliates/portal/model');
  const c = commission('a');
  const rows = [entry('1', 'a', 'accrual', '2000')];
  expect(getCommissionStatus(c, rows, now)).toBe('eligible');
  c.eligible_at = null; expect(getCommissionStatus(c, rows, now)).toBe('held');
  rows[0].allocations = allocated('reserved'); expect(getCommissionStatus(c, rows, now)).toBe('reserved');
  rows[0].allocations = allocated('paid'); expect(getCommissionStatus(c, rows, now)).toBe('paid');
  rows.push(entry('2', 'a', 'reversal', '-2000')); expect(getCommissionStatus(c, rows, now)).toBe('reversed');
});

it('keeps test earnings and test refunds outside real balances', () => {
  const live = commission('live'), simulated = { ...commission('test'), livemode: false };
  expect(buildBalances([live, simulated], [entry('1', 'live', 'accrual', '2000'), entry('2', 'test', 'accrual', '2000')], now)[0]).toMatchObject({ accrued: '2000', eligible: '2000' });
});
