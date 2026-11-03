/** Partial refund amount entered by the seller in the refund dialog. @see src/lib/refunds/refund-amount.ts */
import { describe, expect, it } from 'vitest';
import { parseRefundAmountInput } from '@/lib/refunds/refund-amount';

describe('parseRefundAmountInput @J192', () => {
  it('empty input means a full refund of the remaining amount', () => {
    expect(parseRefundAmountInput('', 7000, 'PLN')).toEqual({ ok: true, amountMinor: 7000, partial: false });
  });
  it('accepts a comma decimal and converts to minor units', () => {
    expect(parseRefundAmountInput('25,50', 7000, 'PLN')).toEqual({ ok: true, amountMinor: 2550, partial: true });
  });
  it('treats the exact remaining amount as full', () => {
    expect(parseRefundAmountInput('70.00', 7000, 'PLN')).toEqual({ ok: true, amountMinor: 7000, partial: false });
  });
  it('rejects more than the remaining amount @J192', () => {
    expect(parseRefundAmountInput('70.01', 7000, 'PLN')).toEqual({ ok: false, error: 'exceedsRemaining' });
  });
  it('rejects zero, negatives, garbage and sub-minor precision', () => {
    expect(parseRefundAmountInput('0', 7000, 'PLN')).toEqual({ ok: false, error: 'invalid' });
    expect(parseRefundAmountInput('-5', 7000, 'PLN')).toEqual({ ok: false, error: 'invalid' });
    expect(parseRefundAmountInput('abc', 7000, 'PLN')).toEqual({ ok: false, error: 'invalid' });
    expect(parseRefundAmountInput('1.005', 7000, 'PLN')).toEqual({ ok: false, error: 'invalid' });
  });
  it('zero-decimal currency has no fractional part', () => {
    expect(parseRefundAmountInput('500', 1000, 'JPY')).toEqual({ ok: true, amountMinor: 500, partial: true });
    expect(parseRefundAmountInput('5.5', 1000, 'JPY')).toEqual({ ok: false, error: 'invalid' });
  });
});
