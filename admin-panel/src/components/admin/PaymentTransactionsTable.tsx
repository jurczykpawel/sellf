// components/admin/PaymentTransactionsTable.tsx
// Admin component for viewing and managing payment transactions

'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { isRefundablePaymentStatus, supportsStripeRefund } from '@/lib/refunds/payment-status';
import { processRefund } from '@/lib/actions/payment';
import { getTransactionRefundProgress } from '@/lib/refunds/transaction-refund-progress';
import { parseRefundAmountInput } from '@/lib/refunds/refund-amount';
import { formatAdminDate } from '@/lib/timezone';
import { formatCustomFieldsForDisplay } from '@/lib/format-custom-fields';
import { getPaymentDiscount } from '@/lib/payments/discount';
import { currencyExponent, fromMinorUnits } from '@/lib/currency/minor-units';
import { transferDeadline, formatTransferDeadline } from '@/lib/orders/transfer-format';
import BaseModal from '@/components/ui/BaseModal';
import BankTransferSection from '@/components/admin/BankTransferSection';
import AttributionSection from '@/components/admin/AttributionSection';
import InvoiceSection from '@/components/admin/InvoiceSection';
import OrderDetailsSection from '@/components/admin/OrderDetailsSection';
import type { PaymentTransaction, PaymentTransactionLineItem } from '@/types/payment';

interface PaymentTransactionsTableProps {
  transactions: PaymentTransaction[];
  onRefreshData?: () => void | Promise<void>;
  /** Transaction to open on mount (deep link `?order=` resolved by the dashboard). */
  initialDetailsId?: string | null;
  /** Called when the details dialog opens/closes so the dashboard can mirror it in the URL. */
  onDetailsChange?: (transaction: PaymentTransaction | null) => void;
}

/** `#1300` when the order has a number, otherwise the short id. */
function orderLabel(transaction: PaymentTransaction): string {
  return transaction.order_number ? `#${transaction.order_number}` : `${transaction.id.slice(0, 8)}...`;
}

