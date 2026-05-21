// components/admin/PaymentTransactionsTable.tsx
// Admin component for viewing and managing payment transactions

'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { processRefund } from '@/lib/actions/payment';
import { getTransactionRefundProgress } from '@/lib/refunds/transaction-refund-progress';
import { toast } from 'sonner';
import type { PaymentTransaction, PaymentTransactionLineItem } from '@/types/payment';
import { formatCustomFieldsForDisplay } from '@/lib/format-custom-fields';

interface PaymentTransactionsTableProps {
  transactions: PaymentTransaction[];
  onRefreshData?: () => void;
}

export default function PaymentTransactionsTable({ 
  transactions, 
  onRefreshData 
}: PaymentTransactionsTableProps) {
  const t = useTranslations('admin.payments.transactions');
  const tRefund = useTranslations('admin.payments.refund');
  const locale = useLocale();
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [showRefundModal, setShowRefundModal] = useState<string | null>(null);
  const [detailsTransaction, setDetailsTransaction] = useState<PaymentTransaction | null>(null);

  const handleRefund = async (transactionId: string, amount?: number) => {
    if (refundingId) return;
    
    setRefundingId(transactionId);
    
    try {
      const result = await processRefund({
        transactionId,
        amount,
        reason: refundReason || undefined,
      });
      
      if (result.success) {
        toast.success(tRefund('success'));
        setShowRefundModal(null);
        setRefundReason('');
        onRefreshData?.();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error(tRefund('error'));
    } finally {
      setRefundingId(null);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const formatMajorCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTransactionDisplayItems = (transaction: PaymentTransaction): PaymentTransactionLineItem[] => {
    const storedItems = transaction.line_items ?? [];

    if (storedItems.length) {
      return storedItems;
    }

    return [{
      id: transaction.id,
      transaction_id: transaction.id,
      product_id: transaction.product_id,
      item_type: 'main_product',
      product_name: transaction.product?.name ?? null,
      quantity: 1,
      unit_price: transaction.amount / 100,
      total_price: transaction.amount / 100,
      currency: transaction.currency,
    }];
  };

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
      <div className="px-6 py-4 border-b border-sf-border">
        <h3 className="text-lg font-semibold text-sf-heading">
          {t('title')}
        </h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-sf-border-subtle">
          <thead className="bg-sf-raised">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
                {t('transactionId')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
                {t('user')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
                {t('amount')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
                {t('status')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
                {t('date')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
                {t('actions')}
              </th>
            </tr>
          </thead>
          <tbody className="bg-sf-base divide-y divide-sf-border-subtle">
            {transactions.map((transaction, index) => {
              const refundProgress = getTransactionRefundProgress({
                amount: transaction.amount,
                refundedAmount: transaction.refunded_amount,
                status: transaction.status,
              });

              return (
                <tr key={transaction.id} className={index % 2 === 1 ? 'bg-sf-row-alt' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-sf-heading">
                      {transaction.id.slice(0, 8)}...
                    </div>
                    <div className="text-sm text-sf-muted">
                      {transaction.stripe_payment_intent_id?.slice(0, 20)}...
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-sf-heading">
                      {transaction.customer_email ?? t('unknownCustomer')}
                    </div>
                    <div className="text-xs text-sf-muted">
                      {transaction.user_id
                        ? `${t('userId')}: ${transaction.user_id.slice(0, 8)}...`
                        : t('guestUser')}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-sf-heading">
                      {formatCurrency(transaction.amount, transaction.currency)}
                    </div>
                    {refundProgress.state === 'full' && (
                      <div className="text-sm text-sf-danger">
                        {t('fullRefunded', { defaultValue: 'Fully refunded' })}
                      </div>
                    )}
                    {refundProgress.state === 'partial' && (
                      <div className="space-y-1">
                        <div className="text-sm text-amber-600">
                          {t('partialRefunded', {
                            amount: formatCurrency(refundProgress.refundedAmount, transaction.currency),
                            defaultValue: `Partially refunded: ${formatCurrency(refundProgress.refundedAmount, transaction.currency)}`,
                          })}
                        </div>
                        <div className="text-xs text-sf-muted">
                          {t('partialRefundWarning', {
                            defaultValue: 'Partial refund detected. Review whether additional access revocation or follow-up is needed.',
                          })}
                        </div>
                        <div className="text-xs text-sf-muted">
                          {t('remainingRefundable', {
                            amount: formatCurrency(refundProgress.remainingAmount, transaction.currency),
                            defaultValue: `Remaining refundable: ${formatCurrency(refundProgress.remainingAmount, transaction.currency)}`,
                          })}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold ${
                      refundProgress.state === 'partial'
                        ? 'bg-yellow-100 text-yellow-800'
                        : transaction.status === 'completed'
                        ? 'bg-sf-success-soft text-sf-success'
                        : transaction.status === 'refunded'
                        ? 'bg-sf-danger-soft text-sf-danger'
                        : 'bg-sf-warning-soft text-sf-warning'
                    }`}>
                      {refundProgress.state === 'partial'
                        ? t('statuses.partialRefunded', { defaultValue: 'Partially refunded' })
                        : t(`statuses.${transaction.status}`)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-sf-muted">
                    {formatDate(transaction.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setDetailsTransaction(transaction)}
                        className="text-sf-accent hover:text-sf-accent-hover"
                      >
                        {t('details')}
                      </button>
                      {transaction.status === 'completed' && transaction.amount > transaction.refunded_amount && (
                      <button
                        onClick={() => setShowRefundModal(transaction.id)}
                        disabled={refundingId === transaction.id}
                        className="text-sf-danger hover:text-sf-danger disabled:opacity-50"
                      >
                        {refundingId === transaction.id ? tRefund('processing') : t('refund')}
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Details Modal */}
      {detailsTransaction && (() => {
        const displayItems = getTransactionDisplayItems(detailsTransaction);
        const lineItemsSubtotal = displayItems.reduce((sum, item) => sum + item.total_price, 0);
        const paidTotal = detailsTransaction.amount / 100;
        const showSubtotal = Math.abs(lineItemsSubtotal - paidTotal) > 0.009;

        return (
        <div className="fixed inset-0 bg-sf-deep/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-sf-raised/95 border border-sf-border shadow-2xl rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h3 className="text-lg font-semibold text-sf-heading">
                  {t('transactionDetails')}
                </h3>
                <p className="text-sm text-sf-muted">
                  {detailsTransaction.id}
                </p>
              </div>
              <button
                onClick={() => setDetailsTransaction(null)}
                className="h-9 w-9 rounded-full bg-sf-base/70 border border-sf-border text-sf-muted hover:text-sf-heading hover:bg-sf-hover transition-colors"
                aria-label={t('close')}
              >
                &times;
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-sf-muted">
                  {t('customer')}
                </div>
                <div className="text-sm text-sf-heading">
                  {detailsTransaction.customer_email ?? t('unknownCustomer')}
                </div>
                <div className="text-xs text-sf-muted">
                  {detailsTransaction.user_id
                    ? `${t('userId')}: ${detailsTransaction.user_id}`
                    : t('guestUser')}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-sf-muted">
                  {t('payment')}
                </div>
                <div className="text-sm text-sf-heading">
                  {formatCurrency(detailsTransaction.amount, detailsTransaction.currency)}
                </div>
                <div className="text-xs text-sf-muted">
                  {t(`statuses.${detailsTransaction.status}`)}
                </div>
              </div>
              {detailsTransaction.stripe_payment_intent_id && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-sf-muted">
                    {t('stripePaymentIntent')}
                  </div>
                  <div className="text-sm text-sf-heading break-all">
                    {detailsTransaction.stripe_payment_intent_id}
                  </div>
                </div>
              )}
              {detailsTransaction.session_id && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-sf-muted">
                    {t('stripeSession')}
                  </div>
                  <div className="text-sm text-sf-heading break-all">
                    {detailsTransaction.session_id}
                  </div>
                </div>
              )}
            </div>

            <div className="border border-sf-border bg-sf-base/60 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-sf-float/60 text-sm font-semibold text-sf-heading">
                {t('items')}
              </div>
              <div className="divide-y divide-sf-border-subtle">
                {displayItems.map((item) => (
                  <div key={`${item.id}-${item.item_type}`} className="px-4 py-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-sf-heading">
                        {item.product_name ?? detailsTransaction.product?.name ?? t('unknownProduct')}
                      </div>
                      <div className="text-xs text-sf-muted">
                        {item.item_type === 'order_bump' ? t('orderBump') : t('mainProduct')}
                        {' - '}
                        {t('quantity')}: {item.quantity}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-sf-heading whitespace-nowrap">
                      {formatMajorCurrency(item.total_price, item.currency || detailsTransaction.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {(() => {
              const customFields = formatCustomFieldsForDisplay(
                detailsTransaction.custom_field_values,
                detailsTransaction.product?.custom_checkout_fields,
                locale,
              );
              if (customFields.length === 0) return null;
              return (
                <div className="mt-5 border border-sf-border bg-sf-base/60 rounded-xl overflow-hidden" data-testid="custom-field-values">
                  <div className="px-4 py-3 bg-sf-float/60 text-sm font-semibold text-sf-heading">
                    {t('customFields')}
                  </div>
                  <dl className="divide-y divide-sf-border-subtle">
                    {customFields.map((field) => (
                      <div key={field.id} className="px-4 py-3 grid grid-cols-3 gap-3 text-sm">
                        <dt className="text-sf-muted col-span-1">{field.label}</dt>
                        <dd className="text-sf-heading col-span-2 whitespace-pre-wrap break-words">
                          {field.type === 'email' ? (
                            <a href={`mailto:${field.value}`} className="text-sf-accent hover:underline">
                              {field.value}
                            </a>
                          ) : (
                            field.value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })()}

            <div className="mt-5 space-y-2 text-sm">
              {showSubtotal && (
                <div className="flex justify-between gap-4">
                  <span className="text-sf-muted">{t('subtotal')}</span>
                  <span className="font-medium text-sf-heading">
                    {formatMajorCurrency(lineItemsSubtotal, detailsTransaction.currency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-sf-muted">{showSubtotal ? t('paid') : t('total')}</span>
                <span className="font-medium text-sf-heading">
                  {formatCurrency(detailsTransaction.amount, detailsTransaction.currency)}
                </span>
              </div>
              {detailsTransaction.refunded_amount > 0 && (
                <>
                  <div className="flex justify-between gap-4">
                    <span className="text-sf-muted">{t('refundedTotal')}</span>
                    <span className="font-medium text-sf-danger">
                      {formatCurrency(detailsTransaction.refunded_amount, detailsTransaction.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-sf-muted">{t('remaining')}</span>
                    <span className="font-medium text-sf-heading">
                      {formatCurrency(Math.max(detailsTransaction.amount - detailsTransaction.refunded_amount, 0), detailsTransaction.currency)}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setDetailsTransaction(null)}
                className="bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-sf-deep/75 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-sf-raised/95 border border-sf-border shadow-2xl rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-sf-heading mb-4">
              {tRefund('title')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-sf-body mb-2">
                  {tRefund('reason')}
                </label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent bg-sf-raised text-sf-heading"
                >
                  <option value="">{tRefund('selectReason')}</option>
                  <option value="requested_by_customer">{tRefund('reasons.requested_by_customer')}</option>
                  <option value="duplicate">{tRefund('reasons.duplicate')}</option>
                  <option value="fraudulent">{tRefund('reasons.fraudulent')}</option>
                </select>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => handleRefund(showRefundModal)}
                  disabled={!refundReason || refundingId === showRefundModal}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  {refundingId === showRefundModal ? tRefund('processing') : tRefund('fullRefund')}
                </button>
                <button
                  onClick={() => {
                    setShowRefundModal(null);
                    setRefundReason('');
                  }}
                  className="flex-1 bg-sf-base hover:bg-sf-hover border border-sf-border text-sf-heading font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  {tRefund('cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
