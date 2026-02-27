'use client';

import React, { useState, useEffect } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useTranslations } from 'next-intl';
import { WebhookLog } from '@/types/webhooks';
import WebhookLogsTable from './webhooks/WebhookLogsTable';
import { api } from '@/lib/api/client';

interface WebhookFailuresPanelProps {
  refreshTrigger: number; // To reload when main list updates
  onRefresh?: () => void; // Callback to refresh parent component
}

export default function WebhookFailuresPanel({ refreshTrigger, onRefresh }: WebhookFailuresPanelProps) {
  const t = useTranslations('admin.webhooks.logs');
  const tCommon = useTranslations('common');
  const { addToast } = useToast();

  const [failures, setFailures] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [showInactiveWarning, setShowInactiveWarning] = useState(false);
  const [pendingRetryLog, setPendingRetryLog] = useState<WebhookLog | null>(null);

  const fetchFailures = async () => {
    try {
      setLoading(true);
      // Use v1 API for webhook logs
      const response = await api.list<WebhookLog>('webhooks/logs', {
        status: 'failed',
        limit: 5,
      });
      setFailures(response.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFailures();
  }, [refreshTrigger]);

  const handleRetryClick = (logId: string) => {
    const log = failures.find(f => f.id === logId);
    if (!log) return;

    // Check if endpoint is inactive
    if (log.endpoint && !log.endpoint.is_active) {
      setPendingRetryLog(log);
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
        fetchFailures();
        onRefresh?.();
      }, 500);
    } catch {
      addToast(tCommon('error'), 'error');
    } finally {
      setRetrying(null);
    }
  };

  const confirmInactiveRetry = () => {
    if (pendingRetryLog) {
      executeRetry(pendingRetryLog.id);
    }
    setShowInactiveWarning(false);
    setPendingRetryLog(null);
  };

  const cancelInactiveRetry = () => {
    setShowInactiveWarning(false);
    setPendingRetryLog(null);
  };

  if (loading && failures.length === 0) return null;
  if (failures.length === 0) return null;

  return (
    <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl overflow-hidden mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="px-6 py-4 border-b border-red-200 dark:border-red-800 flex justify-between items-center bg-red-100/50 dark:bg-red-900/20">
        <div className="flex items-center space-x-2">
          <div className="bg-red-100 text-red-600 rounded-full p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-red-800 dark:text-red-200">
            {t('failuresTitle')}
          </h3>
        </div>
        <button 
          onClick={fetchFailures}
          className="text-red-600 hover:text-red-800 dark:text-red-400 text-sm flex items-center transition-colors"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {tCommon('refresh')}
        </button>
      </div>
      
      {/* Use the shared table component */}
      <WebhookLogsTable
        logs={failures}
        onRetry={handleRetryClick}
        retryingId={retrying}
        showEndpointColumn={true}
        onRefresh={fetchFailures}
      />

      {/* Inactive Endpoint Warning Modal */}
      {showInactiveWarning && pendingRetryLog && (
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
    </div>
  );
}