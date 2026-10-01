'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { getUsedCurrencies } from '@/lib/actions/currency';
import { Info } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

export default function CurrencySelector() {
  const t = useTranslations('common');
  const tCurrency = useTranslations('dashboard.currency');
  const { displayCurrency, currencyViewMode, setCurrencyPreferences } = useUserPreferences();
  const [isOpen, setIsOpen] = useState(false);
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

  const handleSelect = (mode: 'grouped' | 'converted', currency: string | null) => {
    // Close immediately — the dropdown reflects the user's choice, not the save's
    // network state. Awaiting the save first (as this used to) left the dropdown
    // logically "open" for the duration of the save; a second click on the toggle
    // button during that window (e.g. an impatient user opening it again) would
    // then flip it straight back closed instead of opening a fresh menu.
    // setCurrencyPreferences handles its own errors (logs + reverts optimistic
    // state), so this call is intentionally not awaited or caught here.
    setIsOpen(false);
    setCurrencyPreferences(mode, currency);
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
        className="flex items-center space-x-2 px-3 py-2 bg-sf-base border-2 border-sf-border-subtle hover:border-sf-border-medium text-sm font-medium text-sf-body hover:bg-sf-hover transition-colors"
      >
        <svg className="w-4 h-4 text-sf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{getCurrentLabel()}</span>
        <svg className={`w-4 h-4 text-sf-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Info tooltip */}
      <Tooltip
        content={tCurrency('dashboardInfo')}
        side="bottom"
        className="w-64 px-3 py-2 bg-sf-heading text-sf-inverse text-xs z-50"
        arrowClassName="fill-sf-heading"
      >
        <button
          className="p-1 text-sf-muted hover:text-sf-body transition-colors"
          type="button"
          aria-label={tCurrency('dashboardInfo')}
        >
          <Info className="w-4 h-4" />
        </button>
      </Tooltip>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-[9999] w-56 bg-sf-base border-2 border-sf-border-medium overflow-hidden">
          {/* Grouped option */}
          <button
            onClick={() => handleSelect('grouped', null)}
            className={`w-full text-left px-4 py-3 text-sm hover:bg-sf-hover ${
              currencyViewMode === 'grouped'
                ? 'bg-sf-sidebar-accent text-sf-accent font-medium'
                : 'text-sf-body'
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
          <div className="border-t border-sf-border"></div>

          {/* Currency conversion options */}
          <div className="py-1">
            <div className="px-4 py-2 text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('currency.convertTo') || 'Convert to'}
            </div>
            {currencies.sort().map((currency) => (
              <button
                key={currency}
                onClick={() => handleSelect('converted', currency)}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-sf-hover ${
                  currencyViewMode === 'converted' && displayCurrency === currency
                    ? 'bg-sf-sidebar-accent text-sf-accent font-medium'
                    : 'text-sf-body'
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
