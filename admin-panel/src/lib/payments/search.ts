/** Shared payment-list and CSV search semantics.
 * @see src/app/api/v1/payments/route.ts
 * @see src/app/api/v1/payments/export/route.ts
 */
import { z } from 'zod';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export const VALID_PAYMENT_STATUSES = ['pending', 'completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned', 'awaiting_payment', 'cancelled'];

/** Order number typed as `1300` or `#1300`; null for anything else (or beyond bigint-safe range). */
/** Body of POST /api/v1/payments/export; also documents it in OpenAPI. */
export const exportFiltersSchema = z.object({
  status: z.string().optional().describe("'all' (default) or one payment status"),
  searchTerm: z.string().max(200).optional(),
  search: z.string().max(200).optional().describe('Free-text payment search'),
  product_id: z.uuid().optional(),
  date_from: z.string().refine(value => Number.isFinite(Date.parse(value))).optional().describe('ISO date'),
  date_to: z.string().refine(value => Number.isFinite(Date.parse(value))).optional().describe('ISO date'),
  dateRange: z.string().refine(value => value === 'all' || (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 3650)).optional().describe("'all' or a number of days (1-3650)"),
});

export function parseOrderNumberQuery(search: string): number | null {
  const match = /^#?(\d{1,15})$/.exec(search.trim());
  return match ? Number(match[1]) : null;
}

/** Uses a POST body for literal text; the result remains filterable as a transaction table. */
export function paymentSearchQuery(supabase: SupabaseClient<Database>, search: string) {
  return search ? supabase.rpc('search_payment_transactions', { p_search: search }) : supabase.from('payment_transactions');
}
