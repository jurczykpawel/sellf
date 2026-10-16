/** Pure affiliate DTO contracts. @see money.ts @see loss.ts */
import { z } from 'zod';

const maxMinor = BigInt('9223372036854775807');
const minMinor = BigInt('-9223372036854775808');
const zero = BigInt(0);
export const minorSchema = z.string().max(19).regex(/^(?:0|[1-9][0-9]*)(?![\s\S])/)
  .pipe(z.string().refine(value => BigInt(value) <= maxMinor));
export const signedMinorSchema = z.string().max(20).regex(/^(?:0|-?[1-9][0-9]*)(?![\s\S])/)
  .pipe(z.string().refine(value => BigInt(value) >= minMinor && BigInt(value) <= maxMinor));
export const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/);
export const versionSchema = minorSchema.refine(value => BigInt(value) > zero);
const holdDaysSchema = z.number().int().min(0).max(3650);
const bufferDaysSchema = z.number().int().min(0).max(365);
const refundDaysSchema = z.number().int().min(1).max(365).nullable();
const timestampSchema = z.iso.datetime({ offset: true });
const boundedJson = (value: unknown): boolean => new TextEncoder().encode(JSON.stringify(value)).length <= 32768;

export const commissionRuleSchema = z.union([
  z.strictObject({ percentage_bps: z.number().int().min(0).max(10000), fixed_minor: z.null().optional(), currency: z.null().optional() }),
  z.strictObject({ percentage_bps: z.null().optional(), fixed_minor: minorSchema, currency: currencySchema }),
]);
export const programSchema = z.strictObject({
  version: versionSchema,
  enabled: z.boolean(),
  hold_days: holdDaysSchema.default(30),
  buffer_days: bufferDaysSchema.default(2),
  terms_version: z.string().trim().min(1).max(32768),
  terms: z.strictObject({ en: z.string().trim().min(1).max(32768), pl: z.string().trim().min(1).max(32768) }).refine(boundedJson),
  thresholds: z.record(currencySchema, minorSchema).refine(boundedJson),
});
export const commissionInputSchema = z.strictObject({ base_minor: minorSchema, currency: currencySchema, rule: commissionRuleSchema });
export const maturityInputSchema = z.strictObject({
  paid_at: timestampSchema,
  is_refundable: z.boolean(),
  refund_period_days: refundDaysSchema,
  hold_days: holdDaysSchema,
  buffer_days: bufferDaysSchema,
});
export const ledgerAmountSchema = z.strictObject({
  kind: z.enum(['accrual', 'reversal', 'restoration', 'settlement', 'manual_adjustment']),
  amount_minor: signedMinorSchema,
}).refine(entry => {
  if (!signedMinorSchema.safeParse(entry.amount_minor).success) return false;
  const amount = BigInt(entry.amount_minor);
  if (entry.kind === 'accrual' || entry.kind === 'restoration') return amount > zero;
  if (entry.kind === 'reversal' || entry.kind === 'settlement') return amount < zero;
  return amount !== zero;
});
export const lossInputSchema = z.strictObject({
  gross_minor: minorSchema.refine(value => BigInt(value) > zero),
  base_minor: minorSchema,
  accrued_minor: minorSchema,
  refunded_gross_minor: signedMinorSchema,
  status: z.string().min(1).max(100),
  dispute_seen: z.boolean(),
  entries: z.array(ledgerAmountSchema),
}).refine(input => minorSchema.safeParse(input.accrued_minor).success
  && minorSchema.safeParse(input.base_minor).success && BigInt(input.accrued_minor) <= BigInt(input.base_minor));

export type CommissionRuleInput = z.infer<typeof commissionRuleSchema>;
export type ProgramInput = z.infer<typeof programSchema>;
export type CommissionInput = z.infer<typeof commissionInputSchema>;
export type MaturityInput = z.infer<typeof maturityInputSchema>;
export type LossInput = z.infer<typeof lossInputSchema>;
export type AffiliateResult<T> = { success: true; data: T } | { success: false; error: 'invalid_input' };
export interface LossResult {
  loss_net_minor: string;
  target_minor: string;
  delta_minor: string;
  kind: 'reversal' | 'restoration' | null;
  dispute_seen: boolean;
}
