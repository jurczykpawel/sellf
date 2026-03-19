'use client';

import { useRef, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import type { OrderBumpWithProduct } from '@/types/order-bump';

interface OrderBumpListProps {
  bumps: OrderBumpWithProduct[];
  selectedBumpIds: Set<string>;
  onToggle: (bumpProductId: string) => void;
}

export default function OrderBumpList({ bumps, selectedBumpIds, onToggle }: OrderBumpListProps) {
  const t = useTranslations('checkout');
  const pageLoadTime = useRef(Date.now());
  const [, setTimerTick] = useState(0);

  const hasUrgencyBumps = bumps.some(
    b => b.urgency_duration_minutes != null && b.urgency_duration_minutes > 0
  );

  useEffect(() => {
    if (!hasUrgencyBumps) return;
    const interval = setInterval(() => setTimerTick(tick => tick + 1), 1000);
    return () => clearInterval(interval);
  }, [hasUrgencyBumps]);

  if (bumps.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      <h3 className="text-sm font-semibold text-sf-muted uppercase tracking-wider">
        {t('addToYourOrder')}
      </h3>
      {bumps.map((bump) => {
        const isSelected = selectedBumpIds.has(bump.bump_product_id);
        return (
          <div
            key={bump.bump_id}
            className={`
              relative group overflow-hidden rounded-2xl border transition-all duration-300 ease-out
              ${isSelected
                ? 'border-amber-400/50 bg-sf-warning-soft shadow-[0_0_40px_-10px_rgba(251,191,36,0.15)]'
                : 'border-sf-border bg-sf-raised hover:border-amber-400/30 hover:bg-sf-hover'}
            `}
          >
            <div className={`absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl transition-opacity duration-500 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />

            <div className="relative p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 flex-1">
                  <div className="min-w-0">
                    <h4 className={`text-base font-bold transition-colors ${isSelected ? 'text-sf-warning' : 'text-sf-heading'}`}>
                      {bump.bump_title}
                    </h4>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`
                        inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border
                        ${isSelected
                          ? 'bg-sf-warning-soft text-sf-warning border-sf-border-accent'
                          : 'bg-sf-raised text-sf-body border-sf-border'}
                      `}>
                        {bump.bump_access_duration && bump.bump_access_duration > 0 ? (
                          <>
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {t('daysAccess', { days: bump.bump_access_duration })}
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            {t('lifetimeAccess')}
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:flex-shrink-0">
                  <div className="text-left sm:text-right">
                    {bump.original_price > bump.bump_price && (
                      <div className="text-xs text-sf-muted line-through decoration-sf-muted mb-0.5">
                        {formatPrice(bump.original_price, bump.bump_currency)} {bump.bump_currency}
                      </div>
                    )}
                    <div className={`text-lg font-bold leading-none tracking-tight ${isSelected ? 'text-sf-warning' : 'text-sf-heading'}`}>
                      {formatPrice(bump.bump_price, bump.bump_currency)} {bump.bump_currency}
                    </div>
                    {bump.original_price > bump.bump_price && (
                      <div className="text-[10px] font-bold text-sf-success mt-1 uppercase tracking-wide">
                        {t('saveAmount', { amount: formatPrice(bump.original_price - bump.bump_price, bump.bump_currency) })}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onToggle(bump.bump_product_id)}
                    className={`
                      flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold border transition-all duration-200 active:scale-[0.97]
                      ${isSelected
                        ? 'bg-amber-400 text-slate-900 border-amber-400 hover:bg-amber-300'
                        : 'bg-sf-raised text-sf-heading border-sf-border hover:border-amber-400/50 hover:text-sf-warning'}
                    `}
                  >
                    {isSelected ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {t('addedToOrder')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        {t('addToOrder')}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Urgency countdown timer */}
              {bump.urgency_duration_minutes != null && bump.urgency_duration_minutes > 0 && (() => {
                const elapsedSec = Math.floor((Date.now() - pageLoadTime.current) / 1000);
                const totalSec = bump.urgency_duration_minutes * 60;
                const remainingSec = Math.max(totalSec - elapsedSec, 0);
                if (remainingSec <= 0) return null;
                const mins = Math.floor(remainingSec / 60);
                const secs = remainingSec % 60;
                return (
                  <div className="flex items-center justify-between px-3 py-2 mb-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">
                      {t('specialOfferEnds')}
                    </span>
                    <span className="text-sm font-bold text-red-400 tabular-nums">
                      {mins}m {secs.toString().padStart(2, '0')}s
                    </span>
                  </div>
                );
              })()}

              {bump.bump_description && (
                <p className={`text-sm leading-relaxed transition-colors ${isSelected ? 'text-sf-warning/80' : 'text-sf-muted'}`}>
                  {bump.bump_description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
