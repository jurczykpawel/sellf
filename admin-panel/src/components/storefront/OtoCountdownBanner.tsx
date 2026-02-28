'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';

interface OtoCountdownBannerProps {
  expiresAt: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  currency?: string;
  onExpire: () => void;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatDiscount(type: 'percentage' | 'fixed', value: number, currency?: string): string {
  if (type === 'percentage') {
    return `${value}%`;
  }
  // For fixed discount, format with currency
  const formatter = new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: currency || 'PLN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return formatter.format(value);
}

export default function OtoCountdownBanner({
  expiresAt,
  discountType,
  discountValue,
  currency,
  onExpire,
}: OtoCountdownBannerProps) {
  const t = useTranslations('oto');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    const expiryTime = new Date(expiresAt).getTime();
    const now = Date.now();
    return Math.max(0, Math.floor((expiryTime - now) / 1000));
  });
  const [isExpired, setIsExpired] = useState(false);

  const handleExpire = useCallback(() => {
    setIsExpired(true);
    onExpire();
  }, [onExpire]);

  useEffect(() => {
    // If already expired on mount, schedule callback for next tick to avoid setState during render
    if (secondsRemaining <= 0) {
      const timeoutId = setTimeout(() => handleExpire(), 0);
      return () => clearTimeout(timeoutId);
    }

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Schedule for next tick to avoid setState during render
          setTimeout(() => handleExpire(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining, handleExpire]);

  // Don't render if expired
  if (isExpired) {
    return (
      <div className="bg-gf-raised border border-gf-border rounded-xl p-4 mb-6">
        <div className="flex items-center justify-center gap-2 text-gf-muted">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">{t('expired')}</span>
        </div>
      </div>
    );
  }

  // Calculate urgency level for styling
  const isUrgent = secondsRemaining < 60; // Less than 1 minute
  const isWarning = secondsRemaining < 300; // Less than 5 minutes

  return (
    <div
      data-testid="oto-countdown-banner"
      className={`
        relative overflow-hidden rounded-xl p-4 mb-6 border-2 transition-all duration-300
        ${isUrgent
          ? 'bg-gf-danger-soft border-red-500 animate-pulse'
          : isWarning
            ? 'bg-gf-warning-soft border-orange-500'
            : 'bg-wl-accent-soft border-wl-border-accent'
        }
      `}
    >
      {/* Animated background effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />

      <div className="relative flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Discount info */}
        <div className="flex items-center gap-3">
          <div className={`
            flex items-center justify-center w-12 h-12 rounded-full
            ${isUrgent ? 'bg-red-500' : isWarning ? 'bg-orange-500' : 'bg-wl-accent'}
            text-white font-bold text-lg
          `}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-gf-muted">{t('exclusiveOffer')}</p>
            <p className={`text-lg font-bold ${isUrgent ? 'text-red-600' : isWarning ? 'text-orange-600' : 'text-wl-accent'}`}>
              {t('saveAmount', { amount: formatDiscount(discountType, discountValue, currency) })}
            </p>
          </div>
        </div>

        {/* Timer */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gf-muted">{t('expiresIn')}</span>
          <div className={`
            px-4 py-2 rounded-lg font-mono text-2xl font-bold
            ${isUrgent
              ? 'bg-red-500 text-white'
              : isWarning
                ? 'bg-orange-500 text-white'
                : 'bg-wl-accent text-white'
            }
          `}>
            {formatTime(secondsRemaining)}
          </div>
        </div>
      </div>
    </div>
  );
}
