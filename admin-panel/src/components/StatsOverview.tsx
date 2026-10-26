'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { formatRelativeTime } from '@/lib/utils/relative-time';
import { formatPrice } from '@/lib/constants';
import { useSearchParams } from 'next/navigation';
import { isExpectedApiError } from '@/lib/api/client';
import { readDashboard } from '@/lib/api/dashboard-reads';
import type { RevenueStats, CurrencyAmount } from '@/lib/actions/analytics';
import { useRealtime } from '@/contexts/RealtimeContext';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
import NewOrderNotification from './dashboard/NewOrderNotification';

import { fromMinorUnits } from '@/lib/currency/minor-units';
interface DashboardStats {
  totalProducts: number;
  totalUsers: number;
  totalAccess: number;
  activeUsers: number;
  totalRevenue: number;
}

interface NewOrder {
  amount: number;
  currency: string;
  id: string; // unique ID to force re-render
}

export default function StatsOverview() {
  const t = useTranslations('admin.dashboard');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const productId = searchParams.get('productId') || undefined;
  const { addRefreshListener, removeRefreshListener } = useRealtime();
  const { hideValues, currencyViewMode, displayCurrency } = useUserPreferences();
  const { convertMultipleCurrencies } = useCurrencyConversion();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [revenueStats, setRevenueStats] = useState<RevenueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [newOrder, setNewOrder] = useState<NewOrder | null>(null); // State to trigger notification
  const [convertedRevenue, setConvertedRevenue] = useState<{ total: number; today: number } | null>(null);

  // Store previous order time to detect new orders for notification purposes
  const prevLastOrderTimeRef = useRef<string | null>(null);
  const prevTotalRevenueRef = useRef<CurrencyAmount>({}); // Track previous revenue using ref to avoid dependency loop
  const isInitialLoadRef = useRef(true);

  const statsRequest = useRef(0);
  // Keep the fetch callback independent of revenueStats to avoid repeated fetching.
  const fetchAllStats = useCallback(async (signal?: AbortSignal) => {
    const request = ++statsRequest.current;
    try {
      const [dashboardData, revenueData] = await Promise.all([
        readDashboard<DashboardStats | null>('overview', {}, signal), // Currently global
        readDashboard<RevenueStats | null>('stats', { productId }, signal), // Filtered by product
      ]);

      if (request !== statsRequest.current) return;
      if (dashboardData) setStats(dashboardData);
      if (revenueData) {
        setRevenueStats(revenueData);

        // Trigger notification if a new order has arrived AND it's not the initial load
        if (!isInitialLoadRef.current && prevLastOrderTimeRef.current && revenueData.lastOrderAt && revenueData.lastOrderAt !== prevLastOrderTimeRef.current) {
           // First currency whose revenue increased is the currency of the new order.
           let detectedCurrency = 'USD';
           let newMinor = 0;
           for (const currency in revenueData.totalRevenue) {
             const current = revenueData.totalRevenue[currency] || 0;
             const previous = prevTotalRevenueRef.current[currency] || 0;
             if (current > previous) {
               detectedCurrency = currency;
               newMinor = current - previous;
               break;
             }
           }
           const newAmount = fromMinorUnits(newMinor, detectedCurrency);

           if (newAmount > 0) {
           setNewOrder({
               amount: newAmount,
               currency: detectedCurrency,
               id: Date.now().toString()
             });
           }
        }

        if (revenueData.lastOrderAt) {
          prevLastOrderTimeRef.current = revenueData.lastOrderAt;
        }
        // Update ref with current revenue for next comparison
        prevTotalRevenueRef.current = revenueData.totalRevenue;
      }
    } catch (err) {
      if (request === statsRequest.current && !isExpectedApiError(err)) console.error('[StatsOverview] Failed to fetch stats:', err);
    } finally {
      if (request === statsRequest.current) {
        setLoading(false);
        isInitialLoadRef.current = false;
      }
    }
  }, [productId]);

  const [previousProductId, setPreviousProductId] = useState(productId);
  if (previousProductId !== productId) {
    setPreviousProductId(productId);
    setLoading(true);
  }

  useEffect(() => {
    const requestState = statsRequest;
    const controller = new AbortController();
    const load = () => { void fetchAllStats(controller.signal); };
    // Initial fetch
    load();

    // Register listener for global refresh events
    addRefreshListener(load);

    return () => {
      requestState.current++;
      controller.abort();
      removeRefreshListener(load);
    };
  }, [addRefreshListener, removeRefreshListener, fetchAllStats]); // fetchAllStats depends on productId

  // Convert revenue when currency view mode changes
  // OPTIMIZED: Uses convertMultipleCurrencies to fetch rates ONCE
  useEffect(() => {
    let cancelled = false;
    async function convertRevenue() {
      if (currencyViewMode === 'converted' && displayCurrency && revenueStats) {
        try {
          // Convert both totals with ONE rates fetch
          const [totalConverted, todayConverted] = await convertMultipleCurrencies(
            [revenueStats.totalRevenue, revenueStats.todayRevenue],
            displayCurrency
          );
          if (!cancelled) setConvertedRevenue({ total: totalConverted, today: todayConverted });
        } catch (error) {
          if (cancelled) return;
          if (!isExpectedApiError(error)) console.error('Error converting revenue:', error);
          setConvertedRevenue(null);
        }
      } else {
        setConvertedRevenue(null);
      }
    }

    convertRevenue();
    return () => { cancelled = true; };
  }, [revenueStats, currencyViewMode, displayCurrency, convertMultipleCurrencies]);

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    if (hideValues) return '****';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(fromMinorUnits(amount, currency));
  };

  // Helper to format multi-currency amounts (or converted single currency)
  const formatMultiCurrency = (amounts: CurrencyAmount, convertedAmount?: number) => {
    if (hideValues) return '****';

    // If in converted mode and we have a converted amount, show that
    if (currencyViewMode === 'converted' && displayCurrency && convertedAmount !== undefined) {
      return formatCurrency(convertedAmount, displayCurrency);
    }

    // Otherwise show grouped currencies
    const currencies = Object.keys(amounts);
    if (currencies.length === 0) return formatCurrency(0);
    if (currencies.length === 1) {
      const currency = currencies[0];
      return formatCurrency(amounts[currency], currency);
    }
    // Multiple currencies - show them all
    return currencies
      .sort() // Sort for consistency
      .map(currency => formatCurrency(amounts[currency], currency))
      .join(' + ');
  };

  const formatNumber = (num: number) => {
    if (hideValues) return '****';
    return num.toLocaleString(locale);
  };

  const timeAgo = (value: string | null) => value ? formatRelativeTime(value, locale) : null;

  const statItems = [
    {
      id: 'total-revenue',
      name: t('stats.totalRevenue', { defaultValue: 'Total Revenue' }),
      helper: t('stats.revenueScope', { scope: productId ? t('stats.selectedProduct') : t('stats.allProducts') }) + ' · ' + (currencyViewMode === 'converted' && displayCurrency && convertedRevenue ? t('stats.convertedTo', { currency: displayCurrency }) : t('stats.originalCurrencies')),
      value: formatMultiCurrency(revenueStats?.totalRevenue ?? {}, convertedRevenue?.total),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'from-green-500 to-green-600',
      bgColor: 'bg-sf-success-soft',
      change: revenueStats && Object.keys(revenueStats.todayRevenue).length > 0 ? t('stats.todayChange', { amount: formatMultiCurrency(revenueStats.todayRevenue, convertedRevenue?.today) }) : null,
      changeType: 'positive'
    },
    {
      id: 'today-orders',
      name: t('stats.todayOrders', { defaultValue: "Today's Orders" }),
      value: formatNumber(revenueStats?.todayOrders ?? 0),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      ),
      color: 'from-blue-500 to-blue-600',
      bgColor: 'bg-sf-accent-soft',
      change: revenueStats?.lastOrderAt ? t('stats.lastOrder', { time: timeAgo(revenueStats.lastOrderAt) ?? '' }) : null,
    },
    {
      id: 'total-users',
      name: t('totalUsers'),
      value: formatNumber(stats?.totalUsers ?? 0),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      ),
      color: 'bg-sf-accent-bg',
      bgColor: 'bg-sf-accent-soft',
    },
    {
      id: 'active-users',
      name: t('activeUsers'),
      value: formatNumber(stats?.activeUsers ?? 0),
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      color: 'from-yellow-500 to-yellow-600',
      bgColor: 'bg-sf-warning-soft',
    },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-2 border-sf-border-medium">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`p-6 sm:p-8 ${i < 3 ? 'lg:border-r border-sf-border-subtle' : ''} ${i % 2 === 1 ? 'bg-sf-row-alt' : 'bg-sf-base'} border-b-[3px] border-sf-border-medium`}>
            <div className="animate-pulse">
              <div className="h-3 bg-sf-raised w-3/4 mb-4"></div>
              <div className="h-12 bg-sf-raised w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {newOrder && (
        <NewOrderNotification
          key={newOrder.id}
          amount={formatPrice(newOrder.amount, newOrder.currency, locale)}
          currency={newOrder.currency}
          onClose={() => setNewOrder(null)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-2 border-sf-border-medium">
        {statItems.map((item, index) => (
          <div
            key={item.id}
            data-testid={`stat-card-${item.id}`}
            className={`p-6 sm:p-8 ${
              index < statItems.length - 1 ? 'lg:border-r border-sf-border-subtle' : ''
            } ${
              index % 2 === 1 ? 'bg-sf-row-alt' : 'bg-sf-base'
            } border-b-[3px] border-sf-border-medium`}
          >
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-sf-muted mb-2">
              {item.name}
            </p>
            <p
              className="text-[52px] font-[800] text-sf-heading tracking-[-0.04em] leading-none motion-safe:animate-[stat-slide-up_0.6s_ease-out_both]"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {item.value}
            </p>
            {item.helper && <p className="text-xs text-sf-muted mt-2">{item.helper}</p>}
            {item.change && (
              <p className={`text-xs font-medium mt-2 ${item.changeType === 'positive' ? 'text-sf-success' : 'text-sf-muted'}`}>
                {item.change}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
