/**
 * useOrderBumps Hook
 *
 * Custom hook for fetching order bump configuration for a product.
 * Returns an array of all active bumps (supports multi-bump).
 */

import { useEffect, useState } from 'react';
import type { OrderBumpWithProduct } from '@/types/order-bump';

export function useOrderBumps(productId: string, sellerSlug?: string) {
  const [orderBumps, setOrderBumps] = useState<OrderBumpWithProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchOrderBumps() {
      if (!productId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const url = `/api/order-bumps?productId=${productId}${sellerSlug ? `&seller=${encodeURIComponent(sellerSlug)}` : ''}`;
        const response = await fetch(url, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!response.ok) {
          throw new Error('Failed to fetch order bumps');
        }

        const data = await response.json();

        if (controller.signal.aborted) return;

        if (data && data.length > 0) {
          setOrderBumps(data);
        } else {
          setOrderBumps([]);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Error fetching order bumps:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setOrderBumps([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchOrderBumps();

    return () => controller.abort();
  }, [productId, sellerSlug]);

  return { orderBumps, loading, error };
}
