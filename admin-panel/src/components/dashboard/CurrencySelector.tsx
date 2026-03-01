'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { getUsedCurrencies } from '@/lib/actions/currency';
import { Info } from 'lucide-react';

export default function CurrencySelector() {
  const t = useTranslations('common');
  const tCurrency = useTranslations('dashboard.currency');
  const { displayCurrency, setDisplayCurrency, currencyViewMode, setCurrencyViewMode } = useUserPreferences();
  const [isOpen, setIsOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch currencies on mount
  useEffect(() => {
    async function loadCurrencies() {
      try {
        const usedCurrencies = await getUsedCurrencies();
        setCurrencies(usedCurrencies);
      } catch (error) {
        console.error('Error fetching currencies:', error);
      } finally {
        setLoading(false);
      }
    }
    loadCurrencies();
  }, []);

  // Close dropdown when clicking outside
  // IMPORTANT: This useEffect must be called BEFORE any early returns to satisfy Rules of Hooks
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;

      if (!target.isConnected) {
        return;
      }

      const isInsideContainer = containerRef.current && containerRef.current.contains(target as Node);

      if (!isInsideContainer) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Don't render if still loading or only one currency exists
  // MOVED AFTER all hooks to comply with Rules of Hooks
  if (loading || currencies.length <= 1) {
    return null;
  }

  const handleSelect = async (mode: 'grouped' | 'converted', currency: string | null) => {
    try {
      await setCurrencyViewMode(mode);
      await setDisplayCurrency(currency);
      setIsOpen(false);
    } catch (error) {
      console.error('Error updating currency preference:', error);
    }
  };

  // Determine current display label
  const getCurrentLabel = () => {
    if (currencyViewMode === 'grouped') {
      return t('currency.grouped') || 'Grouped by Currency';
    } else {
      return displayCurrency ? `${t('currency.convertTo')} ${displayCurrency}` : t('currency.selectCurrency');
    }
  };

  // Currency symbols map
  const getCurrencySymbol = (currency: string): string => {
    const symbols: { [key: string]: string } = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      PLN: 'zł',
      JPY: '¥',
      CAD: 'C$',
      AUD: 'A$',
    };
    return symbols[currency] || currency;
  };

  return (
    <div className="relative flex items-center gap-1" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 bg-gf-base border-2 border-gf-border-subtle hover:border-gf-border-medium text-sm font-medium text-gf-body hover:bg-gf-hover transition-colors"
      >
        <svg className="w-4 h-4 text-gf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{getCurrentLabel()}</span>
        <svg className={`w-4 h-4 text-gf-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Info tooltip */}
      <div className="relative">
        <button
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="p-1 text-gf-muted hover:text-gf-body transition-colors"
          type="button"
          aria-label={tCurrency('dashboardInfo')}
        >
          <Info className="w-4 h-4" />
        </button>
        {showTooltip && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 px-3 py-2 bg-gf-heading text-gf-inverse text-xs z-50 pointer-events-none">
            {tCurrency('dashboardInfo')}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full w-2 h-2 bg-gf-heading rotate-45 -mb-1"></div>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-[9999] w-56 bg-gf-base border-2 border-gf-border-medium overflow-hidden">
          {/* Grouped option */}
          <button
            onClick={() => handleSelect('grouped', null)}
            className={`w-full text-left px-4 py-3 text-sm hover:bg-gf-hover ${
              currencyViewMode === 'grouped'
                ? 'bg-gf-sidebar-accent text-gf-accent font-medium'
                : 'text-gf-body'
            }`}
          >
            <div className="flex items-center justify-between">
              <span>{t('currency.grouped') || 'Grouped by Currency'}</span>
              {currencyViewMode === 'grouped' && (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </div>
          </button>

          {/* Divider */}
          <div className="border-t border-gf-border"></div>

          {/* Currency conversion options */}
          <div className="py-1">
            <div className="px-4 py-2 text-xs font-medium text-gf-muted uppercase tracking-wider">
              {t('currency.convertTo') || 'Convert to'}
            </div>
            {currencies.sort().map((currency) => (
              <button
                key={currency}
                onClick={() => handleSelect('converted', currency)}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-gf-hover ${
                  currencyViewMode === 'converted' && displayCurrency === currency
                    ? 'bg-gf-sidebar-accent text-gf-accent font-medium'
                    : 'text-gf-body'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center space-x-2">
                    <span className="font-semibold">{getCurrencySymbol(currency)}</span>
                    <span>{currency}</span>
                  </span>
                  {currencyViewMode === 'converted' && displayCurrency === currency && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
