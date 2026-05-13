// components/admin/PaymentStatsCards.tsx
// Payment statistics cards for admin dashboard

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, DollarSign, Receipt, RotateCcw, TrendingUp, WalletCards } from 'lucide-react';
import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import type { CurrencyAmount } from '@/lib/actions/analytics';

interface PaymentStats {
  totalTransactions: number;
  totalRevenue: CurrencyAmount;
  pendingSessions: number;
  refundedAmount: CurrencyAmount;
  todayRevenue: CurrencyAmount;
  thisMonthRevenue: CurrencyAmount;
}

interface PaymentStatsCardsProps {
  stats: PaymentStats;
}

export default function PaymentStatsCards({ stats }: PaymentStatsCardsProps) {
  const t = useTranslations('admin.payments.stats');
  const { currencyViewMode, displayCurrency } = useUserPreferences();
  const { convertMultipleCurrencies } = useCurrencyConversion();
  const [convertedAmounts, setConvertedAmounts] = useState<{
    totalRevenue: number;
    todayRevenue: number;
    thisMonthRevenue: number;
    refundedAmount: number;
  } | null>(null);
  
  useEffect(() => {
    let cancelled = false;

    async function convertStats() {
      if (currencyViewMode !== 'converted' || !displayCurrency) {
        setConvertedAmounts(null);
        return;
      }

      const [totalRevenue, todayRevenue, thisMonthRevenue, refundedAmount] =
        await convertMultipleCurrencies([
          stats.totalRevenue,
          stats.todayRevenue,
          stats.thisMonthRevenue,
          stats.refundedAmount,
        ], displayCurrency);

      if (!cancelled) {
        setConvertedAmounts({ totalRevenue, todayRevenue, thisMonthRevenue, refundedAmount });
      }
    }

    convertStats().catch((error) => {
      console.error('[PaymentStatsCards] Currency conversion failed:', error);
      if (!cancelled) setConvertedAmounts(null);
    });

    return () => {
      cancelled = true;
    };
  }, [stats, currencyViewMode, displayCurrency, convertMultipleCurrencies]);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount / 100);
  };

  const formatMultiCurrency = useCallback((amounts: CurrencyAmount, convertedAmount?: number) => {
    if (currencyViewMode === 'converted' && displayCurrency && convertedAmount !== undefined) {
      return formatCurrency(convertedAmount, displayCurrency);
    }

    const currencies = Object.keys(amounts);
    if (currencies.length === 0) return formatCurrency(0, displayCurrency || 'USD');
    return currencies
      .sort()
      .map((currency) => formatCurrency(amounts[currency], currency))
      .join(' + ');
  }, [currencyViewMode, displayCurrency]);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const statsCards = [
    {
      title: t('totalRevenue'),
      value: formatMultiCurrency(stats.totalRevenue, convertedAmounts?.totalRevenue),
      icon: DollarSign,
      color: 'bg-green-500',
      helper: t('grossCompleted', { defaultValue: 'Completed payments, gross' }),
    },
    {
      title: t('totalTransactions'),
      value: formatNumber(stats.totalTransactions),
      icon: Receipt,
      color: 'bg-blue-500',
      helper: t('completedTransactions', { defaultValue: 'Completed transactions' }),
    },
    {
      title: t('todayRevenue'),
      value: formatMultiCurrency(stats.todayRevenue, convertedAmounts?.todayRevenue),
      icon: TrendingUp,
      color: 'bg-sf-accent-bg',
      helper: t('completedToday', { defaultValue: 'Completed today' }),
    },
    {
      title: t('pendingSessions'),
      value: formatNumber(stats.pendingSessions),
      icon: WalletCards,
      color: 'bg-yellow-500',
      helper: stats.pendingSessions > 0
        ? t('awaitingPayment', { defaultValue: 'Awaiting completion' })
        : t('nonePending', { defaultValue: 'No pending payments' }),
    },
    {
      title: t('thisMonthRevenue'),
      value: formatMultiCurrency(stats.thisMonthRevenue, convertedAmounts?.thisMonthRevenue),
      icon: CreditCard,
      color: 'bg-indigo-500',
      helper: t('completedThisMonth', { defaultValue: 'Completed this month' }),
    },
    {
      title: t('refundedAmount'),
      value: formatMultiCurrency(stats.refundedAmount, convertedAmounts?.refundedAmount),
      icon: RotateCcw,
      color: 'bg-red-500',
      helper: t('totalRefunds', { defaultValue: 'Recorded refunds' }),
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {statsCards.map((card, index) => {
        const Icon = card.icon;
        return (
        <div key={index} className="bg-sf-base shadow p-6">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-sf-body">
                {card.title}
              </p>
              <p className="text-xl font-semibold text-sf-heading mt-1 break-words">
                {card.value}
              </p>
            </div>
            <div className={`w-12 h-12 ${card.color} flex items-center justify-center text-white text-xl`}>
              <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-4 flex items-center">
            <span className="text-sm text-sf-muted">{card.helper}</span>
          </div>
        </div>
        );
      })}
    </div>
  );
}
