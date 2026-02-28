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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gf-heading">
            {t('title')}
          </h1>
          <p className="text-gf-body mt-2">
            {t('welcome')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleHideValues}
            className="p-2 bg-gf-base border border-gf-border rounded-lg shadow-sm hover:bg-gf-hover text-gf-muted transition-colors"
            title={hideValues ? t('showValues') : t('hideValues')}
          >
            {hideValues ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
          <CurrencySelector />
          <ProductFilter />
        </div>
      </div>
      
      {/* Webhook Failures Alert */}
      {failedWebhooksCount > 0 && (
        <div className="bg-gf-danger-soft border-l-4 border-gf-danger p-4 rounded-r-lg shadow-sm">
          <div className="flex justify-between items-center">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-gf-danger" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-gf-danger font-medium">
                  {t('webhookFailuresAlert', { count: failedWebhooksCount })}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/webhooks"
              className="text-sm font-bold text-gf-danger hover:opacity-80 whitespace-nowrap ml-4 flex items-center bg-gf-base/50 px-3 py-1.5 rounded-md hover:bg-gf-base/80 transition-colors"
            >
              {t('fixNow')} <span aria-hidden="true" className="ml-1">&rarr;</span>
            </Link>
          </div>
        </div>
      )}

      <StatsOverview />
      
      <RevenueChart />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          <RevenueGoal />
          
          <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
            <h2 className="text-xl font-semibold text-gf-heading mb-4">
              {t('quickActions')}
            </h2>
            <div className="space-y-3">
              <Link
                href="/dashboard/products"
                className="block p-4 rounded-lg bg-gf-accent-soft hover:opacity-80 transition-all"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-gf-accent rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-gf-inverse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-gf-heading">{t('createProduct')}</h3>
                    <p className="text-sm text-gf-muted">{t('createProductDescription')}</p>
                  </div>
                </div>
              </Link>
              
              <Link
                href="/dashboard/users"
                className="block p-4 rounded-lg bg-gf-success-soft hover:opacity-80 transition-all"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-gf-heading">{t('manageUsers')}</h3>
                    <p className="text-sm text-gf-muted">{t('manageUsersDescription')}</p>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </div>
        
        <RecentActivity />
      </div>
    </div>
  );
}