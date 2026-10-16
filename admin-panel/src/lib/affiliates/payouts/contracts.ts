/** Manual payout inputs and explicit read projections. @see actions.ts */
import { z } from 'zod';
import { currencySchema, minorSchema, signedMinorSchema, versionSchema } from '@/lib/affiliates/model';
const reference = z.string().min(1).max(200).refine(s => s.trim().length > 0 && !/[\r\n]/.test(s));
const timestamp = z.iso.datetime({ offset: true }).refine(s => Date.parse(s) <= Date.now());
const payout = { payout_id: z.uuid(), version: versionSchema };
export const previewSchema = z.strictObject({ member_id: z.uuid(), currency: currencySchema, cutoff: timestamp });
export const reserveSchema = previewSchema.extend({ member_version: versionSchema, program_version: versionSchema, payee_reference: reference });
export const paidSchema = z.strictObject({ ...payout, bank_reference: reference, invoice_reference: reference, bank_amount_minor: minorSchema.refine(s => BigInt(s) > BigInt(0)), currency: currencySchema, paid_at: timestamp, full_settlement: z.literal(true), reason: reference.optional(), evidence_reference: reference.optional() });
export const cancelSchema = z.strictObject({ ...payout, no_transfer: z.literal(true), reason: reference });
export const adjustmentSchema = z.strictObject({ commission_id: z.uuid(), version: versionSchema, amount_minor: signedMinorSchema.refine(s => s !== '0'), reason: reference, evidence_reference: reference, review_dispute: z.boolean() });
export const exportSchema = z.strictObject(payout);
export interface PayoutInfo { id: string; member_id: string; currency: string; earnings_minor: string; version: string; status: string; needs_review: boolean; payee_reference: string }
export interface PreviewInfo { member_version: string; program_version: string; earnings_minor: string; debt_offset_minor: string; payable_minor: string; held_minor: string; threshold_minor: string | null; available: boolean; sync_required: boolean }
export const payoutProjection = 'id,member_id,currency,earnings_minor::text,version::text,status,needs_review,payee_reference';

export interface AdjustmentInfo { id: string; member_id: string; currency: string; amount_minor: string }
export interface MemberChoice { id: string; display_name: string; code: string; status: string }
export interface CommissionChoice { id: string; version: string; currency: string; paid_at: string; product_name: string }
export interface PayoutChoices { members: MemberChoice[]; currencies: string[]; payouts: PayoutInfo[]; commissions: CommissionChoice[] }
