'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { AppliedCoupon } from '@/types/coupon';
import { createClient } from '@/lib/supabase/client';

export interface OtoInfo {
  valid: boolean;
  coupon_id?: string;
  code?: string;
  expires_at?: string;
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
  exclude_order_bumps?: boolean;
  allowed_product_ids?: string[];
  seconds_remaining?: number;
}

interface UseOtoOptions {
  urlCoupon: string | null;
  urlEmail: string | null;
  otoParam: string | null;
  productId: string;
  /** Admin-only funnel test mode */
  isFunnelTest: boolean;
  /** Callback to apply OTO coupon to the coupon hook */
  onCouponReady: (coupon: AppliedCoupon, code: string) => void;
}

interface UseOtoReturn {
  isOtoMode: boolean;
  otoInfo: OtoInfo | null;
  otoExpired: boolean;
  handleOtoExpire: () => void;
  /** Slug of the OTO target product (for funnel test redirect) */
  funnelTestOtoSlug: string | null;
  /**
   * Returns a Promise that resolves once the funnel-test OTO lookup has
   * settled (success, failure, or "no OTO configured"). Exposed as a getter
   * so callers always read the latest in-flight or resolved promise — a
   * mutated ref does not re-render, so a stale plain reference would never
   * unblock once the fetch finishes.
   */
  getFunnelTestOtoReady: () => Promise<void>;
  /**
   * Returns the latest funnel-test OTO slug, bypassing closure capture so a
   * caller awaiting `getFunnelTestOtoReady()` can read the value the fetch
   * just wrote even if its memoized callback was bound to an earlier render.
   */
  getFunnelTestOtoSlug: () => string | null;
}

export function useOto({
  urlCoupon,
  urlEmail,
  otoParam,
  productId,
  isFunnelTest,
  onCouponReady,
}: UseOtoOptions): UseOtoReturn {
  const t = useTranslations('checkout');

  const [otoInfo, setOtoInfo] = useState<OtoInfo | null>(null);
  const [otoExpired, setOtoExpired] = useState(false);
  const [funnelTestOtoSlug, setFunnelTestOtoSlug] = useState<string | null>(null);

  // Mirror the slug into a ref so callers can read the latest value past
  // the closure boundary of any async handler that captured an older
  // render. Updated together with state (in the fetch's finally block).
  const funnelTestOtoSlugRef = useRef<string | null>(null);
  const getFunnelTestOtoSlug = useCallback(() => funnelTestOtoSlugRef.current, []);

  // Holds the in-flight (or settled) funnel-test OTO fetch promise. Mutated
  // when the productId/isFunnelTest pair changes — callers must read it
  // through the getter below so they always see the active promise instead
  // of a stale snapshot from an earlier render.
  const funnelTestOtoReadyRef = useRef<{ promise: Promise<void>; resolve: () => void }>(
    (() => {
      let resolve: () => void = () => {};
      const promise = new Promise<void>((r) => { resolve = r; });
      return { promise, resolve };
    })(),
  );
  const getFunnelTestOtoReady = useCallback(() => funnelTestOtoReadyRef.current.promise, []);

  // Derived from URL params + expiration flag — single source of truth, no
  // setState-in-effect cascade.
  const isOtoMode = !otoExpired && otoParam === '1' && !!urlCoupon && !!urlEmail;

  // Ref for callback to avoid re-triggering effect on parent re-renders
  const onCouponReadyRef = useRef(onCouponReady);
  useEffect(() => {
    onCouponReadyRef.current = onCouponReady;
  }, [onCouponReady]);

  // Fetch OTO info from URL params
  useEffect(() => {
    if (otoParam !== '1' || !urlCoupon || !urlEmail) return;

    const controller = new AbortController();

    const fetchOtoInfo = async () => {
      try {
        const res = await fetch(
          `/api/oto/info?code=${encodeURIComponent(urlCoupon)}&email=${encodeURIComponent(urlEmail)}`,
          { signal: controller.signal }
        );
        const data = await res.json();

        if (data.valid) {
          setOtoInfo(data);
          onCouponReadyRef.current(
            {
              id: data.coupon_id,
              code: data.code ?? urlCoupon,
              discount_type: data.discount_type,
              discount_value: data.discount_value,
              exclude_order_bumps: data.exclude_order_bumps,
              allowed_product_ids: data.allowed_product_ids,
            },
            data.code ?? urlCoupon
          );
        } else {
          setOtoExpired(true);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[useOto] Failed to fetch OTO info:', err);
        setOtoExpired(true);
      }
    };

    fetchOtoInfo();
    return () => controller.abort();
  }, [otoParam, urlCoupon, urlEmail]);

  // Funnel test: pre-fetch OTO target slug (absorbed from PaidProductForm)
  useEffect(() => {
    if (!isFunnelTest) return;
    const controller = new AbortController();

    // Reset the ready-promise for this (isFunnelTest, productId) pair.
    let resolveReady: () => void = () => {};
    const readyPromise = new Promise<void>((r) => { resolveReady = r; });
    funnelTestOtoReadyRef.current = { promise: readyPromise, resolve: resolveReady };

    const checkOto = async () => {
      try {
        const supabase = await createClient();
        const { data: offer } = await supabase
          .from('oto_offers')
          .select('oto_product_id')
          .eq('source_product_id', productId)
          .eq('is_active', true)
          .limit(1)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (offer?.oto_product_id) {
          const { data: otoProduct } = await supabase
            .from('products')
            .select('slug')
            .eq('id', offer.oto_product_id)
            .abortSignal(controller.signal)
            .single();
          if (otoProduct?.slug) {
            funnelTestOtoSlugRef.current = otoProduct.slug;
            setFunnelTestOtoSlug(otoProduct.slug);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[useOto] Failed to fetch funnel test OTO slug:', err);
      } finally {
        resolveReady();
      }
    };

    checkOto();
    return () => controller.abort();
  }, [isFunnelTest, productId]);

  const handleOtoExpire = useCallback(() => {
    setOtoExpired(true);
    toast.warning(t('otoExpired'));
  }, [t]);

  return {
    isOtoMode,
    otoInfo,
    otoExpired,
    handleOtoExpire,
    funnelTestOtoSlug,
    getFunnelTestOtoReady,
    getFunnelTestOtoSlug,
  };
}
