'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getRevenueStats, getRevenueGoal, setRevenueGoal, CurrencyAmount } from '@/lib/actions/analytics';
import { getDefaultCurrency } from '@/lib/actions/shop-config';
import { getExchangeRates } from '@/lib/actions/currency';
import { convertAmount } from '@/lib/utils/currency-conversion';
import { useRealtime } from '@/contexts/RealtimeContext';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
import { useSearchParams } from 'next/navigation';

export default function RevenueGoal() {
  const t = useTranslations('admin.dashboard');
  const tCommon = useTranslations('common');
  const searchParams = useSearchParams();
  const productId = searchParams.get('productId') || undefined;
  const { addRefreshListener, removeRefreshListener } = useRealtime();
  const { hideValues, currencyViewMode, displayCurrency } = useUserPreferences();
  const { convertToSingleCurrency, convertMultipleCurrencies } = useCurrencyConversion();

  const [goal, setGoal] = useState(1000000); // Default $10k in cents
  const [goalCurrency, setGoalCurrency] = useState<string>('USD'); // Currency in which goal is stored
  const [displayGoal, setDisplayGoal] = useState(1000000); // Goal converted to display currency
  // Goal start date determines the period for 'currentRevenue' displayed on the goal bar
  const [goalStartDate, setGoalStartDate] = useState<string | null>(null);
  const [currentRevenue, setCurrentRevenue] = useState(0);
  const [currentRevenueRaw, setCurrentRevenueRaw] = useState<CurrencyAmount>({}); // Store raw multi-currency data
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);

  // Helper to sum all currency amounts to a single number (stable, no dependencies)
  const sumAllCurrencies = useCallback((amounts: CurrencyAmount): number => {
    return Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
  }, []);

  // Fetch both Goal configuration and Current Revenue
  const fetchData = useCallback(async () => {
    try {
      // 1. Get Goal Config from DB
      const goalData = await getRevenueGoal(productId);
      let startDateForStats = undefined;

      if (goalData) {
        setGoal(goalData.amount);
        setGoalCurrency(goalData.currency);
        setGoalStartDate(goalData.startDate);
        startDateForStats = new Date(goalData.startDate);
      } else {
        // No goal set for this context? Use shop default currency
        const defaultCurrency = await getDefaultCurrency();
        setGoal(1000000);
        setGoalCurrency(defaultCurrency);
        setGoalStartDate(null);
      }

      // 2. Get Revenue Stats based on goal start date
      const stats = await getRevenueStats(productId, startDateForStats);
      if (stats) {
        // Store raw multi-currency data
        setCurrentRevenueRaw(stats.totalRevenue);
        // Sum all currencies for the goal comparison (fallback)
        setCurrentRevenue(sumAllCurrencies(stats.totalRevenue));
      }
    } catch (err) {
      console.error('Failed to fetch revenue data', err);
    } finally {
      setLoading(false);
    }
  }, [productId, sumAllCurrencies]);

  // Convert goal and revenue when currency view mode changes
  // OPTIMIZED: Fetch rates ONCE for both conversions
  useEffect(() => {
    async function convertBoth() {
      if (currencyViewMode === 'converted' && displayCurrency) {
        if (!goalCurrency || Object.keys(currentRevenueRaw).length === 0) {
          setDisplayGoal(goal);
          setCurrentRevenue(sumAllCurrencies(currentRevenueRaw));
          return;
        }

        if (displayCurrency === goalCurrency) {
          // Same currency for goal, no conversion needed
          setDisplayGoal(goal);
          // But still convert revenue
          try {
            const converted = await convertToSingleCurrency(currentRevenueRaw, displayCurrency);
            setCurrentRevenue(converted);
          } catch (error) {
            console.error('Error converting revenue:', error);
            setCurrentRevenue(sumAllCurrencies(currentRevenueRaw));
          }
        } else {
          // Different currencies - fetch rates once and convert both
          try {
            const rates = await getExchangeRates(displayCurrency);
            if (!rates) {
              setDisplayGoal(goal);
              setCurrentRevenue(sumAllCurrencies(currentRevenueRaw));
              return;
            }

            // Convert goal locally
            const convertedGoal = Math.round(convertAmount(goal, goalCurrency, displayCurrency, rates));
            setDisplayGoal(convertedGoal);

            // Convert revenue locally
            let total = 0;
            for (const [currency, amount] of Object.entries(currentRevenueRaw)) {
              if (currency === displayCurrency) {
                total += amount;
              } else {
                try {
                  total += convertAmount(amount, currency, displayCurrency, rates);
                } catch (error) {
                  console.error(`Failed to convert ${amount} ${currency}:`, error);
                }
              }
            }
            setCurrentRevenue(Math.round(total));
          } catch (error) {
            console.error('Error converting goal and revenue:', error);
            setDisplayGoal(goal);
            setCurrentRevenue(sumAllCurrencies(currentRevenueRaw));
          }
        }
      } else {
        // Grouped mode: show original values
        setDisplayGoal(goal);
        setCurrentRevenue(sumAllCurrencies(currentRevenueRaw));
      }
    }

    convertBoth();
  }, [goal, goalCurrency, currentRevenueRaw, currencyViewMode, displayCurrency, convertToSingleCurrency, sumAllCurrencies]);

  useEffect(() => {
    // Load goal and start date from local storage (backup/optimistic)
    if (typeof window !== 'undefined') {
        const savedGoal = localStorage.getItem('revenue_goal');
        if (savedGoal) {
          setGoal(parseInt(savedGoal, 10));
        }
        const savedStartDate = localStorage.getItem('revenue_goal_start_date');
        if (savedStartDate) {
          setGoalStartDate(savedStartDate);
        }
    }
    
    fetchData();
    addRefreshListener(fetchData);

    return () => {
      removeRefreshListener(fetchData);
    };
  }, [fetchData, addRefreshListener, removeRefreshListener]);

  const handleSave = async () => {
    const newGoalCents = parseFloat(inputValue) * 100;
    if (isNaN(newGoalCents)) return;

    const startDate = goalStartDate || new Date().toISOString();

    try {
      // Save goal in shop's default currency (or current goal currency if already set)
      const currency = goalCurrency || await getDefaultCurrency();
      const result = await setRevenueGoal(newGoalCents, startDate, currency, productId);
      if (!result.success) {
        console.error('Failed to save goal:', result.error);
        return;
      }
      setGoal(newGoalCents);
      setGoalCurrency(currency);
      setGoalStartDate(startDate);
      setIsEditing(false);
      fetchData();
    } catch (err) {
      console.error('Failed to save goal', err);
    }
  };

  const handleResetGoal = async () => {
    const now = new Date().toISOString();

    try {
      const result = await setRevenueGoal(goal, now, goalCurrency, productId);
      if (!result.success) {
        console.error('Failed to reset goal:', result.error);
        return;
      }
      setGoalStartDate(now);
      setIsEditing(false);
      fetchData();
    } catch (err) {
      console.error('Failed to reset goal', err);
    }
  };

  // Calculate percentage based on displayed values (both in same currency)
  const rawPercentage = displayGoal > 0 ? Math.round((currentRevenue / displayGoal) * 100) : 0;
  const visualPercentage = Math.min(rawPercentage, 100);

  // Determine which currency to use for display
  const activeCurrency = (currencyViewMode === 'converted' && displayCurrency) ? displayCurrency : goalCurrency;

  const formatCurrency = (amount: number) => {
    if (hideValues) return '****';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: activeCurrency,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  if (loading) {
    return (
      <div className="border-[3px] border-sf-border-medium h-[140px] animate-pulse p-6">
        <div className="h-4 bg-sf-raised w-1/3 mb-4"></div>
        <div className="h-8 bg-sf-raised w-full"></div>
      </div>
    );
  }

  return (
    <div className="border-[3px] border-sf-border-medium flex">
      {/* Left panel - percentage */}
      <div className="flex flex-col items-center justify-center px-6 py-6 border-r-[3px] border-sf-border-medium min-w-[120px]">
        <span className={`text-[72px] font-[800] tracking-[-0.04em] leading-none ${
          rawPercentage >= 100 ? 'text-sf-success' : 'text-sf-accent'
        }`}>
          {hideValues ? '**' : rawPercentage}
        </span>
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-sf-muted mt-1">
          %
        </span>
      </div>

      {/* Right panel - details */}
      <div className="flex-1 px-6 py-5 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-sf-muted">
            {t('revenueGoal', { defaultValue: 'Revenue Goal' })}
          </h3>
          {isEditing ? (
            <div className="flex flex-col items-end space-y-1">
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={hideValues ? '****' : (goal / 100).toString()}
                    className="w-24 px-2 py-1 text-sm border-2 border-sf-border-medium bg-sf-base text-sf-heading"
                    autoFocus
                  />
                  <span className="text-xs font-bold text-sf-body">
                    {goalCurrency}
                  </span>
                </div>
                <button
                  onClick={handleSave}
                  className="text-xs bg-sf-accent-bg text-white px-2 py-1 hover:opacity-90"
                >
                  {tCommon('save')}
                </button>
                <button
                  onClick={handleResetGoal}
                  className="text-xs text-sf-muted hover:underline"
                  title={t('resetProgressTitle')}
                >
                  {tCommon('reset')}
                </button>
              </div>
              <span className="text-[10px] text-sf-muted">
                {t('goalCurrencyNote')}
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  setInputValue((goal / 100).toString());
                  setIsEditing(true);
                }}
                className="text-xs text-sf-accent hover:underline font-medium"
              >
                {t('setGoal', { defaultValue: 'Set Goal' })}
              </button>
              {goalStartDate && (
                <span className="text-xs text-sf-muted ml-2">
                  ({t('stats.since', { date: new Date(goalStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })})
                </span>
              )}
            </div>
          )}
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-sf-heading">
              {formatCurrency(currentRevenue)}
            </span>
            <span className="text-sm text-sf-muted">
              / {formatCurrency(displayGoal)}
            </span>
          </div>
          <div className="overflow-hidden h-3 border border-sf-border-medium bg-sf-raised">
            <div
              style={{ width: `${visualPercentage}%` }}
              className={`h-full motion-safe:animate-[progress-fill_0.8s_ease-out_0.3s_both] ${
                rawPercentage >= 100 ? 'bg-sf-success' : 'bg-sf-accent-bg'
              }`}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
