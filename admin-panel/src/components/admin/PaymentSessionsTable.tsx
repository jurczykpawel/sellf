// components/admin/PaymentSessionsTable.tsx
// Payment sessions table for admin dashboard

'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { formatAdminDate } from '@/lib/timezone';
import type { PaymentSession } from '@/types/payment';

interface PaymentSessionsTableProps {
  sessions: PaymentSession[];
  onRefreshData?: () => void;
}

export default function PaymentSessionsTable({ 
  sessions, 
  onRefreshData 
}: PaymentSessionsTableProps) {
  const locale = useLocale();
  const tCancel = useTranslations('admin.payments.cancelSession');
  const t = useTranslations('admin.payments.sessions');
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const handleCancelSession = async (sessionId: string) => {
    if (cancelingId) return;
    
    setCancelingId(sessionId);
    
    try {
      const response = await fetch(`/api/admin/payments/sessions/${sessionId}/cancel`, {
        method: 'POST',
      });
      
      if (response.ok) {
        toast.success(tCancel('success'));
        onRefreshData?.();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || tCancel('error'));
      }
    } catch {
      toast.error(tCancel('error'));
    } finally {
      setCancelingId(null);
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-sf-warning-soft text-sf-warning';
      case 'completed':
        return 'bg-sf-success-soft text-sf-success';
      case 'failed':
        return 'bg-sf-danger-soft text-sf-danger';
      case 'cancelled':
        return 'bg-sf-raised text-sf-body';
      default:
        return 'bg-sf-raised text-sf-body';
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-sf-muted">
          {t('empty')}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-sf-border">
        <thead className="bg-sf-raised">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('session')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('customer')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('product')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('amount')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('status')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('created')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('expires')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('actions')}
            </th>
          </tr>
        </thead>
        <tbody className="bg-sf-base divide-y divide-sf-border">
          {sessions.map((session, index) => (
            <tr key={session.id} className={index % 2 === 1 ? 'bg-sf-row-alt' : ''}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-sf-heading">
                  {session.session_id.slice(0, 20)}...
                </div>
                <div className="text-sm text-sf-muted">
                  {session.provider_type}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-sf-heading">
                  {session.customer_email}
                </div>
                {session.user_id && (
                  <div className="text-sm text-sf-muted">
                    {session.user_id.slice(0, 8)}...
                  </div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-sf-heading">
                  {session.product_id.slice(0, 8)}...
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-sf-heading">
                  {formatCurrency(session.amount, session.currency)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold ${getStatusColor(session.status)}`}>
                  {t(`statuses.${session.status}`)}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-sf-muted">
                {formatAdminDate(session.created_at, locale)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-sf-muted">
                {formatAdminDate(session.expires_at, locale)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                {session.status === 'pending' && (
                  <button
                    onClick={() => handleCancelSession(session.session_id)}
                    disabled={cancelingId === session.session_id}
                    className="text-sf-danger hover:opacity-80 disabled:opacity-50"
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
