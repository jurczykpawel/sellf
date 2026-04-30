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
          if (otoProduct?.slug) setFunnelTestOtoSlug(otoProduct.slug);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[useOto] Failed to fetch funnel test OTO slug:', err);
      }
    };

    checkOto();
    return () => controller.abort();
  }, [isFunnelTest, productId]);

  const handleOtoExpire = useCallback(() => {
    setOtoExpired(true);
    toast.warning(t('otoExpired'));
  }, [t]);

  return { isOtoMode, otoInfo, otoExpired, handleOtoExpire, funnelTestOtoSlug };
}
