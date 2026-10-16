/** Affiliate core contract fixtures. @see src/lib/affiliates/model.ts */
import { describe, expect, it } from 'vitest';

import { commissionRuleSchema, minorSchema, programSchema, signedMinorSchema } from '@/lib/affiliates/model';
import { calculateCommission, calculateEligibleAt } from '../../../affiliates/oracles/money';
import { reduceLoss } from '../../../affiliates/oracles/loss';

const percentage = { percentage_bps: 2000 };
const fixed = { fixed_minor: '2500', currency: 'PLN' };
const policy = { paid_at: '2026-10-16T12:00:00.000Z', hold_days: 30, buffer_days: 2, is_refundable: false, refund_period_days: null };
const loss = { gross_minor: '12300', base_minor: '10000', accrued_minor: '2000', refunded_gross_minor: '6150', status: 'completed', dispute_seen: false, entries: [{ kind: 'accrual', amount_minor: '2000' }] };
const ok = (data: unknown) => ({ success: true, data });

describe('affiliate DTOs', () => {
  it.each(['0', '1', '9007199254740993', '9223372036854775807'])('accepts exact minor string %s', value => {
    expect(minorSchema.safeParse(value).success).toBe(true);
  });
  it.each([1, 1.5, '', '01', '-0', '-1', '+1', '1.0', '1e2', ' 1', '1\n', '9223372036854775808'])('rejects noncanonical or out-of-range minor %s', value => {
    expect(minorSchema.safeParse(value).success).toBe(false);
  });
  it('accepts signed ledger amounts within bigint bounds', () => {
    expect(signedMinorSchema.safeParse('-9223372036854775808').success).toBe(true);
    expect(signedMinorSchema.safeParse('-9223372036854775809').success).toBe(false);
  });
  it.each([percentage, fixed, { percentage_bps: 0 }, { percentage_bps: 10000, fixed_minor: null, currency: null }, { fixed_minor: '0', currency: 'EUR', percentage_bps: null }])('accepts one rule variant %j', rule => {
    expect(commissionRuleSchema.safeParse(rule).success).toBe(true);
  });
  it.each([
    {}, { ...fixed, ...percentage }, { percentage_bps: -1 }, { percentage_bps: 10001 },
    { percentage_bps: 1.5 }, { ...percentage, currency: 'PLN' }, { fixed_minor: '1' },
    { ...fixed, currency: 'pln' }, { ...fixed, fixed_minor: '-1' },
    { ...percentage, hold_days: 1 }, { ...percentage, buyer_email: 'buyer@example.test' },
  ])('rejects invalid rule %j', rule => {
    expect(commissionRuleSchema.safeParse(rule).success).toBe(false);
  });
  it('validates strict EN/PL terms, thresholds, versions and day ranges', () => {
    const program = { version: '1', enabled: false, terms_version: 'v1', terms: { en: 'Terms', pl: 'Regulamin' }, thresholds: { PLN: '10000' } };
    expect(programSchema.parse(program)).toMatchObject({ hold_days: 30, buffer_days: 2 });
    for (const patch of [
      { version: '0' }, { version: 'no' }, { hold_days: 3651 }, { buffer_days: 366 }, { hold_days: -1 },
      { terms: { en: 'Terms' } }, { terms: { en: 'Terms', pl: 'PL', de: 'DE' } },
      { thresholds: { pln: '1' } }, { thresholds: { PLN: 100 } }, { unknown: true },
    ]) {
      expect(programSchema.safeParse({ ...program, ...patch }).success).toBe(false);
    }
    expect(programSchema.safeParse({ ...program, terms: { en: 'ą'.repeat(17000), pl: 'PL' } }).success).toBe(false);
  });
});

describe('affiliate money and maturity', () => {
  it.each([
    ['10000', 'PLN', percentage, '2000'], ['3', 'PLN', { percentage_bps: 5000 }, '2'],
    ['1000', 'PLN', fixed, '1000'], ['10000', 'EUR', fixed, '0'], ['0', 'PLN', fixed, '0'],
    ['9007199254740993', 'PLN', { percentage_bps: 10000 }, '9007199254740993'],
  ])('calculates commission on net %s', (base_minor, currency, rule, expected) => {
    expect(calculateCommission({ base_minor, currency, rule })).toEqual(ok(expected));
  });
  it('returns a result for invalid arithmetic input', () => {
    expect(calculateCommission({ base_minor: '1.1', currency: 'PLN', rule: percentage })).toEqual({ success: false, error: 'invalid_input' });
  });
  it('uses the program hold and finite refund window plus buffer', () => {
    expect(calculateEligibleAt(policy)).toEqual(ok('2026-11-15T12:00:00.000Z'));
    expect(calculateEligibleAt({ ...policy, is_refundable: true, refund_period_days: 60 })).toEqual(ok('2026-12-17T12:00:00.000Z'));
    expect(calculateEligibleAt({ ...policy, is_refundable: true, refund_period_days: 1 })).toEqual(ok('2026-11-15T12:00:00.000Z'));
    expect(calculateEligibleAt({ ...policy, hold_days: 0 })).toEqual(ok(policy.paid_at));
  });
  it('keeps unlimited refunds blocked and validates policy bounds', () => {
    expect(calculateEligibleAt({ ...policy, is_refundable: true })).toEqual(ok(null));
    for (const patch of [{ refund_period_days: 0 }, { refund_period_days: 366 }, { paid_at: 'invalid' }, { hold_days: 0.5 }, { buffer_days: -1 }]) {
      expect(calculateEligibleAt({ ...policy, ...patch }).success).toBe(false);
    }
  });
  it('preserves millisecond boundaries and normalizes offsets to UTC', () => {
    expect(calculateEligibleAt({ ...policy, paid_at: '2026-10-16T14:00:00.001+02:00' })).toEqual(ok('2026-11-15T12:00:00.001Z'));
    expect(calculateEligibleAt({ ...policy, paid_at: '2026-10-16T12:00:00Z' })).toEqual(ok('2026-11-15T12:00:00.000Z'));
    expect(calculateEligibleAt({ ...policy, paid_at: '2026-10-16T11:59:59.999Z' })).toEqual(ok('2026-11-15T11:59:59.999Z'));
  });
});

