'use client';

import { useEffect, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { getSalesChartData, getHourlyRevenueStats, CurrencyAmount } from '@/lib/actions/analytics';
import { useTranslations } from 'next-intl';
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
  'GBP': '#00AAFF', // gf-accent
  'PLN': '#F59E0B', // amber
  'CAD': '#EF4444', // red
  'AUD': '#14B8A6', // teal
  'JPY': '#F97316', // orange
};

export default function RevenueChart() {
  const t = useTranslations('admin.dashboard');
  const searchParams = useSearchParams();
  const productId = searchParams.get('productId') || undefined;
  const { addRefreshListener, removeRefreshListener } = useRealtime();
  const { hideValues, currencyViewMode, displayCurrency } = useUserPreferences();
  const { convertMultipleCurrencies } = useCurrencyConversion();

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return (
      <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6 h-[400px] animate-pulse">
        <div className="h-6 w-1/3 bg-gf-raised rounded mb-4"></div>
        <div className="h-full bg-gf-raised rounded"></div>
      </div>
    );
  }

  return (
    <div className="bg-gf-base rounded-xl shadow-sm border border-gf-border p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-6">
          <div>
            <h2 className="text-xl font-semibold text-gf-heading">
              {viewMode === 'daily'
                ? t('revenueChart.title', { defaultValue: 'Revenue Trend' })
                : t('revenueChart.hourlyTitle', { defaultValue: "Today's Revenue" })}
            </h2>
            <p className="text-sm text-gf-muted">
              {viewMode === 'daily'
                ? t('revenueChart.subtitle', { days: daysDiff, defaultValue: 'Performance over time' })
                : t('revenueChart.hourlySubtitle', { defaultValue: 'Hourly breakdown' })}
            </p>
          </div>
          <div className="hidden sm:block h-12 w-px bg-gf-border"></div>
          <div className="flex flex-col">
            <div className="text-2xl font-bold text-gf-heading">
              {formatMultiCurrency(totalRevenue)}
            </div>
            <span className="text-xs text-gf-muted">
              total revenue
            </span>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-gf-raised rounded-lg p-1">
            <button
              onClick={() => setPredefinedRange(0)}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'hourly'
                  ? 'bg-gf-base text-gf-heading shadow-sm'
                  : 'text-gf-muted hover:text-gf-heading'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setPredefinedRange(7)}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'daily' && dateRange.start && (new Date().getTime() - dateRange.start.getTime()) < 8 * 24 * 3600 * 1000
                  ? 'bg-gf-base text-gf-heading shadow-sm'
                  : 'text-gf-muted hover:text-gf-heading'
              }`}
            >
              7d
            </button>
            <button
              onClick={() => setPredefinedRange(30)}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'daily' && dateRange.start && (new Date().getTime() - dateRange.start.getTime()) > 20 * 24 * 3600 * 1000
                  ? 'bg-gf-base text-gf-heading shadow-sm'
                  : 'text-gf-muted hover:text-gf-heading'
              }`}
            >
              30d
            </button>
          </div>
          
          <div className="h-6 w-px bg-gf-border mx-1 hidden sm:block"></div>
          
          <DateRangeFilter 
            startDate={dateRange.start} 
            endDate={dateRange.end} 
            onChange={handleRangeChange} 
          />
        </div>
      </div>

      {(!data || data.length === 0) ? (
        <div className="h-[300px] flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-gf-raised rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gf-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gf-heading">No Revenue Data Yet</h3>
          <p className="text-sm text-gf-muted mt-1 max-w-xs">
            {viewMode === 'daily' ? 'Once you start making sales, your revenue trend will appear here.' : 'No sales recorded today yet.'}
          </p>
        </div>
      ) : (
        <div className="h-[300px] w-full">
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
                  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
                  if (viewMode === 'hourly') return `Today, ${label}:00 - ${label}:59`;
                  return new Date(label).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
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