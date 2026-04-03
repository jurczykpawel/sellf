import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Product } from '@/types';
import { checkProductAccess } from '@/lib/api/product-access';
import { FetchTimeoutError } from '@/lib/fetch-with-timeout';

export interface AccessResponse {
  hasAccess: boolean;
  reason?: 'no_access' | 'expired' | 'inactive' | 'temporal';
  userAccess?: {
    access_expires_at?: string | null;
    access_duration_days?: number | null;
    access_granted_at: string;
  };
}

export function useProductAccess(product: Product, options?: { previewMode?: boolean }) {
  const previewMode = options?.previewMode ?? false;
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accessData, setAccessData] = useState<AccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'timeout' | 'error' | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // Build checkout URL preserving OTO params (inside effect to capture current searchParams)
    const buildCheckoutUrl = (slug: string) => {
      const params = new URLSearchParams();
      const email = searchParams.get('email');
      const coupon = searchParams.get('coupon');
      const oto = searchParams.get('oto');

      if (email) params.set('email', email);
      if (coupon) params.set('coupon', coupon);
      if (oto) params.set('oto', oto);

      const queryString = params.toString();
      const basePath = `/checkout/${slug}`;
      return `${basePath}${queryString ? `?${queryString}` : ''}`;
    };

    const checkUserAccess = async () => {
      // Preview mode — skip all access checks, grant instant access
      if (previewMode) {
        setAccessData({ hasAccess: true });
        setLoading(false);
        return;
      }

      // Don't do anything while auth is still loading
      if (authLoading) {
        return;
      }

      if (!user) {
        // For non-logged users, check if product is available before redirecting to checkout
        const now = new Date();
        const availableFrom = product.available_from ? new Date(product.available_from) : null;
        const availableUntil = product.available_until ? new Date(product.available_until) : null;
        const isTemporallyAvailable = (!availableFrom || availableFrom <= now) && (!availableUntil || availableUntil > now);

        if (!product.is_active) {
          setAccessData({
            hasAccess: false,
            reason: 'inactive'
          });
          setLoading(false);
          return;
        }

        if (!isTemporallyAvailable) {
          setAccessData({
            hasAccess: false,
            reason: 'temporal'
          });
          setLoading(false);
          return;
        }

        // Product is available - redirect to checkout (preserving OTO params)
        setLoading(false);
        router.push(buildCheckoutUrl(product.slug));
        return;
      }

      // Reset loading when user becomes available
      setLoading(true);
      setError(null);

      try {
        const data = await checkProductAccess(product.slug, { signal: controller.signal });

        if (controller.signal.aborted) return;

        setAccessData(data);

        // If user doesn't have access, check the reason before redirecting
        if (!data.hasAccess) {
          // Only redirect to checkout if the product is available for new purchases
          if (data.reason === 'no_access') {
            router.push(buildCheckoutUrl(product.slug));
            return;
          }
          // For other reasons (inactive, temporal, expired), show appropriate message
          // Component will handle this in the render logic
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        setAccessData(null);

        if (err instanceof FetchTimeoutError) {
          console.error('[useProductAccess] Access check timed out:', err.message);
          setError('timeout');
        } else {
          console.error('[useProductAccess] Error checking product access:', err);
          setError('error');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    checkUserAccess();

    return () => {
      controller.abort();
    };
  }, [previewMode, user, product.slug, product.is_active, product.available_from, product.available_until, router, authLoading, searchParams]);

  return {
    accessData,
    loading: authLoading || loading,
    error,
    user
  };
}
