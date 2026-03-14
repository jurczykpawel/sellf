'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { AppliedCoupon } from '@/types/coupon';
import { createClient } from '@/lib/supabase/client';

export interface OtoInfo {
  valid: boolean;
  expires_at?: string;
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
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

  const [isOtoMode, setIsOtoMode] = useState(false);
  const [otoInfo, setOtoInfo] = useState<OtoInfo | null>(null);
  const [otoExpired, setOtoExpired] = useState(false);
  const [funnelTestOtoSlug, setFunnelTestOtoSlug] = useState<string | null>(null);

  // Fetch OTO info from URL params
  useEffect(() => {
    if (otoParam !== '1' || !urlCoupon || !urlEmail) return;

    const controller = new AbortController();
    setIsOtoMode(true);

    const fetchOtoInfo = async () => {
      try {
        const res = await fetch(
          `/api/oto/info?code=${encodeURIComponent(urlCoupon)}&email=${encodeURIComponent(urlEmail)}`,
          { signal: controller.signal }
        );
        const data = await res.json();

        if (data.valid) {
          setOtoInfo(data);
          onCouponReady(
            {
              code: urlCoupon,
              discount_type: data.discount_type,
              discount_value: data.discount_value,
            },
            urlCoupon
          );
        } else {
          setOtoExpired(true);
          setIsOtoMode(false);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[useOto] Failed to fetch OTO info:', err);
        setOtoExpired(true);
        setIsOtoMode(false);
      }
    };

    fetchOtoInfo();
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setIsOtoMode(false);
    toast.warning(t('otoExpired'));
  }, [t]);

  return { isOtoMode, otoInfo, otoExpired, handleOtoExpire, funnelTestOtoSlug };
}
