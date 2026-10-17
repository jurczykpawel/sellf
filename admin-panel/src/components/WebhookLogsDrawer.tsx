'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
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

  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'success' | 'failed' | 'archived' | 'retried'>('all');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [showInactiveWarning, setShowInactiveWarning] = useState(false);
  const [pendingRetryLogId, setPendingRetryLogId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      // Use v1 API for webhook logs
      const response = await api.list<WebhookLog>('webhooks/logs', {
        endpoint_id: endpoint.id,
        status: filter === 'failed' ? 'all_failed' : filter,
        limit: 50,
      });
      setLogs(response.data || []);
    } catch (err) {
      console.error(err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [endpoint.id, filter, t]);

  const requestKey = JSON.stringify([endpoint.id, filter, isOpen]);
  const [previousKey, setPreviousKey] = useState(requestKey);
  if (previousKey !== requestKey) {
    setPreviousKey(requestKey);
   setLoading(true);
  }
 const fetchLogs = () => {
   setLoading(true);
   return loadLogs();
 };

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- State is updated only after awaiting the request.
    loadLogs();
    }
  }, [loadLogs, isOpen]);

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
        toast.success(t('retrySuccess'));
      } else {
        toast.error(data.error || t('retryFailed'));
      }

      // Always refresh, even if retry failed, because database was updated
      setTimeout(() => {
        fetchLogs(); // Refresh logs to show new attempt
        onRefresh?.(); // Refresh main webhooks page (failures panel, etc.)
      }, 500);
    } catch {
      toast.error(tCommon('error'));
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
                className="px-3 py-2 border-2 border-sf-border-medium bg-sf-input text-sf-heading text-sm focus:outline-none focus:ring-2 focus:ring-sf-accent"
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sf-accent"></div>
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-10 text-sf-muted border border-dashed border-sf-border">
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
          <div className="bg-sf-base p-6 w-full max-w-md">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-sf-heading">
                  {t('inactiveEndpointWarningTitle')}
                </h3>
                <p className="mt-2 text-sm text-sf-body">
                  {t('inactiveEndpointWarningMessage')}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={cancelInactiveRetry}
                className="px-4 py-2 text-sm font-medium text-sf-body bg-sf-base border-2 border-sf-border-medium hover:bg-sf-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sf-accent"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={confirmInactiveRetry}
                className="px-4 py-2 text-sm font-medium text-sf-inverse bg-sf-warning border border-transparent hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sf-warning"
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
