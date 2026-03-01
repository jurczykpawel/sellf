'use client';

import StatsOverview from '@/components/StatsOverview';
import RecentActivity from '@/components/RecentActivity';
import RevenueChart from '@/components/dashboard/RevenueChart';
import RevenueGoal from '@/components/dashboard/RevenueGoal';
import ProductFilter from '@/components/dashboard/ProductFilter';
import CurrencySelector from '@/components/dashboard/CurrencySelector';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { Eye, EyeOff } from 'lucide-react';

interface DashboardContentProps {
  failedWebhooksCount: number;
}

export default function DashboardContent({ failedWebhooksCount }: DashboardContentProps) {
  const t = useTranslations('admin.dashboard');
  const { hideValues, toggleHideValues } = useUserPreferences();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Page Header */}
      <div className="pt-4 pb-2">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-[40px] font-[800] text-gf-heading tracking-[-0.03em] leading-[1.1]">
              {t('title')}
            </h1>
            <p className="text-gf-muted mt-1 text-base">
              {t('welcome')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={toggleHideValues}
              className="p-2 bg-gf-base border-2 border-gf-border-subtle hover:border-gf-border-medium text-gf-muted transition-colors"
              title={hideValues ? t('showValues') : t('hideValues')}
              aria-label={hideValues ? t('showValues') : t('hideValues')}
            >
              {hideValues ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
            <CurrencySelector />
            <ProductFilter />
          </div>
        </div>
      </div>

      {/* Webhook Failures Alert */}
      {failedWebhooksCount > 0 && (
        <div className="bg-gf-danger-soft border-2 border-gf-danger/30 p-4">
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-gf-danger flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-sm text-gf-danger font-medium">
                {t('webhookFailuresAlert', { count: failedWebhooksCount })}
              </span>
            </div>
            <Link
              href="/dashboard/webhooks"
              className="text-sm font-bold text-gf-danger hover:opacity-80 whitespace-nowrap flex items-center gap-1 transition-colors"
            >
              {t('fixNow')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </Link>
          </div>
        </div>
      )}

      <StatsOverview />

      <RevenueChart />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          <RevenueGoal />

          {/* Quick Actions — full-width stacked buttons */}
          <div className="flex flex-col">
            <Link
              href="/dashboard/products"
              className="flex items-center justify-between px-6 py-5 border-2 border-gf-border-medium hover:border-gf-accent bg-gf-base hover:bg-gf-hover transition-colors group"
            >
              <span className="flex items-center gap-4">
                <span className="w-10 h-10 border-2 border-gf-border-medium flex items-center justify-center text-gf-accent group-hover:border-gf-accent transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </span>
                <span className="font-semibold text-gf-heading">{t('createProduct')}</span>
              </span>
              <svg className="w-5 h-5 text-gf-muted group-hover:text-gf-accent transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </Link>
            <Link
              href="/dashboard/users"
              className="flex items-center justify-between px-6 py-5 border-2 border-t-0 border-gf-border-medium hover:border-gf-accent bg-gf-base hover:bg-gf-hover transition-colors group"
            >
              <span className="flex items-center gap-4">
                <span className="w-10 h-10 border-2 border-gf-border-medium flex items-center justify-center text-gf-accent group-hover:border-gf-accent transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                </span>
                <span className="font-semibold text-gf-heading">{t('manageUsers')}</span>
              </span>
              <svg className="w-5 h-5 text-gf-muted group-hover:text-gf-accent transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </Link>
          </div>
        </div>

        <RecentActivity />
      </div>
    </div>
  );
}