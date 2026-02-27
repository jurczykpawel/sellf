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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t('title')}
        </h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('transactionId')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('user')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('amount')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('status')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('date')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('actions')}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {transaction.id.slice(0, 8)}...
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {transaction.stripe_payment_intent_id?.slice(0, 20)}...
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900 dark:text-white">
                    {transaction.user_id.slice(0, 8)}...
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(transaction.amount, transaction.currency)}
                  </div>
                  {transaction.refunded_amount > 0 && (
                    <div className="text-sm text-red-600">
                      {t('refunded', { amount: formatCurrency(transaction.refunded_amount, transaction.currency) })}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    transaction.status === 'completed' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                      : transaction.status === 'refunded'
                      ? 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100'
                  }`}>
                    {t(`statuses.${transaction.status}`)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {formatDate(transaction.created_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {transaction.status === 'completed' && 
                   transaction.amount > transaction.refunded_amount && (
                    <button
                      onClick={() => setShowRefundModal(transaction.id)}
                      disabled={refundingId === transaction.id}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
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
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {tRefund('title')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {tRefund('reason')}
                </label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
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
