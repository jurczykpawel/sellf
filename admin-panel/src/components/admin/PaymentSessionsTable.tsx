// components/admin/PaymentSessionsTable.tsx
// Payment sessions table for admin dashboard

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/contexts/ToastContext';
import type { PaymentSession } from '@/types/payment';

interface PaymentSessionsTableProps {
  sessions: PaymentSession[];
  onRefreshData?: () => void;
}

export default function PaymentSessionsTable({ 
  sessions, 
  onRefreshData 
}: PaymentSessionsTableProps) {
  const tCancel = useTranslations('admin.payments.cancelSession');
  const { addToast } = useToast();
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const handleCancelSession = async (sessionId: string) => {
    if (cancelingId) return;
    
    setCancelingId(sessionId);
    
    try {
      const response = await fetch(`/api/admin/payments/sessions/${sessionId}/cancel`, {
        method: 'POST',
      });
      
      if (response.ok) {
        addToast(tCancel('success'), 'success');
        onRefreshData?.();
      } else {
        const errorData = await response.json();
        addToast(errorData.error || tCancel('error'), 'error');
      }
    } catch {
      addToast(tCancel('error'), 'error');
    } finally {
      setCancelingId(null);
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100';
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-500 dark:text-gray-400">
          No payment sessions found.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-700">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              Session
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              Customer
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              Product
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              Amount
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              Created
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              Expires
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {session.session_id.slice(0, 20)}...
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {session.provider_type}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">
                  {session.customer_email}
                </div>
                {session.user_id && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {session.user_id.slice(0, 8)}...
                  </div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900 dark:text-white">
                  {session.product_id.slice(0, 8)}...
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {formatCurrency(session.amount, session.currency)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(session.status)}`}>
                  {session.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                {formatDate(session.created_at)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                {formatDate(session.expires_at)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                {session.status === 'pending' && (
                  <button
                    onClick={() => handleCancelSession(session.session_id)}
                    disabled={cancelingId === session.session_id}
                    className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50"
                  >
                    {cancelingId === session.session_id ? tCancel('loading') : tCancel('label')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
