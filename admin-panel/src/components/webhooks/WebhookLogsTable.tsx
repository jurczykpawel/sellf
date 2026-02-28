'use client';

import React, { useState } from 'react';
import { WebhookLog } from '@/types/webhooks';
import { useTranslations } from 'next-intl';
import { useToast } from '@/contexts/ToastContext';

interface WebhookLogsTableProps {
  logs: WebhookLog[];
  onRetry: (logId: string) => void;
  retryingId: string | null;
  showEndpointColumn?: boolean;
  onRefresh?: () => void;
}

export default function WebhookLogsTable({
  logs,
  onRetry,
  retryingId,
  showEndpointColumn = false,
  onRefresh
}: WebhookLogsTableProps) {
  const t = useTranslations('admin.webhooks.logs');
  const tCommon = useTranslations('common');
  const { addToast } = useToast();
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const getStatusBadge = (log: WebhookLog) => {
    if (log.status === 'success') {
      return (
        <span className="px-2 py-1 bg-gf-success-soft text-gf-success rounded text-xs font-medium border border-gf-success/20">
          HTTP {log.http_status}
        </span>
      );
    }
    if (log.status === 'retried') {
      return (
        <span className="px-2 py-1 bg-gf-warning-soft text-gf-warning rounded text-xs font-medium border border-gf-warning/20">
          {t('retried')}
        </span>
      );
    }
    if (log.status === 'archived') {
        return (
          <span className="px-2 py-1 bg-gf-raised text-gf-body rounded text-xs font-medium border border-gf-border">
            {t('archived')}
          </span>
        );
    }
    
    // Failed
    if (log.http_status === 0) {
      return <span className="px-2 py-1 bg-gf-danger-soft text-gf-danger rounded text-xs font-medium border border-gf-danger/20">{t('networkError')}</span>;
    }
    return <span className="px-2 py-1 bg-gf-danger-soft text-gf-danger rounded text-xs font-medium border border-gf-danger/20">HTTP {log.http_status}</span>;
  };

  const handleRetryClick = (e: React.MouseEvent, logId: string) => {
    e.stopPropagation();
    onRetry(logId);
  };

  const handleArchive = async (e: React.MouseEvent, logId: string) => {
    e.stopPropagation();
    setArchivingId(logId);
    try {
      const res = await fetch(`/api/v1/webhooks/logs/${logId}/archive`, {
        method: 'POST'
      });
      if (res.ok) {
        addToast(t('logArchived'), 'success');
        onRefresh?.();
      }
    } catch {
      addToast(t('archiveError'), 'error');
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div className="border border-gf-border rounded-lg overflow-hidden bg-gf-base shadow-sm">
      <table className="min-w-full divide-y divide-gf-border">
        <thead className="bg-gf-raised">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">{t('date')}</th>
            {showEndpointColumn && (
              <th className="px-4 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">{t('endpoint')}</th>
            )}
            <th className="px-4 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">{t('event')}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gf-muted uppercase tracking-wider">{t('status')}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gf-muted uppercase tracking-wider">{t('duration')}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gf-muted uppercase tracking-wider">{tCommon('actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gf-border">
          {logs.map((log) => (
            <React.Fragment key={log.id}>
              <tr 
                onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                className={`cursor-pointer transition-colors ${
                  expandedLog === log.id
                    ? 'bg-gf-accent-soft'
                    : 'hover:bg-gf-hover'
                }`}
              >
                <td className="px-4 py-3 text-sm text-gf-heading whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                
                {showEndpointColumn && (
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gf-heading max-w-[200px] truncate">
                      {log.endpoint?.description || 'Webhook'}
                    </div>
                    <div className="text-xs text-gf-muted font-mono truncate max-w-[200px]">
                      {log.endpoint?.url}
                    </div>
                  </td>
                )}

                <td className="px-4 py-3 text-sm text-gf-heading font-mono text-[10px]">
                  {log.event_type}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {getStatusBadge(log)}
                </td>
                <td className="px-4 py-3 text-sm text-gf-muted text-right whitespace-nowrap">
                  {log.duration_ms !== undefined ? `${log.duration_ms}ms` : '---'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                  {/* Resend button - available for all statuses except 'retried' */}
                  {log.status !== 'retried' && log.status !== 'archived' && (
                    <button
                      onClick={(e) => handleRetryClick(e, log.id)}
                      disabled={retryingId === log.id}
                      className={`inline-flex items-center px-2.5 py-1.5 border text-xs font-medium rounded disabled:opacity-50 transition-all ${
                        log.status === 'failed'
                          ? 'border-gf-border text-gf-accent bg-gf-accent-soft hover:bg-gf-hover'
                          : 'border-gf-border text-gf-body bg-gf-raised hover:bg-gf-hover'
                      }`}
                    >
                      {retryingId === log.id ? '...' : (log.status === 'failed' ? t('retry') : t('resend'))}
                    </button>
                  )}
                  {log.status === 'failed' && (
                    <button
                      onClick={(e) => handleArchive(e, log.id)}
                      disabled={archivingId === log.id}
                      title={t('archiveDismiss')}
                      className="inline-flex items-center p-1.5 border border-gf-border text-gf-muted hover:text-gf-danger rounded-md transition-colors"
                    >
                      {archivingId === log.id ? (
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12" />
                        </svg>
                      )}
                    </button>
                  )}
                </td>
              </tr>
              {expandedLog === log.id && (
                <tr className="bg-gf-raised">
                  <td colSpan={showEndpointColumn ? 6 : 5} className="px-4 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-bold text-gf-muted uppercase mb-2">{t('payload')}</h4>
                        <pre className="text-[10px] bg-gf-base p-3 rounded border border-gf-border overflow-x-auto h-48 font-mono text-gf-body">
                          {JSON.stringify(log.payload, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-gf-muted uppercase mb-2">{t('response')}</h4>
                        <div className="text-[10px] bg-gf-base p-3 rounded border border-gf-border h-48 overflow-y-auto">
                          {log.error_message && (
                            <div className="text-gf-danger font-medium mb-2 border-b border-gf-danger/20 pb-2">
                              {t('errorPrefix', { message: log.error_message })}
                            </div>
                          )}
                          <pre className="whitespace-pre-wrap font-mono text-gf-body">
                            {log.response_body || t('emptyResponse')}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
