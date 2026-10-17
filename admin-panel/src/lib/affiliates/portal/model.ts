/** Portal read contracts. @see service.ts @see supabase/migrations/20261016000000_release_2026_10_6.sql */
import { z } from 'zod';
import { currencySchema } from '@/lib/affiliates/model';

export const portalQuerySchema = z.strictObject({ cursor: z.uuid().transform(value => value.toLowerCase()).optional(), limit: z.number().int().min(1).max(100).default(25), currency: currencySchema.optional() });
export interface CurrencyBalance {
  currency: string; accrued: string; reversed: string; paid: string; reserved: string; held: string; eligible: string; debt: string; balance: string;
}
export interface PortalData {
  member: { code: string; status: string };
  balances: CurrencyBalance[];
  commissions: { product: string; status: CommissionStatus; reference: string; currency: string; paid_at: string; eligible_at: string | null; accrued_minor: string; current_minor: string; livemode: boolean; sync_pending: boolean; needs_review: boolean }[];
  codes: { code: string; active: boolean }[];
  rules: { product: string; percentage_bps: number | null; fixed_minor: string | null; currency: string | null; enabled: boolean }[];
  next_cursor: string | null; as_of: string; sync_pending: boolean; needs_review: boolean;
  lag?: { pending: number; needs_review: number; retrying: number; next_attempt_at: string | null; errors: { sync_failed: number; session_unresolved: number; awaiting_fulfillment: number } };
}
export type PortalResult = { success: true; data: PortalData } | { success: false; error: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_input' | 'unavailable' };
export type CommissionStatus = 'held' | 'eligible' | 'reserved' | 'paid' | 'reversed';
