'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslations } from 'next-intl';
import DashboardLayout from '@/components/DashboardLayout';
import type { UserPurchase } from '@/types';

const formatPrice = (price: number | null, currency: string | null = 'USD', naLabel = 'N/A', invalidLabel = 'Invalid Price') => {
  if (price === null) return naLabel;
  const numericPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numericPrice)) return invalidLabel;

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(numericPrice);
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export default function MyPurchasesPage() {
  const { user, loading: authLoading } = useAuth();
  const t = useTranslations('myPurchases');
  const [purchases, setPurchases] = useState<UserPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<UserPurchase | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchPurchases = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const supabase = await createClient();

      const { data, error: fetchError } = await supabase
        .rpc('get_user_purchases_with_refund_status');

      if (fetchError) throw fetchError;

      // Filter out incomplete transactions (pending/abandoned should not show as purchases)
      setPurchases((data || []).filter((p: UserPurchase) =>
        p.status !== 'pending' && p.status !== 'abandoned'
      ));
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load purchases.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      fetchPurchases();
    }
  }, [authLoading, fetchPurchases]);

  const openRefundModal = (purchase: UserPurchase) => {
    setSelectedPurchase(purchase);
    setRefundReason('');
    setRefundModalOpen(true);
  };

  const submitRefundRequest = async () => {
    if (!selectedPurchase) return;

    try {
      setSubmitting(true);
      const supabase = await createClient();

      const { data, error: rpcError } = await supabase
        .rpc('create_refund_request', {
          transaction_id_param: selectedPurchase.transaction_id,
          reason_param: refundReason || null,
        });

      if (rpcError) throw rpcError;

      if (data && !data.success) {
        throw new Error(data.error || 'Failed to submit refund request');
      }

      // Close modal and refresh
      setRefundModalOpen(false);
      setSelectedPurchase(null);
      await fetchPurchases();
    } catch (err) {
      const error = err as Error;
      alert(error.message || t('refundSubmitError'));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (purchase: UserPurchase) => {
    if (purchase.status === 'refunded') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gf-raised text-gf-heading">
          {t('statusRefunded', { defaultValue: 'Refunded' })}
        </span>
      );
    }

    if (purchase.refund_request_status === 'pending') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gf-warning-soft text-gf-warning">
          {t('statusPendingRefund', { defaultValue: 'Refund Pending' })}
        </span>
      );
    }

    if (purchase.refund_request_status === 'rejected') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gf-danger-soft text-gf-danger">
          {t('statusRefundRejected', { defaultValue: 'Refund Rejected' })}
        </span>
      );
    }

    if (purchase.status === 'disputed') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gf-info-soft text-gf-info">
          {t('statusDisputed', { defaultValue: 'Disputed' })}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gf-success-soft text-gf-success">
        {t('statusCompleted', { defaultValue: 'Completed' })}
      </span>
    );
  };

  const getRefundButton = (purchase: UserPurchase) => {
    if (purchase.status === 'refunded') return null;
    if (purchase.refund_request_status === 'pending') return null;

    if (!purchase.is_refundable) {
      return (
        <span className="text-xs text-gf-muted">
          {t('notRefundable', { defaultValue: 'Not refundable' })}
        </span>
      );
    }

    if (!purchase.refund_eligible) {
      return (
        <span className="text-xs text-gf-muted">
          {t('refundPeriodExpired', { defaultValue: 'Refund period expired' })}
        </span>
      );
    }

    const daysRemaining = purchase.refund_period_days
      ? purchase.refund_period_days - purchase.days_since_purchase
      : null;

    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => openRefundModal(purchase)}
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gf-danger hover:opacity-90 bg-gf-danger-soft rounded-full transition-colors"
        >
          {t('requestRefund', { defaultValue: 'Request Refund' })}
        </button>
        {daysRemaining !== null && daysRemaining > 0 && (
          <span className="text-xs text-gf-muted">
            {t('daysRemaining', { days: daysRemaining, defaultValue: `${daysRemaining} days left` })}
          </span>
        )}
      </div>
    );
  };

  if (authLoading || loading) {
    return (
      <DashboardLayout user={user ? { email: user.email || '', id: user.id || '' } : null}>
        <div className="bg-gf-deep flex items-center justify-center min-h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-gf-accent mx-auto mb-4"></div>
            <p className="text-gf-body">{t('loading', { defaultValue: 'Loading purchases...' })}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!user) {
    return (
      <DashboardLayout user={null}>
        <div className="bg-gf-deep flex items-center justify-center min-h-96">
          <div className="text-center p-4">
            <h2 className="text-2xl font-bold text-gf-heading mb-4">{t('accessRequired', { defaultValue: 'Access Required' })}</h2>
            <p className="text-gf-body mb-6">{t('pleaseLogin', { defaultValue: 'Please log in to view your purchases.' })}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={{ email: user.email || '', id: user.id || '' }}>
      <div className="min-h-screen bg-gf-deep text-gf-heading -mx-4 -my-6 px-4 py-6">
        {/* Header */}
        <header className="relative pt-10 pb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-gf-heading mb-4">
            <span className="text-wl-accent">
              {t('title', { defaultValue: 'My Purchases' })}
            </span>
          </h1>
          <p className="text-lg text-gf-body">
            {t('subtitle', { defaultValue: 'View your purchase history and manage refunds' })}
          </p>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          {error && (
            <div className="mb-6 p-4 bg-gf-danger-soft border border-gf-danger/30 rounded-lg text-gf-danger">
              {error}
            </div>
          )}

          {purchases.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-6xl mb-8">🛒</div>
              <h3 className="text-2xl font-bold text-gf-heading mb-4">{t('noPurchases', { defaultValue: 'No purchases yet' })}</h3>
              <p className="text-gf-body max-w-md mx-auto">
                {t('noPurchasesMessage', { defaultValue: 'When you purchase products, they will appear here.' })}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {purchases.map((purchase) => (
                <div
                  key={purchase.transaction_id}
                  className="bg-gf-raised/80 backdrop-blur-md border border-gf-border rounded-2xl p-6 hover:bg-gf-hover transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <div className="text-3xl mr-4">{purchase.product_icon || '📦'}</div>
                      <div>
                        <h3 className="text-lg font-semibold text-gf-heading">
                          {purchase.product_name}
                        </h3>
                        <p className="text-sm text-gf-muted">
                          {t('purchasedOn', { defaultValue: 'Purchased on' })} {formatDate(purchase.purchase_date)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-wl-accent">
                        {formatPrice(purchase.amount / 100, purchase.currency, t('naLabel'), t('invalidPrice'))}
                      </div>
                      {purchase.refunded_amount > 0 && purchase.status !== 'refunded' && (
                        <div className="text-sm text-gf-muted">
                          {t('refundedAmount', { defaultValue: 'Refunded' })}: {formatPrice(purchase.refunded_amount / 100, purchase.currency, t('naLabel'), t('invalidPrice'))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      {getStatusBadge(purchase)}
                    </div>
                    {getRefundButton(purchase)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Refund Request Modal */}
        {refundModalOpen && selectedPurchase && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gf-raised border border-gf-border rounded-2xl max-w-md w-full p-6">
              <h2 className="text-xl font-bold text-gf-heading mb-4">
                {t('refundRequestTitle', { defaultValue: 'Request Refund' })}
              </h2>

              <div className="mb-4 p-4 bg-gf-float rounded-lg">
                <div className="flex items-center">
                  <div className="text-2xl mr-3">{selectedPurchase.product_icon || '📦'}</div>
                  <div>
                    <div className="font-medium text-gf-heading">{selectedPurchase.product_name}</div>
                    <div className="text-sm text-gf-muted">
                      {formatPrice(selectedPurchase.amount / 100, selectedPurchase.currency, t('naLabel'), t('invalidPrice'))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gf-body mb-2">
                  {t('refundReason', { defaultValue: 'Reason for refund (optional)' })}
                </label>
                <textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-gf-input border border-gf-border rounded-lg text-gf-heading placeholder-gf-muted focus:outline-none focus:ring-2 focus:ring-wl-accent"
                  placeholder={t('refundReasonPlaceholder', { defaultValue: 'Tell us why you want a refund...' })}
                />
              </div>

              <div className="bg-gf-warning-soft border border-gf-warning/30 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <svg className="h-5 w-5 text-gf-warning mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-gf-warning">
                    {t('refundWarning', { defaultValue: 'Your refund request will be reviewed by our team. You will receive a response via email.' })}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setRefundModalOpen(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-gf-muted/30 hover:bg-gf-muted/40 text-gf-heading rounded-full transition-colors disabled:opacity-50"
                >
                  {t('cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={submitRefundRequest}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-gf-danger-bg hover:bg-gf-danger/90 text-gf-inverse rounded-full transition-colors disabled:opacity-50"
                >
                  {submitting ? t('submitting', { defaultValue: 'Submitting...' }) : t('submitRequest', { defaultValue: 'Submit Request' })}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
