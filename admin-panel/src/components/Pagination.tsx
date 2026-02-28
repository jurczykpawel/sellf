'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange
}) => {
  const t = useTranslations('common');

  // Don't render pagination if there's only one page
  if (totalPages <= 1) return null;

  // Calculate which page numbers to show
  const getPageNumbers = () => {
    const maxPagesToShow = 5;
    const pages = [];
    
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    
    // Adjust if we're near the end
    if (endPage - startPage + 1 < maxPagesToShow && startPage > 1) {
      startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    
    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <nav className="flex items-center justify-between py-3" aria-label={t('pagination')}>
      <div className="hidden sm:block">
        <p className="text-sm text-gf-body">
          {t('showingPage', { current: currentPage, total: totalPages })}
        </p>
      </div>
      
      <div className="flex flex-1 justify-between sm:justify-end space-x-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={`relative inline-flex items-center rounded-md px-3 py-2 text-sm font-medium
            ${currentPage === 1 
              ? 'bg-gf-raised text-gf-muted cursor-not-allowed'
              : 'bg-gf-base text-gf-body hover:bg-gf-hover'
            }`}
        >
          <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('previous')}
        </button>
        
        <div className="hidden md:flex space-x-1">
          {/* First page if not in range */}
          {pageNumbers[0] > 1 && (
            <>
              <button 
                onClick={() => onPageChange(1)}
                className={`relative inline-flex items-center rounded-md px-3 py-2 text-sm font-medium
                  bg-gf-base text-gf-body hover:bg-gf-hover`}
              >
                1
              </button>
              {pageNumbers[0] > 2 && (
                <span className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gf-muted">
                  ...
                </span>
              )}
            </>
          )}
          
          {/* Page numbers */}
          {pageNumbers.map(page => (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              className={`relative inline-flex items-center rounded-md px-3 py-2 text-sm font-medium
                ${currentPage === page
                  ? 'bg-gf-accent text-gf-inverse'
                  : 'bg-gf-base text-gf-body hover:bg-gf-hover'
                }`}
            >
              {page}
            </button>
          ))}
          
          {/* Last page if not in range */}
          {pageNumbers[pageNumbers.length - 1] < totalPages && (
            <>
              {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                <span className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gf-muted">
                  ...
                </span>
              )}
              <button 
                onClick={() => onPageChange(totalPages)}
                className={`relative inline-flex items-center rounded-md px-3 py-2 text-sm font-medium
                  bg-gf-base text-gf-body hover:bg-gf-hover`}
              >
                {totalPages}
              </button>
            </>
          )}
        </div>
        
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={`relative inline-flex items-center rounded-md px-3 py-2 text-sm font-medium
            ${currentPage === totalPages 
              ? 'bg-gf-raised text-gf-muted cursor-not-allowed'
              : 'bg-gf-base text-gf-body hover:bg-gf-hover'
            }`}
        >
          {t('next')}
          <svg className="h-4 w-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </nav>
  );
};

export default Pagination;
