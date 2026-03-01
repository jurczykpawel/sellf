'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

interface UsersFilterBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onRefresh: () => void;
}

const UsersFilterBar: React.FC<UsersFilterBarProps> = ({
  searchTerm,
  onSearchChange,
  onRefresh,
}) => {
  const t = useTranslations('admin.users');
  return (
    <div className="flex flex-col space-y-3 md:flex-row md:items-center md:justify-between md:space-y-0 md:space-x-4 p-4 bg-gf-base">
      <div className="flex-1">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-gf-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="block w-full pl-10 pr-3 py-2 border-2 border-gf-border-medium leading-5 bg-gf-input text-gf-heading placeholder-gf-muted focus:outline-none focus:placeholder-gf-muted focus:ring-2 focus:ring-gf-accent focus:border-gf-accent sm:text-sm transition-all duration-200"
          />
        </div>
      </div>
      <div className="flex-shrink-0">
        <button
          onClick={onRefresh}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium text-white bg-gf-accent-bg hover:bg-gf-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-accent transition-all duration-200 hover:transform hover:scale-105"
          title={t('refresh')}
        >
          <svg className="-ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
          <span>{t('refresh')}</span>
        </button>
      </div>
    </div>
  );
};

export default UsersFilterBar;
