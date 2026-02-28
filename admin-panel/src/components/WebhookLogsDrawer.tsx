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
      addToast(t('loadError'), 'error');
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
                className="px-3 py-2 border border-gf-border rounded-lg bg-gf-input text-gf-heading text-sm focus:outline-none focus:ring-2 focus:ring-gf-accent"
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gf-accent"></div>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-10 text-gf-muted border border-dashed border-gf-border rounded-lg">
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
          <div className="bg-gf-base rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gf-heading">
                  {t('inactiveEndpointWarningTitle')}
                </h3>
                <p className="mt-2 text-sm text-gf-body">
                  {t('inactiveEndpointWarningMessage')}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={cancelInactiveRetry}
                className="px-4 py-2 text-sm font-medium text-gf-body bg-gf-base border border-gf-border rounded-md shadow-sm hover:bg-gf-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-accent"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={confirmInactiveRetry}
                className="px-4 py-2 text-sm font-medium text-gf-inverse bg-gf-warning border border-transparent rounded-md shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gf-warning"
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