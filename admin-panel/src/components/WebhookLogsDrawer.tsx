'use client';

import React, { useState, useEffect } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { WebhookLog, WebhookEndpoint } from '@/types/webhooks';
import { BaseModal, ModalHeader, ModalBody, ModalFooter, Button } from './ui/Modal';
import { useTranslations } from 'next-intl';
import WebhookLogsTable from './webhooks/WebhookLogsTable';
import { api } from '@/lib/api/client';

interface WebhookLogsDrawerProps {
  endpoint: WebhookEndpoint;
  onClose: () => void;
  isOpen: boolean;
  onRefresh?: () => void;
}

export default function WebhookLogsDrawer({ endpoint, onClose, isOpen, onRefresh }: WebhookLogsDrawerProps) {
  const t = useTranslations('admin.webhooks.logs');
  const tCommon = useTranslations('common');
  const { addToast } = useToast();

  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'success' | 'failed' | 'archived' | 'retried'>('failed');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [showInactiveWarning, setShowInactiveWarning] = useState(false);
  const [pendingRetryLogId, setPendingRetryLogId] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      // Use v1 API for webhook logs
      const response = await api.list<WebhookLog>('webhooks/logs', {
        endpoint_id: endpoint.id,
        status: filter,
        limit: 50,
      });
      setLogs(response.data || []);
    } catch (err) {
      console.error(err);
      addToast('Failed to load logs', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, filter, endpoint.id]);

  const handleRetryClick = (logId: string) => {
    // Check if endpoint is inactive
    if (!endpoint.is_active) {
      setPendingRetryLogId(logId);
      setShowInactiveWarning(true);
      return;
    }

    // If active, proceed directly
    executeRetry(logId);
  };

  const executeRetry = async (logId: string) => {
    setRetrying(logId);
    try {
      // Use v1 API for retry
      const data = await api.postCustom<{ success: boolean; error?: string }>(
        `webhooks/logs/${logId}/retry`,
        {}
      );

      // Show appropriate toast based on result
      if (data.success) {
        addToast(t('retrySuccess'), 'success');
      } else {
        addToast(data.error || t('retryFailed'), 'error');
      }

      // Always refresh, even if retry failed, because database was updated
      setTimeout(() => {
        fetchLogs(); // Refresh logs to show new attempt
        onRefresh?.(); // Refresh main webhooks page (failures panel, etc.)
      }, 500);
    } catch {
      addToast(tCommon('error'), 'error');
    } finally {
      setRetrying(null);
    }
  };

  const confirmInactiveRetry = () => {
    if (pendingRetryLogId) {
      executeRetry(pendingRetryLogId);
    }
    setShowInactiveWarning(false);
    setPendingRetryLogId(null);
  };

  const cancelInactiveRetry = () => {
    setShowInactiveWarning(false);
    setPendingRetryLogId(null);
  };

  return (
    <>
      {isOpen && (
        <BaseModal isOpen={isOpen} onClose={onClose} size="xl">
          <ModalHeader title={t('title')} subtitle={endpoint.url} />
          <ModalBody>
            <div className="flex justify-end mb-4">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">{t('filterAll')}</option>
                <option value="success">{t('filterSuccess')}</option>
                <option value="failed">{t('filterFailed')}</option>
                <option value="retried">{t('filterRetried')}</option>
                <option value="archived">{t('filterArchived')}</option>
              </select>
            </div>

            {loading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-10 text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                {t('noLogs')}
              </div>
            ) : (
              <WebhookLogsTable
                logs={logs}
                onRetry={handleRetryClick}
                retryingId={retrying}
                showEndpointColumn={false}
                onRefresh={fetchLogs}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button onClick={onClose} variant="secondary">{tCommon('close')}</Button>
          </ModalFooter>
        </BaseModal>
      )}

      {/* Inactive Endpoint Warning Modal - Outside BaseModal */}
      {showInactiveWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t('inactiveEndpointWarningTitle')}
                </h3>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  {t('inactiveEndpointWarningMessage')}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={cancelInactiveRetry}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-500 dark:hover:bg-gray-600"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={confirmInactiveRetry}
                className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 border border-transparent rounded-md shadow-sm hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
              >
                {t('retryAnyway')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}