/**
 * Coupons page loader for the admin coupons page.
 *
 * The coupons table grows without bound in a busy shop: the OTO system
 * auto-generates a coupon per qualifying purchase (`coupons.is_oto_coupon`,
 * see `supabase/migrations/20251230000000_oto_system.sql`). Loading the
 * whole table with `api.listAll` (sequential requests, 100/page, 5000-item
 * safety ceiling) means dozens of round trips before the page renders, and
 * silently incomplete lists past the ceiling. This module backs the page's
 * "Load more" control instead: it fetches one page at a time (at the API's
 * own cap, so a request never gets silently truncated) and forwards the
 * type/search filters to the server so a match beyond the first page is
 * still found.
 */

import { api } from '@/lib/api/client';
import type { Coupon } from '@/types/coupon';

// Matches the API's own per-page cap (`MAX_LIMIT` in `lib/api/pagination.ts`)
// so a single request never gets silently truncated.
export const COUPONS_PAGE_LIMIT = 100;

export interface CouponsPage {
  coupons: Coupon[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CouponsPageFilters {
  /** 'all' | 'oto' | 'regular', or omitted to not filter by type. */
  type?: string;
  /** Free-text search across coupon code and name. */
  search?: string;
  /** 'all' | 'active' | 'inactive' | 'expired', or omitted to not filter by status. */
  status?: string;
}

export async function fetchCouponsPage(
  cursor?: string,
  filters: CouponsPageFilters = {}
): Promise<CouponsPage> {
  const { type, search, status } = filters;
  const response = await api.list<Coupon>('coupons', {
    limit: COUPONS_PAGE_LIMIT,
    cursor,
    ...(type && type !== 'all' ? { type } : {}),
    ...(search ? { search } : {}),
    ...(status && status !== 'all' ? { status } : {}),
  });

  return {
    coupons: response.data,
    nextCursor: response.pagination.next_cursor,
    hasMore: response.pagination.has_more,
  };
}
