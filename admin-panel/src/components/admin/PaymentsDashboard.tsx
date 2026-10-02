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
import { fetchPaymentTransactionsPage, dateRangeToDateFrom } from '@/lib/payments/fetch-transactions-page';
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
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false);
  const [transactionsCursor, setTransactionsCursor] = useState<string | null>(null);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  // dateRange defaults to 'all', not a narrower window: before this filter was
  // wired to the server it was decorative, so sellers always effectively saw
  // every payment. A narrower default would be a silent behavior change —
  // payments outside the window would vanish on open, and server-side search
  // (see da177bb9) would stop finding an older payment unless the seller
  // first widened the range. A seller now opts into a narrower window
  // explicitly via the dropdown.
  const [filters, setFilters] = useState({
    status: 'all',
    dateRange: 'all',
    searchTerm: '',
  });

  // Fetch payment data (all from v1 API). Transactions are paged (see
  // fetchPaymentTransactionsPage) — the seller's full payment history can
  // grow without bound, so only the first page loads here; "Load more"
  // fetches subsequent pages via handleLoadMoreTransactions below instead of
  // pulling everything into the browser at once. Status, search, and date
  // range are sent to the server on every (re)fetch so a match beyond the
  // first page is still found — filtering only the already-loaded page would
  // silently miss older transactions. Stats intentionally ignore these
  // filters: each stat card already names its own fixed period (today, this
  // month, all-time total/refunded), independent of the dashboard filter bar.
  const fetchPaymentData = useCallback(async () => {
    setLoading(true);
    try {
      const [transactionsPage, sessionsRes, statsRes] = await Promise.all([
        fetchPaymentTransactionsPage(undefined, {
          status: filters.status,
          search: filters.searchTerm,
          dateRange: filters.dateRange,
        }),
        fetch('/api/admin/payments/sessions'), // sessions still use old API - no dedicated v1 endpoint
        api.getCustom<PaymentStatsResponse>('payments/stats'),
      ]);

      // First page of transactions from v1 API
      setTransactions(transactionsPage.transactions);
      setTransactionsCursor(transactionsPage.nextCursor);
      setHasMoreTransactions(transactionsPage.hasMore);

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
  }, [filters.status, filters.searchTerm, filters.dateRange, t]);

  // Continues the SAME status/search/date-range-filtered result set the
  // current page came from — not a fresh, unfiltered fetch.
  const handleLoadMoreTransactions = useCallback(async () => {
    if (!hasMoreTransactions || loading || loadingMoreTransactions || searchPending) return;

    setLoadingMoreTransactions(true);
    try {
      const nextPage = await fetchPaymentTransactionsPage(transactionsCursor ?? undefined, {
        status: filters.status,
        search: filters.searchTerm,
        dateRange: filters.dateRange,
      });
      setTransactions(prev => [...prev, ...nextPage.transactions]);
      setTransactionsCursor(nextPage.nextCursor);
      setHasMoreTransactions(nextPage.hasMore);
    } catch {
      toast.error(t('moreLoadError'));
    } finally {
      setLoadingMoreTransactions(false);
    }
  }, [hasMoreTransactions, loading, loadingMoreTransactions, searchPending, transactionsCursor, filters.status, filters.searchTerm, filters.dateRange, t]);

  useEffect(() => {
    fetchPaymentData();
  }, [fetchPaymentData, filters.status, filters.dateRange, filters.searchTerm]);

  // Status and search are now applied server-side (see fetchPaymentData /
  // handleLoadMoreTransactions) so a match beyond the currently loaded page
  // is still found. `transactions` already reflects the active filters.

  // Filter sessions based on current filters. Sessions come from the legacy
  // (non-paginated) endpoint and are always loaded in full, so filtering
  // them client-side — including by date range, using the same day-count
  // cutoff as the transactions tab — is still correct.
  const sessionsDateFrom = dateRangeToDateFrom(filters.dateRange);
  const filteredSessions = sessions.filter(session => {
    if (filters.status !== 'all' && session.status !== filters.status) {
      return false;
    }

    if (sessionsDateFrom && session.created_at < sessionsDateFrom) {
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
        onSearchPendingChange={setSearchPending}
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
              {t('transactions.title')} ({transactions.length})
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
            <>
              <PaymentTransactionsTable
                transactions={transactions}
                onRefreshData={fetchPaymentData}
              />
              {hasMoreTransactions && (
                <div className="flex justify-center pt-4">
                  <button
                    type="button"
                    onClick={handleLoadMoreTransactions}
                    disabled={loading || loadingMoreTransactions || searchPending}
                    className="px-4 py-2 text-sm font-medium text-sf-accent border border-sf-border rounded-md hover:bg-sf-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loadingMoreTransactions ? t('loadingMore') : t('loadMore')}
                  </button>
                </div>
              )}
            </>
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
