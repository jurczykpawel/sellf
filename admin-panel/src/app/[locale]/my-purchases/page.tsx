'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import DashboardLayout from '@/components/DashboardLayout';
import MySubscriptions from '@/components/MySubscriptions';
import type { UserPurchase } from '@/types';
import { getCustomerRefundAction } from '@/lib/refunds/flow';
import { buildPurchaseDiscountSummary } from '@/lib/purchases/discounts';
import {
  hasMixedRefundPolicies,
  normalizePurchaseLineItems,
  requiresManualRefundReview,
  type NormalizedPurchaseLineItem,
  type PurchaseLineItem,
  type PurchaseLineItemProduct,
} from '@/lib/purchases/line-items';

interface PurchaseTransactionMetadata {
  coupon_discount?: string | null;
}

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
  const [lineItemsByTransaction, setLineItemsByTransaction] = useState<Record<string, NormalizedPurchaseLineItem[]>>({});
  const [transactionMetadataById, setTransactionMetadataById] = useState<Record<string, PurchaseTransactionMetadata | null>>({});
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

      const visiblePurchases = (data || []).filter((p: UserPurchase) =>
        p.status !== 'pending' && p.status !== 'abandoned'
      );
      setPurchases(visiblePurchases);

      const transactionIds = visiblePurchases.map((purchase: UserPurchase) => purchase.transaction_id);
      if (transactionIds.length === 0) {
        setLineItemsByTransaction({});
        setTransactionMetadataById({});
        return;
      }

      const [{ data: rawLineItems, error: lineItemsError }, { data: transactionMetadata, error: transactionMetadataError }] = await Promise.all([
        supabase
          .from('payment_line_items')
          .select('id, transaction_id, product_id, item_type, product_name, quantity, total_price, currency')
          .in('transaction_id', transactionIds),
        supabase
          .from('payment_transactions')
          .select('id, metadata')
          .in('id', transactionIds),
      ]);

      if (lineItemsError) throw lineItemsError;

      const lineItems = (rawLineItems || []) as PurchaseLineItem[];
      const metadataMap: Record<string, PurchaseTransactionMetadata | null> = {};

      if (!transactionMetadataError) {
        for (const transaction of transactionMetadata || []) {
          metadataMap[transaction.id] = transaction.metadata as PurchaseTransactionMetadata | null;
        }
      } else {
        console.warn('[my-purchases] Failed to load transaction metadata:', transactionMetadataError);
      }

      const productIds = Array.from(new Set(lineItems.map(item => item.product_id)));
      const productsById = new Map<string, PurchaseLineItemProduct>();

      if (productIds.length > 0) {
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('id, name, slug, icon, is_refundable, refund_period_days')
          .in('id', productIds);

        if (productsError) throw productsError;

        for (const product of productsData || []) {
          productsById.set(product.id, product);
        }
      }

      const grouped: Record<string, NormalizedPurchaseLineItem[]> = {};
      for (const purchase of visiblePurchases) {
        const purchaseLineItems = lineItems
          .filter(item => item.transaction_id === purchase.transaction_id)
          .map(item => ({ ...item, product: productsById.get(item.product_id) || null }));

        grouped[purchase.transaction_id] = normalizePurchaseLineItems(
          purchaseLineItems,
          purchase.purchase_date,
          purchase.status
        );
      }

      setLineItemsByTransaction(grouped);
      setTransactionMetadataById(metadataMap);
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
      console.error('[handleRefundRequest] Error:', err);
      toast.error(t('refundSubmitError'));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (purchase: UserPurchase) => {
    if (purchase.status === 'refunded') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sf-raised text-sf-heading">
          {t('statusRefunded', { defaultValue: 'Refunded' })}
        </span>
      );
    }

    if (purchase.refund_request_status === 'pending') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sf-warning-soft text-sf-warning">
          {t('statusPendingRefund', { defaultValue: 'Refund Pending' })}
        </span>
      );
    }

    if (purchase.refund_request_status === 'rejected') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sf-danger-soft text-sf-danger">
          {t('statusRefundRejected', { defaultValue: 'Refund Rejected' })}
        </span>
      );
    }

    if (purchase.status === 'disputed') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sf-info-soft text-sf-info">
          {t('statusDisputed', { defaultValue: 'Disputed' })}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sf-success-soft text-sf-success">
        {t('statusCompleted', { defaultValue: 'Completed' })}
      </span>
    );
  };

  const getRefundButton = (purchase: UserPurchase, lineItems: NormalizedPurchaseLineItem[] = []) => {
    if (requiresManualRefundReview(lineItems)) {
      return (
        <span className="max-w-[240px] text-right text-xs text-sf-muted">
          {t('bundleManualRefundContact', {
            defaultValue: 'This bundled purchase has mixed refund policies. Contact the seller to review a partial refund.',
          })}
        </span>
      );
    }

    const action = getCustomerRefundAction(purchase);
    if (action.type === 'none' || action.type === 'pending') return null;
    if (action.type === 'not_refundable') return <span className="text-xs text-sf-muted">{t('notRefundable', { defaultValue: 'Not refundable' })}</span>;
    if (action.type === 'period_expired') return <span className="text-xs text-sf-muted">{t('refundPeriodExpired', { defaultValue: 'Refund period expired' })}</span>;
    if (action.type === 'rejected_contact') {
      return (
        <span className="max-w-[220px] text-right text-xs text-sf-muted">
          {t('refundRejectedContactSeller', {
            defaultValue: 'Refund rejected. Contact the seller directly if you need more help.',
          })}
        </span>
      );
    }

    const getTimeRemaining = () => {
      if (!purchase.refund_period_days || !purchase.purchase_date) return null;
      const deadline = new Date(purchase.purchase_date);
      deadline.setDate(deadline.getDate() + purchase.refund_period_days);
      const msLeft = deadline.getTime() - Date.now();
      if (msLeft <= 0) return null;
      const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
      const days = Math.floor(hoursLeft / 24);
      const hours = hoursLeft % 24;
      return { days, hours };
    };

    const timeRemaining = getTimeRemaining();

    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => openRefundModal(purchase)}
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-sf-danger hover:opacity-90 bg-sf-danger-soft rounded-full transition-colors"
        >
          {t('requestRefund', { defaultValue: 'Request Refund' })}
        </button>
        {timeRemaining && (
          <span className="text-xs text-sf-muted">
            {timeRemaining.days > 0
              ? t('daysHoursRemaining', { days: timeRemaining.days, hours: timeRemaining.hours, defaultValue: `${timeRemaining.days}d ${timeRemaining.hours}h left` })
              : t('hoursRemaining', { hours: timeRemaining.hours, defaultValue: `${timeRemaining.hours}h left` })
            }
          </span>
        )}
      </div>
    );
  };

  const getLineItemBadge = (item: NormalizedPurchaseLineItem) => {
    if (item.item_type === 'main_product') return t('mainProduct', { defaultValue: 'Main product' });
    if (item.item_type === 'order_bump') return t('orderBump', { defaultValue: 'Order bump' });
    return item.item_type;
  };

  const getLineItemRefundLabel = (item: NormalizedPurchaseLineItem) => {
    if (item.refundState === 'refundable') return t('lineItemRefundable', { defaultValue: 'Refundable' });
    if (item.refundState === 'period_expired') return t('lineItemRefundPeriodExpired', { defaultValue: 'Refund period expired' });
    return t('lineItemNotRefundable', { defaultValue: 'Not refundable' });
  };

  const getPurchaseDiscountSummary = (purchase: UserPurchase, lineItems: NormalizedPurchaseLineItem[]) => {
    const subtotal = lineItems.reduce((sum, item) => sum + item.total_price, 0);
    const transactionMetadata = transactionMetadataById[purchase.transaction_id];

    return buildPurchaseDiscountSummary({
      subtotal,
      totalPaid: purchase.amount / 100,
      couponDiscount: transactionMetadata?.coupon_discount || null,
    });
  };

  const getDiscountLabel = (summary: NonNullable<ReturnType<typeof buildPurchaseDiscountSummary>>, currency: string) => {
    if (summary.couponDiscount?.kind === 'percentage') {
      return t('discountPercentage', {
        value: summary.couponDiscount.value,
        defaultValue: `${summary.couponDiscount.value}%`,
      });
    }

    if (summary.couponDiscount?.kind === 'fixed') {
      return t('discountFixedAmount', {
        amount: formatPrice(summary.couponDiscount.value, currency, t('naLabel'), t('invalidPrice')),
        defaultValue: formatPrice(summary.couponDiscount.value, currency, t('naLabel'), t('invalidPrice')),
      });
    }

    return t('discountApplied', { defaultValue: 'Discount applied' });
  };

  if (authLoading || loading) {
    return (
      <DashboardLayout user={user ? { email: user.email || '', id: user.id || '' } : null}>
        <div className="bg-sf-deep flex items-center justify-center min-h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-sf-accent mx-auto mb-4"></div>
            <p className="text-sf-body">{t('loading', { defaultValue: 'Loading purchases...' })}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!user) {
    return (
      <DashboardLayout user={null}>
        <div className="bg-sf-deep flex items-center justify-center min-h-96">
          <div className="text-center p-4">
            <h2 className="text-2xl font-bold text-sf-heading mb-4">{t('accessRequired', { defaultValue: 'Access Required' })}</h2>
            <p className="text-sf-body mb-6">{t('pleaseLogin', { defaultValue: 'Please log in to view your purchases.' })}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout user={{ email: user.email || '', id: user.id || '' }}>
      <div className="min-h-screen bg-sf-deep text-sf-heading -mx-4 -my-6 px-4 py-6">
        {/* Header */}
        <header className="relative pt-10 pb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-sf-heading mb-4">
            <span className="text-sf-accent">
              {t('title', { defaultValue: 'My Purchases' })}
            </span>
          </h1>
          <p className="text-lg text-sf-body">
            {t('subtitle', { defaultValue: 'View your purchase history and manage refunds' })}
          </p>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          {error && (
            <div className="mb-6 p-4 bg-sf-danger-soft border border-sf-danger/30 rounded-lg text-sf-danger">
              {error}
            </div>
          )}

          <div className="mb-8">
            <MySubscriptions />
          </div>

          {purchases.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-6xl mb-8">🛒</div>
              <h3 className="text-2xl font-bold text-sf-heading mb-4">{t('noPurchases', { defaultValue: 'No purchases yet' })}</h3>
              <p className="text-sf-body max-w-md mx-auto">
                {t('noPurchasesMessage', { defaultValue: 'When you purchase products, they will appear here.' })}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {purchases.map((purchase) => (
                (() => {
                  const lineItems = lineItemsByTransaction[purchase.transaction_id] || [];
                  const mixedRefundPolicies = hasMixedRefundPolicies(lineItems);
                  return (
                <div
                  key={purchase.transaction_id}
                  className="bg-sf-raised/80 backdrop-blur-md border border-sf-border rounded-2xl p-6 hover:bg-sf-hover transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center">
                      <div className="text-3xl mr-4">{purchase.product_icon || '📦'}</div>
                      <div>
                        <h3 className="text-lg font-semibold text-sf-heading">
                          {purchase.product_name}
                        </h3>
                        <p className="text-sm text-sf-muted">
                          {t('purchasedOn', { defaultValue: 'Purchased on' })} {formatDate(purchase.purchase_date)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-sf-accent">
                        {formatPrice(purchase.amount / 100, purchase.currency, t('naLabel'), t('invalidPrice'))}
                      </div>
                      {(() => {
                        const discountSummary = getPurchaseDiscountSummary(purchase, lineItems);
                        if (!discountSummary) return null;

                        return (
                          <div className="mt-2 space-y-1 text-xs text-sf-muted">
                            <div className="flex items-center justify-between gap-3">
                              <span>{t('subtotal', { defaultValue: 'Subtotal' })}</span>
                              <span>{formatPrice(discountSummary.subtotal, purchase.currency, t('naLabel'), t('invalidPrice'))}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 text-sf-success">
                              <span>{getDiscountLabel(discountSummary, purchase.currency)}</span>
                              <span>-{formatPrice(discountSummary.discountAmount, purchase.currency, t('naLabel'), t('invalidPrice'))}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3 font-semibold text-sf-heading">
                              <span>{t('paid', { defaultValue: 'Paid' })}</span>
                              <span>{formatPrice(discountSummary.totalPaid, purchase.currency, t('naLabel'), t('invalidPrice'))}</span>
                            </div>
                          </div>
                        );
                      })()}
                      {purchase.refunded_amount > 0 && purchase.status !== 'refunded' && (
                        <div className="text-sm text-sf-muted">
                          {t('refundedAmount', { defaultValue: 'Refunded' })}: {formatPrice(purchase.refunded_amount / 100, purchase.currency, t('naLabel'), t('invalidPrice'))}
                        </div>
                      )}
                    </div>
                  </div>

                  {lineItems.length > 0 && (
                    <div className="mt-5 rounded-xl border border-sf-border bg-sf-float/50 p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-sf-muted">
                        {t('includes', { defaultValue: 'Includes' })}
                      </div>
                      <div className="space-y-3">
                        {lineItems.map((item) => (
                          <div key={item.id} className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-sf-heading">{item.displayName}</span>
                                <span className="rounded-full bg-sf-raised px-2 py-0.5 text-[11px] font-medium text-sf-muted">
                                  {getLineItemBadge(item)}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-sf-muted">
                                {getLineItemRefundLabel(item)}
                              </div>
                            </div>
                            <div className="shrink-0 text-sm font-semibold text-sf-heading">
                              {formatPrice(item.total_price, item.currency, t('naLabel'), t('invalidPrice'))}
                            </div>
                          </div>
                        ))}
                      </div>
                      {mixedRefundPolicies && (
                        <div className="mt-4 rounded-lg border border-sf-warning/30 bg-sf-warning-soft p-3 text-xs text-sf-warning">
                          {t('mixedRefundPolicyNotice', {
                            defaultValue: 'This purchase contains products with different refund policies. Refund requests are currently reviewed for the whole purchase.',
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      {getStatusBadge(purchase)}
                    </div>
                    {getRefundButton(purchase, lineItems)}
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
          )}
        </main>

        {/* Refund Request Modal */}
        {refundModalOpen && selectedPurchase && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-sf-raised border border-sf-border rounded-2xl max-w-md w-full p-6">
              <h2 className="text-xl font-bold text-sf-heading mb-4">
                {t('refundRequestTitle', { defaultValue: 'Request Refund' })}
              </h2>

              <div className="mb-4 p-4 bg-sf-float rounded-lg">
                <div className="flex items-center">
                  <div className="text-2xl mr-3">{selectedPurchase.product_icon || '📦'}</div>
                  <div>
                    <div className="font-medium text-sf-heading">{selectedPurchase.product_name}</div>
                    <div className="text-sm text-sf-muted">
                      {formatPrice(selectedPurchase.amount / 100, selectedPurchase.currency, t('naLabel'), t('invalidPrice'))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-sf-body mb-2">
                  {t('refundReason', { defaultValue: 'Reason for refund (optional)' })}
                </label>
                <textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-sf-input border border-sf-border rounded-lg text-sf-heading placeholder-sf-muted focus:outline-none focus:ring-2 focus:ring-sf-accent"
                  placeholder={t('refundReasonPlaceholder', { defaultValue: 'Tell us why you want a refund...' })}
                />
              </div>

              <div className="bg-sf-warning-soft border border-sf-warning/30 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <svg className="h-5 w-5 text-sf-warning mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-sf-warning">
                    {t('refundWarning', { defaultValue: 'Your refund request will be reviewed by our team. You will receive a response via email.' })}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setRefundModalOpen(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-sf-muted/30 hover:bg-sf-muted/40 text-sf-heading rounded-full transition-colors disabled:opacity-50"
                >
                  {t('cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={submitRefundRequest}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-sf-danger-bg hover:bg-sf-danger/90 text-sf-inverse rounded-full transition-colors disabled:opacity-50"
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
