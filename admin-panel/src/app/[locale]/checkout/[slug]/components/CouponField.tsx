'use client';

import { useTranslations } from 'next-intl';
import type { AppliedCoupon } from '@/types/coupon';

interface CouponFieldProps {
  couponCode: string;
  appliedCoupon: AppliedCoupon | null;
  isVerifying: boolean;
  couponError: string | null;
  currency: string;
  showCouponInput: boolean;
  onCodeChange: (code: string) => void;
  onApply: () => void;
  onRemove: () => void;
}

export default function CouponField({
  couponCode,
  appliedCoupon,
  isVerifying,
  couponError,
  currency,
  showCouponInput,
  onCodeChange,
  onApply,
  onRemove,
}: CouponFieldProps) {
  const t = useTranslations('checkout');

  if (!showCouponInput && !appliedCoupon) return null;

  return (
    <div className="mb-4">
      <div className="animate-in fade-in slide-in-from-top-1 duration-300">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={couponCode}
              onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
              placeholder={t('couponPlaceholder')}
              disabled={!!appliedCoupon || isVerifying}
              className={`
                w-full px-3 py-2 bg-sf-input border rounded-lg text-sm transition-all outline-none
                ${appliedCoupon ? 'border-sf-success/50 text-sf-success bg-sf-success-soft' : 'border-sf-border focus:border-sf-accent/50'}
              `}
            />
            {appliedCoupon && (
              <div className="absolute right-3 inset-y-0 flex items-center">
                <svg className="w-4 h-4 text-sf-success" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>
          {!appliedCoupon ? (
            <button
              onClick={onApply}
              disabled={!couponCode || isVerifying}
              className="px-4 py-2 bg-sf-raised hover:bg-sf-hover text-sf-heading text-sm rounded-lg transition-all disabled:opacity-50"
            >
              {isVerifying ? t('verifying') : t('applyCoupon')}
            </button>
          ) : (
            <button
              onClick={onRemove}
              className="px-2 py-2 text-sf-muted hover:text-sf-danger transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {couponError && !appliedCoupon && (
          <p className="text-[10px] text-sf-danger mt-1 ml-1">{couponError}</p>
        )}
        {appliedCoupon && (
          <p className="text-[10px] text-sf-success mt-1 ml-1 font-medium uppercase tracking-wider">
            🎉 {t('discountApplied', { discount: appliedCoupon.discount_type === 'percentage' ? `${appliedCoupon.discount_value}%` : `${appliedCoupon.discount_value} ${currency}` })}
          </p>
        )}
      </div>
    </div>
  );
}