describe('affiliate cumulative loss', () => {
  it('converts gross refund to net before reversing commission', () => {
    expect(reduceLoss(loss)).toEqual(ok({ loss_net_minor: '5000', target_minor: '1000', delta_minor: '-1000', kind: 'reversal', dispute_seen: false }));
  });
  it('tracks cumulative refunds, duplicate syncs and decreasing refunds', () => {
    const entries = [...loss.entries];
    for (const [refund, delta, kind] of [['3075', '-500', 'reversal'], ['6150', '-500', 'reversal'], ['12300', '-1000', 'reversal'], ['12300', '0', null], ['6150', '1000', 'restoration']] as const) {
      const result = reduceLoss({ ...loss, refunded_gross_minor: refund, entries });
      expect(result).toMatchObject(ok({ delta_minor: delta, kind }));
      if (kind) entries.push({ kind, amount_minor: delta });
    }
  });
  it('latches disputes and leaves manual adjustments outside the automatic balance', () => {
    const disputed = reduceLoss({ ...loss, status: 'disputed' });
    expect(disputed).toMatchObject(ok({ target_minor: '0', delta_minor: '-2000', dispute_seen: true }));
    const entries = [...loss.entries, { kind: 'reversal', amount_minor: '-2000' }, { kind: 'manual_adjustment', amount_minor: '1500' }];
    expect(reduceLoss({ ...loss, entries, dispute_seen: true, refunded_gross_minor: '0' })).toMatchObject(ok({ target_minor: '0', delta_minor: '0', kind: null, dispute_seen: true }));
    expect(reduceLoss({ ...loss, entries: [...loss.entries, { kind: 'manual_adjustment', amount_minor: '500' }] })).toMatchObject(ok({ delta_minor: '-1000' }));
    expect(reduceLoss({ ...loss, status: 'disputed', refunded_gross_minor: '12300', entries })).toMatchObject(ok({ delta_minor: '0' }));
  });
  it.each([['-1', '0', '2000'], ['99999', '10000', '0']])('clamps refund %s', (refund, net, target) => {
    expect(reduceLoss({ ...loss, refunded_gross_minor: refund })).toMatchObject(ok({ loss_net_minor: net, target_minor: target }));
  });
  it('rounds each rational stage half-up and handles zero base', () => {
    expect(reduceLoss({ ...loss, gross_minor: '2', base_minor: '3', accrued_minor: '1', refunded_gross_minor: '1', entries: [{ kind: 'accrual', amount_minor: '1' }] })).toMatchObject(ok({ loss_net_minor: '2', target_minor: '0' }));
    expect(reduceLoss({ ...loss, base_minor: '0', accrued_minor: '0', entries: [] })).toMatchObject(ok({ target_minor: '0', delta_minor: '0' }));
    expect(reduceLoss({
      ...loss, gross_minor: '9223372036854775807', base_minor: '9223372036854775807',
      accrued_minor: '9223372036854775807', refunded_gross_minor: '4611686018427387904',
      entries: [{ kind: 'accrual', amount_minor: '9223372036854775807' }],
    })).toMatchObject(ok({ target_minor: '4611686018427387903', delta_minor: '-4611686018427387904' }));
  });
  it('returns invalid_input for inconsistent snapshots or automatic balances', () => {
    for (const patch of [
      { gross_minor: '0' }, { gross_minor: 'bad' }, { base_minor: '1' }, { base_minor: '1.5' }, { accrued_minor: 'no' },
      { entries: [{ kind: 'reversal', amount_minor: 'bad' }] },
      { entries: [{ kind: 'reversal', amount_minor: '1' }] },
      { entries: [{ kind: 'reversal', amount_minor: '-1' }] },
      { entries: [{ kind: 'accrual', amount_minor: '2001' }] },
      { entries: [{ kind: 'accrual', amount_minor: '0' }] },
    ]) {
      expect(reduceLoss({ ...loss, ...patch })).toEqual({ success: false, error: 'invalid_input' });
    }
  });
});
