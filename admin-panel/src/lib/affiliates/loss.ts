/** Cumulative automatic loss target; manual entries remain independent. @see model.ts @see money.ts */
import { lossInputSchema } from '@/lib/affiliates/model';
import { roundHalfUp } from '@/lib/affiliates/money';
import type { AffiliateResult, LossResult } from '@/lib/affiliates/model';

export function reduceLoss(input: unknown): AffiliateResult<LossResult> {
  const parsed = lossInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const snapshot = parsed.data;
  const zero = BigInt(0);
  const gross = BigInt(snapshot.gross_minor);
  const base = BigInt(snapshot.base_minor);
  const accrued = BigInt(snapshot.accrued_minor);
  const recorded = BigInt(snapshot.refunded_gross_minor);
  const refund = recorded < zero ? zero : recorded > gross ? gross : recorded;
  const lossNet = roundHalfUp(base * refund, gross);
  const disputeSeen = snapshot.dispute_seen || snapshot.status === 'disputed';
  const target = disputeSeen || base === zero ? zero : accrued - roundHalfUp(accrued * lossNet, base);
  const automatic = snapshot.entries.reduce((sum, entry) =>
    ['accrual', 'reversal', 'restoration'].includes(entry.kind) ? sum + BigInt(entry.amount_minor) : sum, zero);
  if (automatic < zero || automatic > accrued) return { success: false, error: 'invalid_input' };
  const delta = target - automatic;
  return {
    success: true,
    data: {
      loss_net_minor: lossNet.toString(), target_minor: target.toString(), delta_minor: delta.toString(),
      kind: delta < zero ? 'reversal' : delta > zero ? 'restoration' : null,
      dispute_seen: disputeSeen,
    },
  };
}
