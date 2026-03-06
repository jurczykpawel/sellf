'use client';

import React, { useState } from 'react';
import { WebhookEndpoint } from '@/types/webhooks';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

interface WebhookListTableProps {
  endpoints: WebhookEndpoint[];
  onEdit: (endpoint: WebhookEndpoint) => void;
  onDelete: (endpoint: WebhookEndpoint) => void;
  onTest: (endpoint: WebhookEndpoint) => void;
  onLogs: (endpoint: WebhookEndpoint) => void;
  onToggleStatus: (endpointId: string, currentStatus: boolean) => void;
}

const WebhookRow = ({
  endpoint,
  onEdit,
  onDelete,
  onTest,
  onLogs,
  onToggleStatus,
  getEventLabel
}: {
  endpoint: WebhookEndpoint;
  onEdit: (e: WebhookEndpoint) => void;
  onDelete: (e: WebhookEndpoint) => void;
  onTest: (e: WebhookEndpoint) => void;
  onLogs: (e: WebhookEndpoint) => void;
  onToggleStatus: (endpointId: string, currentStatus: boolean) => void;
  getEventLabel: (key: string) => string;
}) => {
  const [showSecret, setShowSecret] = useState(false);
  const t = useTranslations('admin.webhooks');
  const tCommon = useTranslations('common');

  const handleCopySecret = () => {
    if (endpoint.secret) {
      navigator.clipboard.writeText(endpoint.secret);
      toast.success(t('secretCopied'));
    }
  };

  return (
    <tr className={`hover:bg-sf-hover transition-colors`}>
      <td className="px-6 py-4">
        <div className="text-sm font-medium text-sf-heading truncate max-w-xs" title={endpoint.description || endpoint.url}>
          {endpoint.description || endpoint.url}
        </div>
        <div className="text-xs text-sf-muted mt-0.5 truncate max-w-xs font-mono">
          {endpoint.url}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-wrap gap-1">
          {endpoint.events.map((ev) => (
            <span
              key={ev}
              className="inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-sf-accent-soft text-sf-accent border-2 border-sf-border-medium whitespace-nowrap"
            >
              {getEventLabel(ev)}
            </span>
          ))}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center space-x-2">
          <code className="text-xs bg-sf-raised px-2 py-1 border-2 border-sf-border-medium font-mono text-sf-body">
            {showSecret ? endpoint.secret : 'sf_••••••••••••••••'}
          </code>
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="text-sf-muted hover:text-sf-body"
            title={showSecret ? t('hideSecret') : t('revealSecret')}
          >
            {showSecret ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
          <button
            onClick={handleCopySecret}
            className="text-sf-muted hover:text-sf-body"
            title={t('copySecret')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-center">
        <button
          onClick={() => onToggleStatus(endpoint.id, endpoint.is_active)}
          className={`px-2 inline-flex text-xs leading-5 font-semibold cursor-pointer transition-colors hover:opacity-80 ${
            endpoint.is_active ? 'bg-sf-success-soft text-sf-success' : 'bg-sf-raised text-sf-muted'
          }`}
        >
          {endpoint.is_active ? t('active') : tCommon('inactive')}
        </button>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
        <button
          onClick={() => onLogs(endpoint)}
          className="text-sf-body hover:text-sf-heading transition-colors"
        >
          {t('logsButtonLabel')}
        </button>
        <button
          onClick={() => onTest(endpoint)}
          className="text-sf-accent hover:text-sf-heading transition-colors"
        >
          {t('test')}
        </button>
        <button
          onClick={() => onEdit(endpoint)}
          className="text-sf-accent hover:text-sf-heading transition-colors"
        >
          {t('edit')}
        </button>
        <button
          onClick={() => onDelete(endpoint)}
          className="text-sf-danger hover:text-sf-heading transition-colors"
        >
          {t('delete')}
        </button>
      </td>
    </tr>
  );
};

export default function WebhookListTable({
  endpoints,
  onEdit,
  onDelete,
  onTest,
  onLogs,
  onToggleStatus
}: WebhookListTableProps) {
  const t = useTranslations('admin.webhooks');
  const tCommon = useTranslations('common');

  const getEventLabel = (eventValue: string) => {
    const key = eventValue.replace('.', '_');
    try {
      return t(`events_list.${key}`);
    } catch {
      return eventValue;
    }
  };

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium overflow-x-auto">
      <table className="min-w-full divide-y divide-sf-border-subtle">
        <thead className="bg-sf-raised">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('description')} / {t('url')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('events')}
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('secret')}
            </th>
            <th className="px-6 py-3 text-center text-xs font-medium text-sf-muted uppercase tracking-wider">
              {t('active')}
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-sf-muted uppercase tracking-wider">
              {tCommon('actions')}
            </th>
          </tr>
        </thead>
        <tbody className="bg-sf-base divide-y divide-sf-border-subtle">
          {endpoints.map((endpoint) => (
            <WebhookRow
              key={endpoint.id}
              endpoint={endpoint}
              onEdit={onEdit}
              onDelete={onDelete}
              onTest={onTest}
              onLogs={onLogs}
              onToggleStatus={onToggleStatus}
              getEventLabel={getEventLabel}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}