'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { AppliedCoupon } from '@/types/coupon';

interface UseCouponOptions {
  enabled?: boolean;
  productId: string;
  email?: string;
  /** When true, OTO hook handles coupon from URL — skip URL coupon logic here */
  isOtoMode?: boolean;
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
  /** Apply a coupon from OTO flow (called by useOto) */
  applyOtoCoupon: (coupon: AppliedCoupon, code: string) => void;
  /**
   * Drop a coupon the server no longer honours (e.g. used up in another tab) and
   * tell the buyer; the checkout re-prices without it before any payment.
   */
  invalidateCoupon: () => void;
}

export function useCoupon({ productId, email, isOtoMode, enabled = true }: UseCouponOptions): UseCouponReturn {
  const t = useTranslations('checkout');
  const searchParams = useSearchParams();

  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [isVerifyingCoupon, setIsVerifyingCoupon] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponManuallyRemoved, setCouponManuallyRemoved] = useState(false);
  const [lastCheckedUrlCoupon, setLastCheckedUrlCoupon] = useState<string | null>(null);

  const [previousEmail, setPreviousEmail] = useState(email);
  if (previousEmail !== email) {
    setPreviousEmail(email);
    setCouponManuallyRemoved(false);
  }

  const verifyCouponRequest = useCallback(async (code: string, currentEmail?: string) => {
    if (!enabled || !code) return;
    try {
      const res = await fetch('/api/coupons/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          productId,
          email: currentEmail || email,
        }),
      });
      const data = await res.json();
      if (res.status === 429) {
        const minutes = Math.max(1, Math.ceil((Number(data.retryAfterSeconds) || 3600) / 60));
        setCouponError(t('couponRateLimited', { minutes }));
        setAppliedCoupon(null);
      } else if (data.valid) {
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
  }, [enabled, productId, email, t]);

  const handleVerifyCoupon = useCallback((code: string, currentEmail?: string) => {
    if (!enabled || !code) return Promise.resolve();
    setIsVerifyingCoupon(true);
    setCouponError(null);
    setCouponManuallyRemoved(false);
    return verifyCouponRequest(code, currentEmail);
  }, [enabled, verifyCouponRequest]);

  // Auto-apply coupon for email change
  useEffect(() => {
    const checkAutoApply = async () => {
      if (!enabled || !email || appliedCoupon || couponManuallyRemoved) return;
      try {
        const res = await fetch('/api/coupons/auto-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, productId }),
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
  }, [enabled, email, productId, appliedCoupon, couponManuallyRemoved, t]);

  const urlCoupon = enabled && !isOtoMode && searchParams.get('oto') !== '1' ? searchParams.get('coupon') : null;
  const requestedURLCoupon = useRef<string | null>(null);
  if (urlCoupon && urlCoupon !== lastCheckedUrlCoupon) {
    setLastCheckedUrlCoupon(urlCoupon);
    setCouponCode(urlCoupon);
    setShowCouponInput(true);
    setIsVerifyingCoupon(true);
    setCouponError(null);
    setCouponManuallyRemoved(false);
  }
  useEffect(() => {
    if (!urlCoupon || requestedURLCoupon.current === urlCoupon) return;
    requestedURLCoupon.current = urlCoupon;

    void verifyCouponRequest(urlCoupon);
  }, [urlCoupon, verifyCouponRequest]);

  const removeCoupon = useCallback(() => {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponManuallyRemoved(true);
  }, []);

  const invalidateCoupon = useCallback(() => {
    const message = t('couponNoLongerAvailable');
    setAppliedCoupon(null);
    setCouponManuallyRemoved(true);
    setShowCouponInput(true);
    setCouponError(message);
    toast.error(message);
  }, [t]);

  const applyOtoCoupon = useCallback((coupon: AppliedCoupon, code: string) => {
    if (!enabled) return;
    setAppliedCoupon(coupon);
    setCouponCode(code);
    setShowCouponInput(true);
    setLastCheckedUrlCoupon(code);
  }, [enabled]);

  return {
    couponCode,
    setCouponCode,
    appliedCoupon: enabled ? appliedCoupon : null,
    isVerifyingCoupon: enabled && isVerifyingCoupon,
    showCouponInput: enabled && showCouponInput,
    couponError,
    handleVerifyCoupon,
    removeCoupon,
    applyOtoCoupon,
    invalidateCoupon,
  };
}
