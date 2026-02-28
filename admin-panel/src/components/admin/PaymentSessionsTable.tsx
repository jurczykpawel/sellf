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
        return 'bg-gf-warning-soft text-gf-warning';
      case 'completed':
        return 'bg-gf-success-soft text-gf-success';
      case 'failed':
        return 'bg-gf-danger-soft text-gf-danger';
      case 'cancelled':
        return 'bg-gf-raised text-gf-body';
      default:
        return 'bg-gf-raised text-gf-body';
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-gf-muted">
          No payment sessions found.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gf-border">
        <thead className="bg-gf-raised">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
              Session
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
              Customer
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
              Product
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
              Amount
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
              Created
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
              Expires
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-gf-base divide-y divide-gf-border">
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gf-heading">
                  {session.session_id.slice(0, 20)}...
                </div>
                <div className="text-sm text-gf-muted">
                  {session.provider_type}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gf-heading">
                  {session.customer_email}
                </div>
                {session.user_id && (
                  <div className="text-sm text-gf-muted">
                    {session.user_id.slice(0, 8)}...
                  </div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gf-heading">
                  {session.product_id.slice(0, 8)}...
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gf-heading">
                  {formatCurrency(session.amount, session.currency)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(session.status)}`}>
                  {session.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gf-muted">
                {formatDate(session.created_at)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gf-muted">
                {formatDate(session.expires_at)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                {session.status === 'pending' && (
                  <button
                    onClick={() => handleCancelSession(session.session_id)}
                    disabled={cancelingId === session.session_id}
                    className="text-gf-danger hover:opacity-80 disabled:opacity-50"
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
