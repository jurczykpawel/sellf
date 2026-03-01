'use client';

import React, { useCallback } from 'react';
import { useTranslations } from 'next-intl';

interface FilterOption {
  label: string;
  value: string;
}

interface FilterBarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onAddProduct: () => void;
  onExport: () => void;
  onRefresh: () => void;
  addButtonRef: React.RefObject<HTMLButtonElement | null>;
}

const FilterBar: React.FC<FilterBarProps> = ({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onAddProduct,
  onExport,
  onRefresh,
  addButtonRef,
}) => {
  const t = useTranslations('admin.products');
  
  const statusOptions: FilterOption[] = [
    { label: t('all'), value: 'all' },
    { label: t('active'), value: 'active' },
    { label: t('inactive'), value: 'inactive' }
  ];
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  }, [onSearchChange]);

  return (
    <div className="flex flex-col space-y-2 md:flex-row md:items-center md:justify-between md:space-y-0 md:space-x-2">
      {/* Search */}
      <div className="relative flex-grow max-w-md">
        <svg className="w-5 h-5 text-gf-muted absolute left-3 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder={t('searchPlaceholder')}
          value={searchTerm}
          onChange={handleSearchChange}
          className="pl-10 pr-4 py-2 bg-gf-input border-2 border-gf-border-medium w-full focus:outline-none focus:ring-2 focus:ring-gf-accent focus:border-transparent text-gf-heading placeholder-gf-muted"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Status Filter */}
        <div className="inline-flex items-center">
          <label htmlFor="status-filter" className="mr-2 text-sm text-gf-body hidden sm:inline">
            {t('status')}:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="text-sm bg-gf-input border-2 border-gf-border-medium text-gf-heading focus:ring-gf-accent focus:border-gf-accent py-2 px-3"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center space-x-3">
        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          className="inline-flex items-center px-4 py-2 border-2 border-gf-border-medium text-sm font-medium text-gf-body bg-gf-base hover:bg-gf-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-accent transition-all duration-200"
          title={t('refresh')}
        >
          <svg className="-ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
          <span className="hidden sm:inline">{t('refresh')}</span>
        </button>

        {/* Export Button */}
        <button
          onClick={onExport}
          className="inline-flex items-center px-4 py-2 border border-gf-success/30 text-sm font-medium text-gf-success bg-gf-success-soft hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-success transition-all duration-200"
          title={t('export')}
        >
          <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="hidden sm:inline">{t('export')}</span>
        </button>

        {/* Add Product Button */}
        <button
          ref={addButtonRef}
          onClick={onAddProduct}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium text-white bg-gf-accent-bg hover:bg-gf-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-accent transition-all duration-200"
          title={t('add')}
        >
          <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">{t('add')}</span>
        </button>
      </div>
    </div>
  );
};

export default FilterBar;
