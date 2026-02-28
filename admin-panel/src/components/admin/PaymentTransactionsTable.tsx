// components/admin/PaymentTransactionsTable.tsx
// Admin component for viewing and managing payment transactions

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { processRefund } from '@/lib/actions/payment';
import { useToast } from '@/contexts/ToastContext';
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
  const { addToast } = useToast();
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
        addToast(tRefund('success'), 'success');
        setShowRefundModal(null);
        setRefundReason('');
        onRefreshData?.();
      } else {
        addToast(result.message, 'error');
      }
    } catch {
      addToast(tRefund('error'), 'error');
    } finally {
      setRefundingId(null);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
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

  return (
    <div className="bg-gf-base rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gf-border">
        <h3 className="text-lg font-semibold text-gf-heading">
          {t('title')}
        </h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gf-border">
          <thead className="bg-gf-raised">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                {t('transactionId')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                {t('user')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                {t('amount')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                {t('status')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                {t('date')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                {t('actions')}
              </th>
            </tr>
          </thead>
          <tbody className="bg-gf-base divide-y divide-gf-border">
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gf-heading">
                    {transaction.id.slice(0, 8)}...
                  </div>
                  <div className="text-sm text-gf-muted">
                    {transaction.stripe_payment_intent_id?.slice(0, 20)}...
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gf-heading">
                    {transaction.user_id.slice(0, 8)}...
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gf-heading">
                    {formatCurrency(transaction.amount, transaction.currency)}
                  </div>
                  {transaction.refunded_amount > 0 && (
                    <div className="text-sm text-gf-danger">
                      {t('refunded', { amount: formatCurrency(transaction.refunded_amount, transaction.currency) })}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    transaction.status === 'completed'
                      ? 'bg-gf-success-soft text-gf-success'
                      : transaction.status === 'refunded'
                      ? 'bg-gf-danger-soft text-gf-danger'
                      : 'bg-gf-warning-soft text-gf-warning'
                  }`}>
                    {t(`statuses.${transaction.status}`)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gf-muted">
                  {formatDate(transaction.created_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {transaction.status === 'completed' && 
                   transaction.amount > transaction.refunded_amount && (
                    <button
                      onClick={() => setShowRefundModal(transaction.id)}
                      disabled={refundingId === transaction.id}
                      className="text-gf-danger hover:text-gf-danger disabled:opacity-50"
                    >
                      {refundingId === transaction.id ? tRefund('processing') : t('refund')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gf-base rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gf-heading mb-4">
              {tRefund('title')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gf-body mb-2">
                  {tRefund('reason')}
                </label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gf-border rounded-md focus:outline-none focus:ring-2 focus:ring-gf-accent bg-gf-raised text-gf-heading"
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
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
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
