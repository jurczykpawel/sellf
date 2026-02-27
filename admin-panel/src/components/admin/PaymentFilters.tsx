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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('status')}
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full sm:w-auto px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('dateRange')}
            </label>
            <select
              value={filters.dateRange}
              onChange={(e) => handleFilterChange('dateRange', e.target.value)}
              className="w-full sm:w-auto px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('search')}
            </label>
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={filters.searchTerm}
              onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
              className="w-full sm:w-64 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
          <button
            onClick={handleReset}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('clear')}
          </button>
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
          >
            🔄 {t('refresh')}
          </button>
          <button
            onClick={exportPayments}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
          >
            📊 {t('exportCsv')}
          </button>
        </div>
      </div>

      {/* Active Filters Display */}
      {(filters.status !== 'all' || filters.searchTerm || filters.dateRange !== '30') && (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">{t('activeFilters')}</span>
          {filters.status !== 'all' && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100">
              {t('statusFilter', { status: filters.status })}
              <button
                onClick={() => handleFilterChange('status', 'all')}
                className="ml-1 text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-100"
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
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100">
              {filters.dateRange === 'all' ? t('rangeFilter', { range: t('allTime') }) : t('rangeFilter', { range: `${filters.dateRange} ${t('days')}` })}
              <button
                onClick={() => handleFilterChange('dateRange', '30')}
                className="ml-1 text-green-600 hover:text-green-800 dark:text-green-300 dark:hover:text-green-100"
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
