/** Payment summaries aggregate in SQL so the REST row limit cannot truncate totals. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
export interface PaymentStatistics {
  total_transactions: number;
  total_revenue: number;
  today_revenue: number;
  this_month_revenue: number;
  refunded_amount: number;
  pending_count: number;
  total_revenue_by_currency: Record<string, number>;
  today_revenue_by_currency: Record<string, number>;
  this_month_revenue_by_currency: Record<string, number>;
  refunded_amount_by_currency: Record<string, number>;
  by_currency: Record<string, { total_revenue: number; transaction_count: number }>;
}
export async function getPaymentStatistics(db: SupabaseClient<Database>): Promise<PaymentStatistics> {
  const now = new Date();
  const { data, error } = await db.rpc('get_payment_summary', {
    p_today_start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(),
    p_month_start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
  });
  if (error || !data) throw new Error('Payment statistics unavailable');
  return data as unknown as PaymentStatistics;
}

export interface RevenueGroup {
  product_id: string | null;
  currency: string;
  status: string;
  created_at: string;
  amount: number;
  refunded_amount: number;
  transaction_count: number;
}
export async function getRevenueGroups(db: SupabaseClient<Database>, filters: { start?: Date; end?: Date; productId?: string | null } = {}): Promise<RevenueGroup[]> {
  const { data, error } = await db.rpc('get_revenue_groups', {
    p_start: filters.start?.toISOString(), p_end: filters.end?.toISOString(), p_product_id: filters.productId || undefined,
  });
  if (error || !data) throw new Error('Revenue statistics unavailable');
  return data as unknown as RevenueGroup[];
}
export function countRevenueOrders(groups: RevenueGroup[]): number {
  return groups.reduce((sum, group) => sum + group.transaction_count, 0);
}
