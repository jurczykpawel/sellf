'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { AppliedCoupon } from '@/types/coupon';

interface UseCouponOptions {
  productId: string;
  email?: string;
  /** When true, OTO hook handles coupon from URL — skip URL coupon logic here */
  isOtoMode?: boolean;
  /** Seller slug for marketplace products (scopes coupon verification to seller schema) */
  sellerSlug?: string;
}

interface UseCouponReturn {
  couponCode: string;
  setCouponCode: (code: string) => void;
  appliedCoupon: AppliedCoupon | null;
  isVerifyingCoupon: boolean;
  showCouponInput: boolean;
  couponError: string | null;
  handleVerifyCoupon: (code: string, currentEmail?: string) => Promise<void>;
  /** Remove the applied coupon and mark as manually removed (prevents auto-reapply) */
  removeCoupon: () => void;
  /** Show coupon input field */
  showInput: () => void;
  /** Apply a coupon from OTO flow (called by useOto) */
  applyOtoCoupon: (coupon: AppliedCoupon, code: string) => void;
}

export function useCoupon({ productId, email, isOtoMode, sellerSlug }: UseCouponOptions): UseCouponReturn {
  const t = useTranslations('checkout');
  const searchParams = useSearchParams();

  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [isVerifyingCoupon, setIsVerifyingCoupon] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponManuallyRemoved, setCouponManuallyRemoved] = useState(false);
  const [lastCheckedUrlCoupon, setLastCheckedUrlCoupon] = useState<string | null>(null);

  // Reset manual removal flag when email changes
  useEffect(() => {
    setCouponManuallyRemoved(false);
  }, [email]);

  const handleVerifyCoupon = useCallback(async (code: string, currentEmail?: string) => {
    if (!code) return;
    setIsVerifyingCoupon(true);
    setCouponError(null);
    setCouponManuallyRemoved(false);
    try {
      const res = await fetch('/api/coupons/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          productId,
          email: currentEmail || email,
          sellerSlug: sellerSlug || undefined,
        }),
      });
      const data = await res.json();
      if (data.valid) {
        setAppliedCoupon(data);
        setCouponCode(data.code);
        setShowCouponInput(true);
      } else {
        setCouponError(data.error || t('invalidCoupon'));
        setAppliedCoupon(null);
      }
    } catch {
      setCouponError(t('verifyError'));
    } finally {
      setIsVerifyingCoupon(false);
    }
  }, [productId, email, sellerSlug, t]);

  // Auto-apply coupon for email change
  useEffect(() => {
    const checkAutoApply = async () => {
      if (!email || appliedCoupon || couponManuallyRemoved) return;
      try {
        const res = await fetch('/api/coupons/auto-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, productId, sellerSlug }),
        });
        const data = await res.json();
        if (data.found) {
          setAppliedCoupon(data);
          setCouponCode(data.code);
          toast.success(t('discountApplied', { discount: '' }).replace('  ', ' '));
        }
      } catch {
        // Silent fail
      }
    };

    const timer = setTimeout(checkAutoApply, 500);
    return () => clearTimeout(timer);
  }, [email, productId, appliedCoupon, couponManuallyRemoved, t]);

  // Handle URL coupon param (non-OTO) — absorbed from PaidProductForm
  useEffect(() => {
    if (isOtoMode) return;

    const urlCoupon = searchParams.get('coupon');
    const showPromo = searchParams.get('show_promo');

    if (showPromo === 'true') {
      setShowCouponInput(true);
    }

    if (searchParams.get('oto') === '1') return; // handled by useOto

    if (urlCoupon && urlCoupon !== lastCheckedUrlCoupon) {
      setLastCheckedUrlCoupon(urlCoupon);
      setCouponCode(urlCoupon);
      setShowCouponInput(true);
      handleVerifyCoupon(urlCoupon);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isOtoMode]);

  const removeCoupon = useCallback(() => {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponManuallyRemoved(true);
  }, []);

  const showInput = useCallback(() => {
    setShowCouponInput(true);
  }, []);

  const applyOtoCoupon = useCallback((coupon: AppliedCoupon, code: string) => {
    setAppliedCoupon(coupon);
    setCouponCode(code);
    setShowCouponInput(true);
    setLastCheckedUrlCoupon(code);
  }, []);

  return {
    couponCode,
    setCouponCode,
    appliedCoupon,
    isVerifyingCoupon,
    showCouponInput,
    couponError,
    handleVerifyCoupon,
    removeCoupon,
    showInput,
    applyOtoCoupon,
  };
}
