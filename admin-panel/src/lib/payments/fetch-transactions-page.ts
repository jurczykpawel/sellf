/**
 * Payment transactions page loader for the admin payments dashboard.
 *
 * The v1 API clamps `limit` to `MAX_LIMIT` (100, see `lib/api/pagination.ts`)
 * regardless of what a caller requests, so a single request for "the last
 * 500 transactions" silently returns only the first 100. Unlike a
 * picker/dropdown, a seller's payment history can grow to any size and
 * should never be pulled into the browser all at once, so the dashboard
 * pages through it one bounded page at a time via a "Load more" control
 * instead of following the cursor automatically (see `api.listAll` for the
 * "fetch everything" case, used by pickers/dropdowns).
 */

import { api } from '@/lib/api/client';
import type { PaymentTransaction } from '@/types/payment';

// Matches the API's own per-page cap so a single request never gets
// silently truncated.
export const PAYMENTS_PAGE_LIMIT = 100;

export interface PaymentTransactionsPage {
  transactions: PaymentTransaction[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaymentTransactionsPageFilters {
  /** Payment status, or 'all'/omitted to not filter by status. */
  status?: string;
  /** Free-text search across customer email, Stripe session/payment intent id, and product name/slug. */
  search?: string;
  /** Dashboard date-range selector value ('7' | '30' | '90' | '365' | 'all'), or omitted to not filter by date. */
  dateRange?: string;
}

// Day counts backing the dashboard's date-range dropdown (PaymentFilters.tsx
// option values). 'all' (and anything else) intentionally has no entry —
// dateRangeToDateFrom returns undefined for it, matching how the status/search
// filters are omitted for their own "don't filter" values.
const DATE_RANGE_DAYS: Record<string, number> = {
  '7': 7,
  '30': 30,
  '90': 90,
  '365': 365,
};

/**
 * Converts the dashboard's day-count date-range selector into an inclusive
 * `date_from` ISO timestamp for the v1 API's `date_from` (`gte`) param.
 * Mirrors the "now minus N days" boundary already used by
 * `/api/admin/payments/export`, `/api/v1/payments/export`'s legacy
 * `dateRange` support, and RevenueChart's date presets — a fixed lookback
 * from now, not a calendar-day-aligned window.
 *
 * @param now - Injectable for deterministic tests; defaults to the real clock.
 */
export function dateRangeToDateFrom(dateRange: string | undefined, now: Date = new Date()): string | undefined {
  if (!dateRange) return undefined;
  const days = DATE_RANGE_DAYS[dateRange];
  if (!days) return undefined;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return from.toISOString();
}

export async function fetchPaymentTransactionsPage(
  cursor?: string,
  filters: PaymentTransactionsPageFilters = {}
): Promise<PaymentTransactionsPage> {
  const { status, search, dateRange } = filters;
  const dateFrom = dateRangeToDateFrom(dateRange);
  const response = await api.list<PaymentTransaction>('payments', {
    limit: PAYMENTS_PAGE_LIMIT,
    cursor,
    ...(status && status !== 'all' ? { status } : {}),
    ...(search ? { search } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
  });

  return {
    transactions: response.data,
    nextCursor: response.pagination.next_cursor,
    hasMore: response.pagination.has_more,
  };
}
