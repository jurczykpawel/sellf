// components/admin/PaymentsDashboard.tsx
// Main payments dashboard for admin panel

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/contexts/ToastContext';
import PaymentStatsCards from './PaymentStatsCards';
import PaymentTransactionsTable from './PaymentTransactionsTable';
import PaymentSessionsTable from './PaymentSessionsTable';
import PaymentFilters from './PaymentFilters';
import type { PaymentTransaction, PaymentSession } from '@/types/payment';
import { api } from '@/lib/api/client';

interface PaymentStats {
  totalTransactions: number;
  totalRevenue: number;
  pendingSessions: number;
  refundedAmount: number;
  todayRevenue: number;
  thisMonthRevenue: number;
}

export default function PaymentsDashboard() {
  const t = useTranslations('admin.payments');
  const { addToast } = useToast();
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
        api.getCustom<{ total_transactions: number; total_revenue: number; pending_count: number; refunded_amount: number; today_revenue: number; this_month_revenue: number }>('payments/stats'),
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
        totalRevenue: statsData.total_revenue,
        pendingSessions: statsData.pending_count,
        refundedAmount: statsData.refunded_amount,
        todayRevenue: statsData.today_revenue,
        thisMonthRevenue: statsData.this_month_revenue,
      });
    } catch {
      addToast(t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

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
        transaction.id.toLowerCase().includes(searchLower) ||
        transaction.user_id.toLowerCase().includes(searchLower) ||
        transaction.stripe_payment_intent_id?.toLowerCase().includes(searchLower)
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
        session.session_id.toLowerCase().includes(searchLower) ||
        session.customer_email.toLowerCase().includes(searchLower)
      );
    }
    
    return true;
  });

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gf-muted">{t('loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gf-heading">
          {t('title')}
        </h1>
        <p className="text-gf-body">
          {t('subtitle')}
        </p>
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
      <div className="bg-gf-base rounded-lg shadow">
        <div className="border-b border-gf-border">
          <nav className="flex space-x-8 px-6 py-4">
            <button
              onClick={() => setActiveTab('transactions')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'transactions'
                  ? 'border-gf-accent text-gf-accent'
                  : 'border-transparent text-gf-muted hover:text-gf-heading'
              }`}
            >
              {t('transactions.title')} ({filteredTransactions.length})
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sessions'
                  ? 'border-gf-accent text-gf-accent'
                  : 'border-transparent text-gf-muted hover:text-gf-heading'
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
