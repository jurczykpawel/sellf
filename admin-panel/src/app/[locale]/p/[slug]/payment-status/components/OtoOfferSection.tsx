'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { OtoOfferInfo } from '../types';

interface OtoOfferSectionProps {
  otoOffer: OtoOfferInfo;
  productSlug: string;
  onSkip: () => void;
  skipLabel?: string;
}

function formatDiscount(type: 'percentage' | 'fixed' | undefined, value: number | undefined, currency?: string): string {
  if (!type || !value) return '';

  if (type === 'percentage') {
    return `${value}%`;
  }

  const formatter = new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: currency || 'PLN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return formatter.format(value);
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export default function OtoOfferSection({
  otoOffer,
  productSlug,
  onSkip,
  skipLabel
}: OtoOfferSectionProps) {
  const t = useTranslations('oto');
  const router = useRouter();

  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    if (!otoOffer.expiresAt) return 0;
    const expiryTime = new Date(otoOffer.expiresAt).getTime();
    const now = Date.now();
    return Math.max(0, Math.floor((expiryTime - now) / 1000));
  });
  const [isExpired, setIsExpired] = useState(false);

  const handleExpire = useCallback(() => {
    setIsExpired(true);
  }, []);

  useEffect(() => {
    if (secondsRemaining <= 0) {
      const timeoutId = setTimeout(() => handleExpire(), 0);
      return () => clearTimeout(timeoutId);
    }

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setTimeout(() => handleExpire(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining, handleExpire]);

  const handleAccept = () => {
    if (otoOffer.checkoutUrl) {
      router.push(otoOffer.checkoutUrl);
    }
  };

  // Calculate urgency level
  const isUrgent = secondsRemaining < 60;
  const isWarning = secondsRemaining < 300;

  // If expired, show expired message and skip button
  if (isExpired) {
    return (
      <div className="mt-6 p-6 bg-gf-raised rounded-xl border border-gf-border">
        <div className="text-center">
          <div className="text-4xl mb-3">⏰</div>
          <h3 className="text-lg font-semibold text-gf-body mb-2">
            {t('offerExpired')}
          </h3>
          <p className="text-gf-muted mb-4">
            {t('offerExpiredDesc')}
          </p>
          <button
            onClick={onSkip}
            className="px-6 py-2 bg-gf-muted/30 hover:bg-gf-muted/40 text-gf-heading rounded-lg transition-colors"
          >
            {skipLabel || t('continue')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* OTO Banner */}
      <div
        className={`
          relative overflow-hidden rounded-xl p-6 border-2 transition-all duration-300
          ${isUrgent
            ? 'bg-gf-danger-soft border-gf-danger animate-pulse'
            : isWarning
              ? 'bg-gf-warning-soft border-gf-warning'
              : 'bg-wl-accent-soft border-wl-border-accent'
          }
        `}
      >
        {/* Shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />

        <div className="relative">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`
                flex items-center justify-center w-12 h-12 rounded-full
                ${isUrgent ? 'bg-gf-danger-bg' : isWarning ? 'bg-gf-warning' : 'bg-wl-accent'}
                text-white
              `}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gf-body">{t('exclusiveOffer')}</p>
                <p className={`text-lg font-bold ${isUrgent ? 'text-gf-danger' : isWarning ? 'text-gf-warning' : 'text-wl-accent'}`}>
                  {t('saveAmount', { amount: formatDiscount(otoOffer.discountType, otoOffer.discountValue, otoOffer.currency) })}
                </p>
              </div>
            </div>

            {/* Timer */}
            <div className="text-center">
              <span className="text-xs text-gf-muted block mb-1">{t('expiresIn')}</span>
              <div className={`
                px-4 py-2 rounded-lg font-mono text-2xl font-bold
                ${isUrgent
                  ? 'bg-gf-danger-bg text-gf-inverse'
                  : isWarning
                    ? 'bg-gf-warning text-gf-inverse'
                    : 'bg-wl-accent text-white'
                }
              `}>
                {formatTime(secondsRemaining)}
              </div>
            </div>
          </div>

          {/* Product info */}
          {otoOffer.otoProductName && (
            <div className="mb-4 p-3 bg-gf-raised/50 rounded-lg">
              <p className="text-gf-body">
                <span className="font-medium">{t('product')}:</span> {otoOffer.otoProductName}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleAccept}
              className={`
                flex-1 px-6 py-3 rounded-full font-semibold text-white transition-all
                ${isUrgent
                  ? 'bg-gf-danger-bg hover:bg-gf-danger/90'
                  : isWarning
                    ? 'bg-gf-warning hover:bg-gf-warning/90'
                    : 'bg-wl-accent hover:bg-wl-accent-hover'
                }
                active:scale-[0.98]
              `}
            >
              🎁 {t('acceptOffer')}
            </button>
            <button
              onClick={onSkip}
              className="flex-1 sm:flex-none px-6 py-3 rounded-full font-medium text-gf-body bg-gf-raised hover:bg-gf-hover transition-colors"
            >
              {skipLabel || t('noThanks')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
