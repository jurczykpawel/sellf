'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useWebhookDeliveries, type DeliveryFilter } from '@/hooks/useWebhookDeliveries';
import WebhookLogsTable from './webhooks/WebhookLogsTable';

const FILTER_ORDER: DeliveryFilter[] = [
  'permanently_failed',
  'pending_retry',
  'all_failed',
  'success',
  'failed',
  'retried',
  'archived',
  'all',
];

function filterLabelKey(filter: DeliveryFilter): string {
  switch (filter) {
    case 'permanently_failed': return 'filterPermanentlyFailed';
    case 'pending_retry': return 'filterPendingRetry';
    case 'all_failed': return 'filterAllFailed';
    case 'success': return 'filterSuccess';
    case 'failed': return 'filterFailed';
    case 'retried': return 'filterRetried';
    case 'archived': return 'filterArchived';
    case 'all': return 'filterAll';
  }
}

export default function WebhookDeliveriesPageContent() {
  const t = useTranslations('admin.webhooks.logs');
  const { logs, loading, filter, setFilter, replay, forceRetry, cancel, replayingId, actingId, refresh } =
    useWebhookDeliveries();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-sf-heading">{t('dlqPageTitle')}</h1>
        <p className="text-sm text-sf-muted">{t('dlqPageDescription')}</p>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_ORDER.map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`px-3 py-2 text-xs font-medium border-2 transition-colors ${
              filter === value
                ? 'border-sf-accent text-sf-accent bg-sf-accent-soft'
                : 'border-sf-border-medium text-sf-body bg-sf-base hover:bg-sf-hover'
            }`}
          >
            {t(filterLabelKey(value))}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sf-accent" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-sf-muted border-2 border-dashed border-sf-border-medium">
          {t('noLogs')}
        </div>
      ) : (
        <WebhookLogsTable
          logs={logs}
          showEndpointColumn
          onRetry={() => {
            /* legacy /retry path not used in DLQ; new actions go through Replay/Force/Cancel */
          }}
          retryingId={null}
          onReplay={replay}
          onForceRetry={forceRetry}
          onCancel={cancel}
          replayingId={replayingId}
          actingId={actingId}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
