'use server';

/**
 * Read-only funnel of recorded payment attempts, grouped by current status.
 * @see supabase/migrations/20260115163547_abandoned_cart_recovery.sql
 * @see src/lib/stripe/checkout-expiration.ts
 */
import { z } from 'zod';
import { withAdminClient } from '@/lib/actions/admin-auth';
import type { ActionResponse } from '@/lib/actions/admin-auth';

export interface FunnelCounts {
  started: number;
  paid: number;
  pending: number;
  abandoned: number;
}

export interface ProductFunnel extends FunnelCounts {
  productId: string | null;
  name: string | null;
}

export interface CheckoutFunnelStats {
  totals: FunnelCounts;
  products: ProductFunnel[];
}

interface FunnelRow {
  status: string;
  product_id: string | null;
  products: { name: string } | null;
}

const inputSchema = z.object({
  days: z.number().int().min(1).max(365),
  productId: z.uuid().optional(),
});

export async function getCheckoutFunnel(
  days: number = 30,
  productId?: string,
): Promise<ActionResponse<CheckoutFunnelStats>> {
  return withAdminClient(async ({ dataClient }) => {
    const input = inputSchema.safeParse({ days, productId });
    if (!input.success) return { success: false, error: 'Invalid funnel filters' };

    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const totals: FunnelCounts = { started: 0, paid: 0, pending: 0, abandoned: 0 };
    const products = new Map<string | null, ProductFunnel>();
    const pageSize = 1000;

    // The legacy stats RPC has no product breakdown or paid denominator.
    // Page through the same source without reading buyer details or combining currencies.
    for (let offset = 0; ; offset += pageSize) {
      let query = dataClient.from('payment_transactions')
        .select('status, product_id, products(name)')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: true }).order('id', { ascending: true });
      if (productId) query = query.eq('product_id', productId);
      const { data, error } = await query.range(offset, offset + pageSize - 1);
      if (error || !data) {
        console.error('[getCheckoutFunnel] Read failed:', error);
        return { success: false, error: 'Unable to load checkout funnel' };
      }

      for (const row of data as unknown as FunnelRow[]) {
        let product = products.get(row.product_id);
        if (!product) {
          product = { productId: row.product_id, name: row.products?.name ?? null, started: 0, paid: 0, pending: 0, abandoned: 0 };
          products.set(row.product_id, product);
        }
        for (const counts of [totals, product]) {
          counts.started++;
          if (row.status === 'pending') counts.pending++;
          else if (row.status === 'abandoned') counts.abandoned++;
          else if (['completed', 'refunded', 'partially_refunded', 'disputed'].includes(row.status)) counts.paid++;
        }
      }
      if (data.length < pageSize) break;
    }

    return { success: true, data: { totals, products: [...products.values()].sort((a, b) => b.started - a.started) } };
  });
}
