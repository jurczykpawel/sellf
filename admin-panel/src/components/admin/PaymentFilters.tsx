// components/admin/PaymentFilters.tsx
// Payment filters component for admin dashboard

'use client';

import { useTranslations } from 'next-intl';
import { useToast } from '@/contexts/ToastContext';

interface PaymentFiltersProps {
  filters: {
    status: string;
    dateRange: string;
    searchTerm: string;
  };
  onFiltersChange: (filters: {
    status: string;
    dateRange: string;
    searchTerm: string;
  }) => void;
  onRefresh: () => void;
}

export default function PaymentFilters({ 
  filters, 
  onFiltersChange, 
  onRefresh 
}: PaymentFiltersProps) {
  const t = useTranslations('admin.payments.filters');
  const { addToast } = useToast();
  
  const handleFilterChange = (key: string, value: string) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  const handleReset = () => {
    onFiltersChange({
      status: 'all',
      dateRange: '30',
      searchTerm: '',
    });
  };

  const exportPayments = async () => {
    try {
      const response = await fetch('/api/v1/payments/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(filters),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `payments-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        addToast(t('exportSuccess'), 'success');
      } else {
        addToast(t('exportError'), 'error');
      }
    } catch {
      addToast(t('exportError'), 'error');
    }
  };

  return (
    <div className="bg-gf-base rounded-lg shadow p-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gf-body mb-1">
              {t('status')}
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full sm:w-auto px-3 py-2 border border-gf-border rounded-md focus:outline-none focus:ring-2 focus:ring-gf-accent bg-gf-input text-gf-heading"
            >
              <option value="all">{t('allStatuses')}</option>
              <option value="pending">{t('pending')}</option>
              <option value="completed">{t('completed')}</option>
              <option value="failed">{t('failed')}</option>
              <option value="cancelled">{t('cancelled')}</option>
              <option value="refunded">{t('refunded')}</option>
              <option value="disputed">{t('disputed')}</option>
            </select>
          </div>

          {/* Date Range Filter */}
          <div>
            <label className="block text-sm font-medium text-gf-body mb-1">
              {t('dateRange')}
            </label>
            <select
              value={filters.dateRange}
              onChange={(e) => handleFilterChange('dateRange', e.target.value)}
              className="w-full sm:w-auto px-3 py-2 border border-gf-border rounded-md focus:outline-none focus:ring-2 focus:ring-gf-accent bg-gf-input text-gf-heading"
            >
              <option value="7">{t('last7Days')}</option>
              <option value="30">{t('last30Days')}</option>
              <option value="90">{t('last90Days')}</option>
              <option value="365">{t('lastYear')}</option>
              <option value="all">{t('allTime')}</option>
            </select>
          </div>

          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gf-body mb-1">
              {t('search')}
            </label>
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={filters.searchTerm}
              onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
              className="w-full sm:w-64 px-3 py-2 border border-gf-border rounded-md focus:outline-none focus:ring-2 focus:ring-gf-accent bg-gf-input text-gf-heading"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
          <button
            onClick={handleReset}
            className="px-4 py-2 border border-gf-border text-gf-body rounded-md hover:bg-gf-hover transition-colors"
          >
            {t('clear')}
          </button>
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-gf-accent hover:bg-gf-accent-hover text-gf-inverse rounded-md transition-colors"
          >
            🔄 {t('refresh')}
          </button>
          <button
            onClick={exportPayments}
            className="px-4 py-2 bg-gf-success hover:opacity-90 text-gf-inverse rounded-md transition-colors"
          >
            📊 {t('exportCsv')}
          </button>
        </div>
      </div>

      {/* Active Filters Display */}
      {(filters.status !== 'all' || filters.searchTerm || filters.dateRange !== '30') && (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-sm text-gf-body">{t('activeFilters')}</span>
          {filters.status !== 'all' && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gf-accent-soft text-gf-accent">
              {t('statusFilter', { status: filters.status })}
              <button
                onClick={() => handleFilterChange('status', 'all')}
                className="ml-1 text-gf-accent hover:opacity-80"
              >
                ×
              </button>
            </span>
          )}
          {filters.searchTerm && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gf-accent-soft text-gf-accent">
              {t('searchFilter', { term: filters.searchTerm })}
              <button
                onClick={() => handleFilterChange('searchTerm', '')}
                className="ml-1 text-gf-accent hover:text-gf-accent"
              >
                ×
              </button>
            </span>
          )}
          {filters.dateRange !== '30' && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gf-success-soft text-gf-success">
              {filters.dateRange === 'all' ? t('rangeFilter', { range: t('allTime') }) : t('rangeFilter', { range: `${filters.dateRange} ${t('days')}` })}
              <button
                onClick={() => handleFilterChange('dateRange', '30')}
                className="ml-1 text-gf-success hover:opacity-80"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
