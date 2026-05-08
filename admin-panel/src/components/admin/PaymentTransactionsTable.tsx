// components/admin/PaymentTransactionsTable.tsx
// Admin component for viewing and managing payment transactions

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { processRefund } from '@/lib/actions/payment';
import { getTransactionRefundProgress } from '@/lib/refunds/transaction-refund-progress';
import { toast } from 'sonner';
import type { PaymentTransaction } from '@/types/payment';

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
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [showRefundModal, setShowRefundModal] = useState<string | null>(null);

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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
                    <div className="text-sm text-sf-heading">
                      {transaction.user_id?.slice(0, 8) ?? '—'}...
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
                    {transaction.status === 'completed' && transaction.amount > transaction.refunded_amount && (
                      <button
                        onClick={() => setShowRefundModal(transaction.id)}
                        disabled={refundingId === transaction.id}
                        className="text-sf-danger hover:text-sf-danger disabled:opacity-50"
                      >
                        {refundingId === transaction.id ? tRefund('processing') : t('refund')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-sf-base p-6 max-w-md w-full mx-4">
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
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 transition-colors"
                >
                  {refundingId === showRefundModal ? tRefund('processing') : tRefund('fullRefund')}
                </button>
                <button
                  onClick={() => {
                    setShowRefundModal(null);
                    setRefundReason('');
                  }}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 transition-colors"
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
