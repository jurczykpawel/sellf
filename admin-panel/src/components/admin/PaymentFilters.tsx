// components/admin/PaymentFilters.tsx
// Payment filters component for admin dashboard

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

// Wait for the seller to stop typing before hitting the server — avoids
// firing a request (and a fresh cursor-reset fetch) on every keystroke.
const SEARCH_DEBOUNCE_MS = 400;

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
  onSearchPendingChange: (pending: boolean) => void;
}

export default function PaymentFilters({ 
  filters, 
  onFiltersChange, 
  onRefresh,
  onSearchPendingChange,
}: PaymentFiltersProps) {
  const t = useTranslations('admin.payments.filters');

  // Local, immediately-updated copy of the search text so typing feels
  // responsive; the parent (and therefore the server request) only hears
  // about it after SEARCH_DEBOUNCE_MS of inactivity.
  const [searchInput, setSearchInput] = useState(filters.searchTerm);

  // Keep the input in sync when the parent resets it externally (Clear
  // filters button, removing the "Search: ..." chip). Adjusting state during
  // render (rather than in a useEffect) is the pattern React recommends for
  // "reset local state when a prop changes" — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [syncedSearchTerm, setSyncedSearchTerm] = useState(filters.searchTerm);
  if (filters.searchTerm !== syncedSearchTerm) {
    setSyncedSearchTerm(filters.searchTerm);
    setSearchInput(filters.searchTerm);
  }

  // Pagination belongs to the applied query, not the still-debouncing input.
  useEffect(() => {
    onSearchPendingChange(searchInput !== filters.searchTerm);
  }, [searchInput, filters.searchTerm, onSearchPendingChange]);

  useEffect(() => {
    if (searchInput === filters.searchTerm) return;
    const timeout = setTimeout(() => {
      onFiltersChange({ ...filters, searchTerm: searchInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput, filters, onFiltersChange]);

  const handleFilterChange = (key: string, value: string) => {
    onFiltersChange({
      ...filters,
      [key]: value,
    });
  };

  const handleReset = () => {
    onFiltersChange({
      status: 'all',
      dateRange: 'all',
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
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        toast.success(t('exportSuccess'));
      } else {
        toast.error(t('exportError'));
      }
    } catch {
      toast.error(t('exportError'));
    }
  };

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium p-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
          {/* Status Filter */}
          <div>
            <label htmlFor="payment-status-filter" className="block text-sm font-medium text-sf-body mb-1">
              {t('status')}
            </label>
            <select
              id="payment-status-filter"
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full sm:w-auto px-3 py-2 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading"
            >
              <option value="all">{t('allStatuses')}</option>
              <option value="pending">{t('pending')}</option>
              <option value="completed">{t('completed')}</option>
              <option value="refunded">{t('refunded')}</option>
              <option value="partially_refunded">{t('partiallyRefunded')}</option>
              <option value="disputed">{t('disputed')}</option>
              <option value="abandoned">{t('abandoned')}</option>
            </select>
          </div>

          {/* Date Range Filter */}
          <div>
            <label htmlFor="payment-date-range-filter" className="block text-sm font-medium text-sf-body mb-1">
              {t('dateRange')}
            </label>
            <select
              id="payment-date-range-filter"
              value={filters.dateRange}
              onChange={(e) => handleFilterChange('dateRange', e.target.value)}
              className="w-full sm:w-auto px-3 py-2 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading"
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
            <label htmlFor="payment-search-filter" className="block text-sm font-medium text-sf-body mb-1">
              {t('search')}
            </label>
            <input
              id="payment-search-filter"
              type="text"
              placeholder={t('searchPlaceholder')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full sm:w-64 px-3 py-2 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent bg-sf-input text-sf-heading"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
          <button
            onClick={handleReset}
            className="px-4 py-2 border-2 border-sf-border-medium text-sf-body hover:bg-sf-hover transition-colors"
          >
            {t('clear')}
          </button>
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-sf-accent-bg hover:bg-sf-accent-hover text-white transition-colors"
          >
            🔄 {t('refresh')}
          </button>
          <button
            onClick={exportPayments}
            className="px-4 py-2 bg-sf-success hover:opacity-90 text-sf-inverse transition-colors"
          >
            📊 {t('exportCsv')}
          </button>
        </div>
      </div>

      {/* Active Filters Display */}
      {(filters.status !== 'all' || filters.searchTerm || filters.dateRange !== 'all') && (
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-sm text-sf-body">{t('activeFilters')}</span>
          {filters.status !== 'all' && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-sf-accent-soft text-sf-accent">
              {t('statusFilter', { status: filters.status })}
              <button
                onClick={() => handleFilterChange('status', 'all')}
                className="ml-1 text-sf-accent hover:opacity-80"
              >
                ×
              </button>
            </span>
          )}
          {filters.searchTerm && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-sf-accent-soft text-sf-accent">
              {t('searchFilter', { term: filters.searchTerm })}
              <button
                onClick={() => handleFilterChange('searchTerm', '')}
                className="ml-1 text-sf-accent hover:text-sf-accent"
              >
                ×
              </button>
            </span>
          )}
          {filters.dateRange !== 'all' && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-sf-success-soft text-sf-success">
              {t('rangeFilter', { range: `${filters.dateRange} ${t('days')}` })}
              <button
                onClick={() => handleFilterChange('dateRange', 'all')}
                className="ml-1 text-sf-success hover:opacity-80"
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