export default function PaymentTransactionsTable({ 
  transactions,
  onRefreshData,
  initialDetailsId = null,
  onDetailsChange,
}: PaymentTransactionsTableProps) {
  const bt = useTranslations('bankTransfer');
  const t = useTranslations('admin.payments.transactions');
  const ti = useTranslations('invoicing');
  const tc = useTranslations('checkout');
  const tRefund = useTranslations('admin.payments.refund');
  const locale = useLocale();
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [showRefundModal, setShowRefundModal] = useState<string | null>(null);
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [detailsTransactionId, setDetailsTransactionIdState] = useState<string | null>(initialDetailsId);
  const setDetailsTransactionId = (id: string | null) => {
    setDetailsTransactionIdState(id);
    onDetailsChange?.(id ? transactions.find(transaction => transaction.id === id) ?? null : null);
  };
  const closeRefundModal = () => {
    setShowRefundModal(null);
    setRefundReason('');
    setRefundAmountInput('');
  };
  const refundTransaction = showRefundModal ? transactions.find(transaction => transaction.id === showRefundModal) ?? null : null;
  const refundRemaining = refundTransaction ? Math.max(refundTransaction.amount - (refundTransaction.refunded_amount || 0), 0) : 0;
  const refundAmount = refundTransaction ? parseRefundAmountInput(refundAmountInput, refundRemaining, refundTransaction.currency) : null;
  const detailsTransaction = transactions.find(transaction => transaction.id === detailsTransactionId) ?? null;

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
        closeRefundModal();
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
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(fromMinorUnits(amount, currency));
  };

  const formatMajorCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
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
      unit_price: fromMinorUnits(transaction.amount, transaction.currency),
      total_price: fromMinorUnits(transaction.amount, transaction.currency),
      currency: transaction.currency,
    }];
  };

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium overflow-hidden">
      <div className="px-6 py-4 border-b border-sf-border">
        <h3 className="text-lg font-semibold text-sf-heading">
          {t('titleSentence')}
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
<th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{bt('dueAt')}</th>
<th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">{ti('column')}</th>
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
                <tr key={transaction.id} className={transaction.status === 'awaiting_payment' && transferDeadline(transaction) && Date.parse(transferDeadline(transaction)!) < Date.now() ? 'bg-sf-warning-soft' : index % 2 === 1 ? 'bg-sf-row-alt' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-sf-heading" title={transaction.id}>
                      {orderLabel(transaction)}
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
                        <div className="text-sm text-sf-warning">
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
                    {(transaction.status === 'pending' || transaction.status === 'abandoned') && (
                      <div className="mt-1 max-w-48 whitespace-normal text-xs text-sf-muted">
                        {t(`attemptNote.${transaction.status}`)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-sf-muted">
                    {formatAdminDate(transaction.created_at, locale)}
                  </td>
<td className="px-6 py-4 text-sm">{formatTransferDeadline(transferDeadline(transaction), locale) || '—'}</td>
<td className="px-6 py-4 text-sm">{transaction.invoice?.view_url ? <a href={transaction.invoice.view_url} target="_blank" rel="noreferrer" className="underline">{transaction.invoice.number}</a> : transaction.invoice ? ti(transaction.invoice.status) : "—"}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center gap-3">
                      <button
                        data-tour="payments-details"
                        onClick={() => setDetailsTransactionId(transaction.id)}
                        className="text-sf-accent hover:text-sf-accent-hover"
                      >
                        {t('details')}
                      </button>
                      {supportsStripeRefund(transaction) && isRefundablePaymentStatus(transaction.status) && transaction.amount > transaction.refunded_amount && (
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
        const discount = getPaymentDiscount(detailsTransaction);
        const paidTotal = fromMinorUnits(detailsTransaction.amount, detailsTransaction.currency);
        const showSubtotal = Math.abs(lineItemsSubtotal - paidTotal) > 0.009;

        return (
        <BaseModal isOpen onClose={() => setDetailsTransactionId(null)} labelledBy="payment-details-title" showCloseButton={false} size="lg">
          <div className="bg-sf-raised/95 border border-sf-border shadow-2xl rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h3 id="payment-details-title" className="text-lg font-semibold text-sf-heading">
                  {t('transactionDetails')}
                </h3>
                <p className="text-sm text-sf-muted">
                  {detailsTransaction.order_number && <span className="font-semibold text-sf-heading mr-2">#{detailsTransaction.order_number}</span>}
                  <span className="break-all">{detailsTransaction.id}</span>
                </p>
              </div>
              <button
                onClick={() => setDetailsTransactionId(null)}
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

<AttributionSection transactionId={detailsTransaction.id} />
<BankTransferSection transaction={detailsTransaction} onRefresh={async () => { await onRefreshData?.(); }} />
<InvoiceSection transactionId={detailsTransaction.id} status={detailsTransaction.status} invoice={detailsTransaction.invoice} onRefresh={() => { setDetailsTransactionId(null); onRefreshData?.(); }} />
            <OrderDetailsSection
              details={detailsTransaction.order_details}
              customFields={formatCustomFieldsForDisplay(detailsTransaction.custom_field_values, detailsTransaction.product?.custom_checkout_fields, locale)}
            />

            <div className="mt-5 space-y-2 text-sm">
              {showSubtotal && (
                <div className="flex justify-between gap-4">
                  <span className="text-sf-muted">{t('subtotal')}</span>
                  <span className="font-medium text-sf-heading">
                    {formatMajorCurrency(lineItemsSubtotal, detailsTransaction.currency)}
                  </span>
                </div>
              )}
              {(discount.amount > 0 || discount.code) && <div className="flex justify-between gap-4">
                <span className="text-sf-muted">{tc('couponDiscount')}{discount.code ? ` (${discount.code})` : ''}</span>
                {discount.amount > 0 && <span className="font-medium text-sf-heading">−{formatMajorCurrency(discount.amount, detailsTransaction.currency)}</span>}
              </div>}
              <div className="flex justify-between gap-4">
                <span className="text-sf-muted">{showSubtotal && !['awaiting_payment', 'cancelled'].includes(detailsTransaction.status) ? t('paid') : t('total')}</span>
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

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              {detailsTransaction.customer_email && (detailsTransaction.product?.id ?? detailsTransaction.product_id) && (
                <a
                  href={`/dashboard/licenses?${new URLSearchParams({ email: detailsTransaction.customer_email, product: detailsTransaction.product?.id ?? detailsTransaction.product_id })}`}
                  className="text-sm font-medium text-sf-accent hover:text-sf-accent-hover underline"
                >
                  {t('issueLicense')}
                </a>
              )}
              <button
                onClick={() => setDetailsTransactionId(null)}
                className="bg-sf-accent-bg hover:bg-sf-accent-hover text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                {t('close')}
              </button>
            </div>
          </div>
        </BaseModal>
        );
      })()}

      {/* Refund Modal */}
      {showRefundModal && (
        <BaseModal isOpen onClose={closeRefundModal} labelledBy="payment-refund-title" showCloseButton={false}>
          <div className="bg-sf-raised/95 border border-sf-border shadow-2xl rounded-2xl p-6 max-w-md w-full">
            <h3 id="payment-refund-title" className="text-lg font-semibold text-sf-heading mb-4">
              {tRefund('titleSentence')}
            </h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="sf-refund-reason" className="block text-sm font-medium text-sf-body mb-2">
                  {tRefund('reason')}
                </label>
                <select
                  id="sf-refund-reason"
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
              {refundTransaction && (
                <div>
                  <label htmlFor="sf-refund-amount" className="block text-sm font-medium text-sf-body mb-2">
                    {tRefund('amountLabel', { currency: refundTransaction.currency.toUpperCase() })}
                  </label>
                  <input
                    id="sf-refund-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={refundAmountInput}
                    onChange={(e) => setRefundAmountInput(e.target.value)}
                    placeholder={String(fromMinorUnits(refundRemaining, refundTransaction.currency))}
                    aria-describedby={`sf-refund-amount-hint${refundAmount?.ok === false ? ' sf-refund-amount-error' : ''}`}
                    aria-invalid={refundAmount?.ok === false}
                    className="w-full px-3 py-2 border-2 border-sf-border-medium focus:outline-none focus:ring-2 focus:ring-sf-accent bg-sf-raised text-sf-heading"
                  />
                  <p id="sf-refund-amount-hint" className="mt-1 text-xs text-sf-muted">
                    {tRefund('amountHint', { amount: formatCurrency(refundRemaining, refundTransaction.currency) })}
                  </p>
                  {refundAmount?.ok === false && (
                    <p id="sf-refund-amount-error" role="alert" className="mt-1 text-xs text-sf-danger">
                      {tRefund(refundAmount.error === 'exceedsRemaining' ? 'amountExceedsRemaining' : currencyExponent(refundTransaction.currency) === 0 ? 'amountInvalidWhole' : 'amountInvalid', { amount: formatCurrency(refundRemaining, refundTransaction.currency) })}
                    </p>
                  )}
                </div>
              )}
              <div className="flex space-x-3">
                <button
                  onClick={() => refundAmount?.ok && handleRefund(showRefundModal, refundAmount.amountMinor)}
                  disabled={!refundReason || !refundAmount?.ok || refundingId === showRefundModal}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  {refundingId === showRefundModal
                    ? tRefund('processing')
                    : refundAmount?.ok && refundAmount.partial && refundTransaction
                    ? tRefund('partialRefundSentence', { amount: formatCurrency(refundAmount.amountMinor, refundTransaction.currency) })
                    : tRefund('fullRefundSentence')}
                </button>
                <button
                  onClick={closeRefundModal}
                  className="flex-1 bg-sf-base hover:bg-sf-hover border border-sf-border text-sf-heading font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  {tRefund('cancel')}
                </button>
              </div>
            </div>
          </div>
        </BaseModal>
      )}
    </div>
  );
}
