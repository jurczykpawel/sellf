'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { RefundRequest } from '@/types';

const formatPrice = (price: number | null, currency: string | null = 'USD', naLabel = 'N/A', invalidLabel = 'Invalid Price') => {
  if (price === null) return naLabel;
  const numericPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numericPrice)) return invalidLabel;

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(numericPrice / 100); // Convert cents to dollars
};

const formatDate = (dateString: string | null, naLabel = 'N/A') => {
  if (!dateString) return naLabel;
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function RefundRequestsPage() {
  const t = useTranslations('refundRequests');
  const [requests, setRequests] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RefundRequest | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');
  const [adminResponse, setAdminResponse] = useState('');

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);

      const response = await fetch(`/api/v1/refund-requests?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) throw new Error(data.error?.message || 'Failed to fetch');

      setRequests(data.data || []);
    } catch (err) {
      const error = err as Error;
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const openActionModal = (request: RefundRequest, action: 'approve' | 'reject') => {
    setSelectedRequest(request);
    setActionType(action);
    setAdminResponse('');
    setActionModalOpen(true);
  };

  const processRequest = async () => {
    if (!selectedRequest) return;

    try {
      setProcessingId(selectedRequest.id);

      const response = await fetch(`/api/v1/refund-requests/${selectedRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionType,
          admin_response: adminResponse || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error?.message || 'Failed to process');

      setActionModalOpen(false);
      setSelectedRequest(null);
      await fetchRequests();
    } catch (err) {
      const error = err as Error;
      alert(error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusStyles: Record<string, string> = {
      pending: 'bg-gf-warning-soft text-gf-warning',
      approved: 'bg-gf-success-soft text-gf-success',
      rejected: 'bg-gf-danger-soft text-gf-danger',
      cancelled: 'bg-gf-raised text-gf-muted',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status] || statusStyles.pending}`}>
        {t(status, { defaultValue: status.charAt(0).toUpperCase() + status.slice(1) })}
      </span>
    );
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gf-heading">
          {t('title', { defaultValue: 'Refund Requests' })}
        </h1>
        <p className="text-gf-body mt-1">
          {t('subtitle', { defaultValue: 'Review and process customer refund requests' })}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-gf-border rounded-lg bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent"
        >
          <option value="">{t('allStatuses', { defaultValue: 'All Statuses' })}</option>
          <option value="pending">{t('pending', { defaultValue: 'Pending' })}</option>
          <option value="approved">{t('approved', { defaultValue: 'Approved' })}</option>
          <option value="rejected">{t('rejected', { defaultValue: 'Rejected' })}</option>
          <option value="cancelled">{t('cancelled', { defaultValue: 'Cancelled' })}</option>
        </select>

        <button
          onClick={fetchRequests}
          className="px-4 py-2 bg-gf-accent hover:bg-gf-accent-hover text-gf-inverse rounded-lg transition-colors"
        >
          {t('refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-gf-danger-soft border border-gf-danger/20 rounded-lg text-gf-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gf-accent"></div>
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 bg-gf-raised rounded-lg">
          <div className="text-4xl mb-4">📋</div>
          <p className="text-gf-muted">
            {t('noRequests', { defaultValue: 'No refund requests found' })}
          </p>
        </div>
      ) : (
        <div className="bg-gf-base rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gf-border">
            <thead className="bg-gf-raised">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                  {t('product', { defaultValue: 'Product' })}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                  {t('customer', { defaultValue: 'Customer' })}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                  {t('amount', { defaultValue: 'Amount' })}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                  {t('status', { defaultValue: 'Status' })}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">
                  {t('requestedOn', { defaultValue: 'Requested' })}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gf-muted uppercase tracking-wider">
                  {t('actions', { defaultValue: 'Actions' })}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gf-border">
              {requests.map((request) => (
                <tr key={request.id} className="hover:bg-gf-hover">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gf-heading">
                      {request.product_name}
                    </div>
                    <div className="text-xs text-gf-muted">
                      {t('purchasedOn', { defaultValue: 'Purchased' })}: {formatDate(request.purchase_date || null, t('naLabel'))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gf-heading">
                      {request.customer_email}
                    </div>
                    {request.reason && (
                      <div className="text-xs text-gf-muted max-w-xs truncate" title={request.reason}>
                        {t('reason', { defaultValue: 'Reason' })}: {request.reason}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gf-heading">
                      {formatPrice(request.requested_amount, request.currency, t('naLabel'), t('invalidPrice'))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(request.status)}
                    {request.processed_at && (
                      <div className="text-xs text-gf-muted mt-1">
                        {formatDate(request.processed_at, t('naLabel'))}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gf-muted">
                    {formatDate(request.created_at, t('naLabel'))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {request.status === 'pending' ? (
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => openActionModal(request, 'approve')}
                          disabled={processingId === request.id}
                          className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-md hover:bg-green-700 disabled:opacity-50"
                        >
                          {t('approve', { defaultValue: 'Approve' })}
                        </button>
                        <button
                          onClick={() => openActionModal(request, 'reject')}
                          disabled={processingId === request.id}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 disabled:opacity-50"
                        >
                          {t('reject', { defaultValue: 'Reject' })}
                        </button>
                      </div>
                    ) : request.admin_response ? (
                      <span className="text-xs text-gf-muted max-w-xs truncate block" title={request.admin_response}>
                        {request.admin_response}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Action Modal */}
      {actionModalOpen && selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gf-base rounded-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gf-heading mb-4">
              {actionType === 'approve'
                ? t('approveTitle', { defaultValue: 'Approve Refund Request' })
                : t('rejectTitle', { defaultValue: 'Reject Refund Request' })}
            </h2>

            <div className="mb-4 p-4 bg-gf-raised rounded-lg">
              <div className="text-sm text-gf-heading font-medium">
                {selectedRequest.product_name}
              </div>
              <div className="text-sm text-gf-body">
                {selectedRequest.customer_email}
              </div>
              <div className="text-lg font-bold text-gf-heading mt-2">
                {formatPrice(selectedRequest.requested_amount, selectedRequest.currency, t('naLabel'), t('invalidPrice'))}
              </div>
              {selectedRequest.reason && (
                <div className="mt-2 text-sm text-gf-body">
                  <span className="font-medium">{t('customerReason', { defaultValue: 'Customer reason' })}:</span>{' '}
                  {selectedRequest.reason}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gf-body mb-2">
                {actionType === 'approve'
                  ? t('approveNote', { defaultValue: 'Note (optional)' })
                  : t('rejectReason', { defaultValue: 'Reason for rejection' })}
              </label>
              <textarea
                value={adminResponse}
                onChange={(e) => setAdminResponse(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gf-border rounded-lg bg-gf-input text-gf-heading focus:ring-2 focus:ring-gf-accent"
                placeholder={
                  actionType === 'approve'
                    ? t('approveNotePlaceholder', { defaultValue: 'Add any notes for the customer...' })
                    : t('rejectReasonPlaceholder', { defaultValue: 'Explain why the refund was rejected...' })
                }
              />
            </div>

            {actionType === 'approve' && (
              <div className="mb-4 p-4 bg-gf-warning-soft border border-gf-warning/20 rounded-lg">
                <div className="flex items-start">
                  <svg className="h-5 w-5 text-gf-warning mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-gf-warning">
                    {t('approveWarning', { defaultValue: 'This will process the refund through Stripe and revoke product access.' })}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setActionModalOpen(false)}
                disabled={processingId !== null}
                className="flex-1 px-4 py-2 border border-gf-border text-gf-body rounded-lg hover:bg-gf-hover transition-colors disabled:opacity-50"
              >
                {t('cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={processRequest}
                disabled={processingId !== null}
                className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 ${
                  actionType === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {processingId
                  ? t('processing', { defaultValue: 'Processing...' })
                  : actionType === 'approve'
                  ? t('confirmApprove', { defaultValue: 'Approve & Refund' })
                  : t('confirmReject', { defaultValue: 'Reject Request' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
