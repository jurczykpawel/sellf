'use client';

import { useEffect, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { getSalesChartData, getHourlyRevenueStats, CurrencyAmount } from '@/lib/actions/analytics';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRealtime } from '@/contexts/RealtimeContext';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
import DateRangeFilter from './DateRangeFilter';

type ViewMode = 'daily' | 'hourly';

// Currency colors for the chart
const CURRENCY_COLORS: { [key: string]: string } = {
  'USD': '#3B82F6', // blue
  'EUR': '#10B981', // green
  'GBP': '#00AAFF', // sf-accent
  'PLN': '#F59E0B', // amber
  'CAD': '#EF4444', // red
  'AUD': '#14B8A6', // teal
  'JPY': '#F97316', // orange
};

export default function RevenueChart() {
  const t = useTranslations('admin.dashboard');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const productId = searchParams.get('productId') || undefined;
  const { addRefreshListener, removeRefreshListener } = useRealtime();
  const { hideValues, currencyViewMode, displayCurrency } = useUserPreferences();
  const { convertMultipleCurrencies } = useCurrencyConversion();

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [convertedData, setConvertedData] = useState<any[]>([]);
  const [convertedTotal, setConvertedTotal] = useState<number>(0);

  const [dateRange, setDateRange] = useState<{ start: Date | null, end: Date | null }>({
    start: new Date(new Date().setDate(new Date().getDate() - 30)),
    end: new Date()
  });

  const handleRangeChange = (start: Date | null, end: Date | null) => {
    setDateRange({ start, end });
    if (start && end) {
      setViewMode('daily');
    }
  };

  const setPredefinedRange = (days: number) => {
    if (days === 0) { // "Today" button
      setViewMode('hourly');
      setDateRange({ start: new Date(), end: new Date() }); 
    } else {
      setViewMode('daily');
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - days);
      setDateRange({ start, end });
    }
  };

  // Stable fetch function
  const fetchData = useCallback(async () => {
    try {
      if (viewMode === 'hourly') {
        const hourlyData = await getHourlyRevenueStats(undefined, productId);
        setData(hourlyData);
      } else {
        if (dateRange.start && dateRange.end) {
          const chartData = await getSalesChartData(0, dateRange.start, dateRange.end, productId);
          setData(chartData);
        } else {
          const chartData = await getSalesChartData(30, undefined, undefined, productId);
          setData(chartData);
        }
      }
    } catch (err) {
      console.error('Failed to fetch chart data', err);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [
    viewMode,
    dateRange.start?.getTime(), // Use timestamp instead of Date object
    dateRange.end?.getTime(),   // Use timestamp instead of Date object
    productId
  ]);

  useEffect(() => {
    setLoading(true);
    fetchData();

    addRefreshListener(fetchData);
    return () => {
      removeRefreshListener(fetchData);
    };
  }, [fetchData, addRefreshListener, removeRefreshListener]);

  // Convert data when currency view mode changes or data updates
  // SUPER OPTIMIZED: Fetches rates ONCE, converts ALL locally on client
  useEffect(() => {
    async function convertData() {
      if (currencyViewMode === 'converted' && displayCurrency && data.length > 0) {
        setConverting(true);
        try {
          // Extract amounts array
          const amountsArray = data.map(item => item.amount || {});

          // Convert ALL amounts: 1 server call for rates, rest is local JS
          const convertedAmounts = await convertMultipleCurrencies(amountsArray, displayCurrency);

          // Reconstruct data with converted amounts
          const converted = data.map((item, index) => ({
            [viewMode === 'daily' ? 'date' : 'hour']: viewMode === 'daily' ? item.date : item.hour,
            amount: convertedAmounts[index],
            orders: item.orders
          }));

          setConvertedData(converted);

          // Calculate converted total
          const total = convertedAmounts.reduce((sum, amount) => sum + amount, 0);
          setConvertedTotal(total);
        } catch (error) {
          console.error('Error converting currency data:', error);
          setConvertedData([]);
          setConvertedTotal(0);
        } finally {
          setConverting(false);
        }
      } else {
        setConvertedData([]);
        setConvertedTotal(0);
      }
    }

    convertData();
  }, [data, currencyViewMode, displayCurrency, viewMode, convertMultipleCurrencies]);

  const formatCurrency = (value: number, currency: string = 'USD') => {
    if (hideValues) return '****';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value / 100);
  };

  // Helper to format multi-currency amounts
  const formatMultiCurrency = (amounts: CurrencyAmount) => {
    if (hideValues) return '****';
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

  // Helper to sum multi-currency amounts across all data points
  const sumMultiCurrency = (dataPoints: any[]): CurrencyAmount => {
    const totals: CurrencyAmount = {};
    dataPoints.forEach(point => {
      const amounts = point.amount || {};
      Object.keys(amounts).forEach(currency => {
        totals[currency] = (totals[currency] || 0) + amounts[currency];
      });
    });
    return totals;
  };

  const daysDiff = dateRange.start && dateRange.end
    ? Math.round((dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24))
    : 30;

  // Determine which data to display based on view mode
  const isConverted = currencyViewMode === 'converted' && displayCurrency && convertedData.length > 0;
  const displayData = isConverted ? convertedData : data;

  // Calculate total revenue for the selected period
  const totalRevenue = isConverted
    ? { [displayCurrency!]: convertedTotal }
    : sumMultiCurrency(data);

  // Get all unique currencies present in the data for chart rendering
  const allCurrencies = isConverted
    ? [displayCurrency!]
    : Array.from(new Set(data.flatMap(item => Object.keys(item.amount || {})))).sort();

  // Show skeleton while data loads OR while converting currencies
  // (prevents flash of grouped chart when user has "convert to X" enabled)
  const showSkeleton = loading || (converting && currencyViewMode === 'converted');

  if (showSkeleton) {
    return (
      <div className="border-2 border-sf-border-medium">
        {/* Header skeleton */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-6 pt-6 pb-4 gap-4 border-b border-sf-border-subtle">
          <div className="animate-pulse">
            <div className="h-3 w-24 bg-sf-border-medium rounded mb-2"></div>
            <div className="h-10 w-40 bg-sf-border-medium rounded mb-1"></div>
            <div className="h-3 w-32 bg-sf-border-medium/60 rounded"></div>
          </div>
          <div className="flex gap-1 animate-pulse">
            <div className="h-8 w-14 bg-sf-border-medium rounded"></div>
            <div className="h-8 w-10 bg-sf-border-medium rounded"></div>
            <div className="h-8 w-10 bg-sf-border-medium rounded"></div>
          </div>
        </div>
        {/* Chart area skeleton */}
        <div className="h-[300px] w-full p-6">
          <svg className="w-full h-full" viewBox="0 0 600 240" preserveAspectRatio="none">
            {/* Horizontal grid lines */}
            {[0, 1, 2, 3, 4].map(i => (
              <line
                key={`grid-${i}`}
                x1="40" y1={i * 55 + 10} x2="590" y2={i * 55 + 10}
                stroke="currentColor" className="text-sf-border-medium" strokeDasharray="4 4" strokeWidth="1"
              />
            ))}
            {/* Y-axis labels */}
            {[0, 1, 2, 3, 4].map(i => (
              <rect
                key={`ylabel-${i}`}
                x="4" y={i * 55 + 6} width="28" height="8" rx="2"
                className="fill-sf-border-medium animate-pulse"
              />
            ))}
            {/* X-axis labels */}
            {[0, 1, 2, 3, 4, 5].map(i => (
              <rect
                key={`xlabel-${i}`}
                x={i * 105 + 55} y="232" width="40" height="8" rx="2"
                className="fill-sf-border-medium animate-pulse"
              />
            ))}
            {/* Animated area wave */}
            <path
              d="M40,180 C100,175 140,150 200,120 C260,90 300,100 340,80 C380,60 420,70 460,50 C500,35 540,45 590,30 L590,220 L40,220 Z"
              className="fill-sf-accent/[0.06] animate-pulse"
            />
            <path
              d="M40,180 C100,175 140,150 200,120 C260,90 300,100 340,80 C380,60 420,70 460,50 C500,35 540,45 590,30"
              fill="none" stroke="currentColor" className="text-sf-accent/20 animate-pulse" strokeWidth="2"
            />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="border-2 border-sf-border-medium">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-6 pt-6 pb-4 gap-4 border-b border-sf-border-subtle">
        <div className="flex items-center gap-6">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-sf-muted">
              {viewMode === 'daily'
                ? t('revenueChart.title', { defaultValue: 'Revenue Trend' })
                : t('revenueChart.hourlyTitle', { defaultValue: "Today's Revenue" })}
            </h2>
            <p className="text-[48px] font-[800] text-sf-heading tracking-[-0.04em] leading-none mt-1">
              {formatMultiCurrency(totalRevenue)}
            </p>
            <span className="text-xs text-sf-muted mt-1 block">
              {viewMode === 'daily'
                ? t('revenueChart.subtitle', { days: daysDiff, defaultValue: 'Performance over time' })
                : t('revenueChart.hourlySubtitle', { defaultValue: 'Hourly breakdown' })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0">
            <button
              onClick={() => setPredefinedRange(0)}
              className={`px-3 py-1.5 text-sm font-medium border-2 border-sf-border-medium transition-colors -mr-0.5 ${
                viewMode === 'hourly'
                  ? 'bg-sf-accent-bg text-white border-sf-accent'
                  : 'text-sf-muted hover:text-sf-heading hover:border-sf-border-strong'
              }`}
            >
              {t('revenueChart.periodToday')}
            </button>
            <button
              onClick={() => setPredefinedRange(7)}
              className={`px-3 py-1.5 text-sm font-medium border-2 border-sf-border-medium transition-colors -mr-0.5 ${
                viewMode === 'daily' && dateRange.start && (new Date().getTime() - dateRange.start.getTime()) < 8 * 24 * 3600 * 1000
                  ? 'bg-sf-accent-bg text-white border-sf-accent'
                  : 'text-sf-muted hover:text-sf-heading hover:border-sf-border-strong'
              }`}
            >
              {t('revenueChart.period7d')}
            </button>
            <button
              onClick={() => setPredefinedRange(30)}
              className={`px-3 py-1.5 text-sm font-medium border-2 border-sf-border-medium transition-colors ${
                viewMode === 'daily' && dateRange.start && (new Date().getTime() - dateRange.start.getTime()) > 20 * 24 * 3600 * 1000
                  ? 'bg-sf-accent-bg text-white border-sf-accent'
                  : 'text-sf-muted hover:text-sf-heading hover:border-sf-border-strong'
              }`}
            >
              {t('revenueChart.period30d')}
            </button>
          </div>

          <div className="h-6 w-px bg-sf-border-medium mx-1 hidden sm:block"></div>

          <DateRangeFilter
            startDate={dateRange.start}
            endDate={dateRange.end}
            onChange={handleRangeChange}
          />
        </div>
      </div>

      {(!data || data.length === 0) ? (
        <div className="h-[300px] flex flex-col items-center justify-center text-center px-6">
          <div className="w-16 h-16 bg-sf-raised flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-sf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-sf-heading">{t('revenueChart.noDataTitle')}</h3>
          <p className="text-sm text-sf-muted mt-1 max-w-xs">
            {viewMode === 'daily' ? t('revenueChart.noDataDaily') : t('revenueChart.noDataHourly')}
          </p>
        </div>
      ) : (
        <div className="h-[300px] w-full p-6">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={displayData.map(item => {
                // Transform data to have currencies as separate fields for chart
                const transformed: any = {
                  [viewMode === 'daily' ? 'date' : 'hour']: viewMode === 'daily' ? item.date : item.hour,
                  orders: item.orders
                };

                if (isConverted) {
                  // Converted mode: single amount field
                  transformed[displayCurrency!] = item.amount;
                } else {
                  // Grouped mode: multiple currency fields
                  // IMPORTANT: For stacked areas, ALL currencies must be present in EVERY data point
                  // even if value is 0, otherwise the stack won't render correctly
                  allCurrencies.forEach(currency => {
                    transformed[currency] = item.amount?.[currency] || 0;
                  });
                }

                return transformed;
              })}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                {allCurrencies.map(currency => (
                  <linearGradient key={`gradient-${currency}`} id={`color${currency}`} x1="0" y1="0" x2="0" y2="1">
                    {/* Higher opacity for stacked mode so all currencies are visible */}
                    <stop
                      offset="5%"
                      stopColor={CURRENCY_COLORS[currency] || '#3B82F6'}
                      stopOpacity={!isConverted && allCurrencies.length > 1 ? 0.8 : 0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor={CURRENCY_COLORS[currency] || '#3B82F6'}
                      stopOpacity={!isConverted && allCurrencies.length > 1 ? 0.3 : 0}
                    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis
                dataKey={viewMode === 'daily' ? 'date' : 'hour'}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6B7280', fontSize: 12 }}
                dy={10}
                tickFormatter={(value) => {
                  if (viewMode === 'hourly') return `${value}:00`;
                  const date = new Date(value)
                  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6B7280', fontSize: 12 }}
                tickFormatter={(value) => {
                  // In grouped mode (multiple currencies), show just numbers without currency symbol
                  if (!isConverted && allCurrencies.length > 1) {
                    return new Intl.NumberFormat('en-US', {
                      notation: 'compact',
                      maximumFractionDigits: 0
                    }).format(value / 100);
                  }
                  // In converted mode (single currency), show with currency symbol
                  return formatCurrency(value, allCurrencies[0] || 'USD');
                }}
                width={70}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
                formatter={(value: any, name: string | undefined) => {
                  const numericValue = typeof value === 'number' ? value : 0;
                  const currencyName = name || 'USD';
                  return [formatCurrency(numericValue, currencyName), currencyName];
                }}
                labelFormatter={(label) => {
                  if (viewMode === 'hourly') return t('revenueChart.tooltipHourly', { hour: label, hourEnd: label });
                  return new Date(label).toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                }}
              />
              {/* Legend only in grouped mode with multiple currencies */}
              {!isConverted && allCurrencies.length > 1 && (
                <Legend
                  verticalAlign="top"
                  height={36}
                  iconType="line"
                  formatter={(value) => `${value}`}
                />
              )}
              {allCurrencies.map((currency, index) => (
                <Area
                  key={currency}
                  type="monotone"
                  dataKey={currency}
                  stackId={!isConverted && allCurrencies.length > 1 ? "stack" : undefined}
                  stroke={CURRENCY_COLORS[currency] || '#3B82F6'}
                  strokeWidth={!isConverted && allCurrencies.length > 1 ? 2 : 2}
                  fillOpacity={!isConverted && allCurrencies.length > 1 ? 0.6 : 1}
                  fill={!isConverted && allCurrencies.length > 1 ? CURRENCY_COLORS[currency] || '#3B82F6' : `url(#color${currency})`}
                  name={currency}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}