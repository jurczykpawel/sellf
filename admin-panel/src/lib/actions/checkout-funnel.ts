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

    const { data, error } = await dataClient.rpc('get_checkout_funnel', {
      p_days: days,
      p_product_id: productId ?? null,
    });
    if (error || !data) {
      console.error('[getCheckoutFunnel] Read failed:', error);
      return { success: false, error: 'Unable to load checkout funnel' };
    }
    return { success: true, data: data as CheckoutFunnelStats };
  });
}
