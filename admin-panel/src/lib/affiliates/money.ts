/** Integer minor-unit arithmetic and frozen maturity policy. @see model.ts */
import { commissionInputSchema, maturityInputSchema } from '@/lib/affiliates/model';
import type { AffiliateResult } from '@/lib/affiliates/model';

/** Nonnegative rational half-up; callers supply a positive denominator. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}

/** Arithmetic on an already eligible paid line's canonical net snapshot. */
export function calculateCommission(input: unknown): AffiliateResult<string> {
  const parsed = commissionInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { base_minor, currency, rule } = parsed.data;
  const base = BigInt(base_minor);
  const amount = rule.percentage_bps != null
    ? roundHalfUp(base * BigInt(rule.percentage_bps), BigInt(10000))
    : rule.currency === currency ? BigInt(rule.fixed_minor) : BigInt(0);
  return { success: true, data: (amount > base ? base : amount).toString() };
}

export function calculateEligibleAt(input: unknown): AffiliateResult<string | null> {
  const parsed = maturityInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const policy = parsed.data;
  if (policy.is_refundable && policy.refund_period_days === null) return { success: true, data: null };
  const refundDays = policy.is_refundable && policy.refund_period_days !== null ? policy.refund_period_days + policy.buffer_days : 0;
  const days = Math.max(policy.hold_days, refundDays);
  const eligible = new Date(Date.parse(policy.paid_at) + days * 86400000);
  if (!Number.isFinite(eligible.getTime())) return { success: false, error: 'invalid_input' };
  return { success: true, data: eligible.toISOString() };
}
