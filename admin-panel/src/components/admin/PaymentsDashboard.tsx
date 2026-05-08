// components/admin/PaymentsDashboard.tsx
// Main payments dashboard for admin panel

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import PaymentStatsCards from './PaymentStatsCards';
import PaymentTransactionsTable from './PaymentTransactionsTable';
import PaymentSessionsTable from './PaymentSessionsTable';
import PaymentFilters from './PaymentFilters';
import type { PaymentTransaction, PaymentSession } from '@/types/payment';
import { api } from '@/lib/api/client';
import CurrencySelector from '@/components/dashboard/CurrencySelector';
import type { CurrencyAmount } from '@/lib/actions/analytics';

interface PaymentStats {
  totalTransactions: number;
  totalRevenue: CurrencyAmount;
  pendingSessions: number;
  refundedAmount: CurrencyAmount;
  todayRevenue: CurrencyAmount;
  thisMonthRevenue: CurrencyAmount;
}

interface PaymentStatsResponse {
  total_transactions: number;
  total_revenue: number;
  pending_count: number;
  refunded_amount: number;
  today_revenue: number;
  this_month_revenue: number;
  total_revenue_by_currency?: CurrencyAmount;
  refunded_amount_by_currency?: CurrencyAmount;
  today_revenue_by_currency?: CurrencyAmount;
  this_month_revenue_by_currency?: CurrencyAmount;
}

function fieldMatchesSearch(value: unknown, searchLower: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(searchLower);
}

export default function PaymentsDashboard() {
  const t = useTranslations('admin.payments');
  const [activeTab, setActiveTab] = useState<'transactions' | 'sessions'>('transactions');
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [sessions, setSessions] = useState<PaymentSession[]>([]);
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: 'all',
    dateRange: '30',
    searchTerm: '',
  });

  // Fetch payment data (all from v1 API)
  const fetchPaymentData = useCallback(async () => {
    setLoading(true);
    try {
      const [transactionsRes, sessionsRes, statsRes] = await Promise.all([
        api.list<PaymentTransaction>('payments', { limit: 500 }),
        fetch('/api/admin/payments/sessions'), // sessions still use old API - no dedicated v1 endpoint
        api.getCustom<PaymentStatsResponse>('payments/stats'),
      ]);

      // Transactions from v1 API
      setTransactions(transactionsRes.data || []);

      // Sessions from old API (embedded checkout doesn't use sessions)
      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json();
        setSessions(sessionsData);
      }

      // Stats from v1 API (getCustom already extracts .data)
      const statsData = statsRes;
      setStats({
        totalTransactions: statsData.total_transactions,
        totalRevenue: statsData.total_revenue_by_currency || {},
        pendingSessions: statsData.pending_count,
        refundedAmount: statsData.refunded_amount_by_currency || {},
        todayRevenue: statsData.today_revenue_by_currency || {},
        thisMonthRevenue: statsData.this_month_revenue_by_currency || {},
      });
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchPaymentData();
  }, [fetchPaymentData, filters.status, filters.dateRange, filters.searchTerm]);

  // Filter transactions based on current filters
  const filteredTransactions = transactions.filter(transaction => {
    if (filters.status !== 'all' && transaction.status !== filters.status) {
      return false;
    }
    
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      return (
        fieldMatchesSearch(transaction.id, searchLower) ||
        fieldMatchesSearch(transaction.user_id, searchLower) ||
        fieldMatchesSearch(transaction.stripe_payment_intent_id, searchLower) ||
        fieldMatchesSearch((transaction as PaymentTransaction & { customer_email?: string | null }).customer_email, searchLower) ||
        fieldMatchesSearch((transaction as PaymentTransaction & { product?: { name?: string | null } }).product?.name, searchLower)
      );
    }
    
    return true;
  });

  // Filter sessions based on current filters
  const filteredSessions = sessions.filter(session => {
    if (filters.status !== 'all' && session.status !== filters.status) {
      return false;
    }
    
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      return (
        fieldMatchesSearch(session.session_id, searchLower) ||
        fieldMatchesSearch(session.customer_email, searchLower)
      );
    }
    
    return true;
  });

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sf-muted">{t('loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sf-heading">
            {t('title')}
          </h1>
          <p className="text-sf-body">
            {t('subtitle')}
          </p>
        </div>
        <CurrencySelector />
      </div>

      {/* Payment Statistics */}
      {stats && <PaymentStatsCards stats={stats} />}

      {/* Filters */}
      <PaymentFilters 
        filters={filters} 
        onFiltersChange={setFilters}
        onRefresh={fetchPaymentData}
      />

      {/* Tabs */}
      <div className="bg-sf-base shadow">
        <div className="border-b border-sf-border">
          <nav className="flex space-x-8 px-6 py-4">
            <button
              onClick={() => setActiveTab('transactions')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'transactions'
                  ? 'border-sf-accent text-sf-accent'
                  : 'border-transparent text-sf-muted hover:text-sf-heading'
              }`}
            >
              {t('transactions.title')} ({filteredTransactions.length})
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sessions'
                  ? 'border-sf-accent text-sf-accent'
                  : 'border-transparent text-sf-muted hover:text-sf-heading'
              }`}
            >
              {t('sessions.title')} ({filteredSessions.length})
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'transactions' ? (
            <PaymentTransactionsTable 
              transactions={filteredTransactions}
              onRefreshData={fetchPaymentData}
            />
          ) : (
            <PaymentSessionsTable 
              sessions={filteredSessions}
              onRefreshData={fetchPaymentData}
            />
          )}
        </div>
      </div>
    </div>
  );
}
