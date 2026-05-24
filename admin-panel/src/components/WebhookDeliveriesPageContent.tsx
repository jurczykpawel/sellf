'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useWebhookDeliveries, type DeliveryFilter } from '@/hooks/useWebhookDeliveries';
import { computeEligibility } from '@/lib/webhooks/selection-eligibility';
import WebhookLogsTable from './webhooks/WebhookLogsTable';
import WebhookBatchConfirmModal from './webhooks/WebhookBatchConfirmModal';

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
  const {
    logs, loading, filter, setFilter,
    replay, forceRetry, cancel,
    batchReplay, batchForceRetry, batchCancel, batchRunning,
    replayingId, actingId, refresh,
  } = useWebhookDeliveries();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Derive visible-only selection in render (no effect → no cascading render).
  // Stale IDs (from a previous filter) are filtered out for display + actions.
  const visibleSelected = useMemo(() => {
    const visible = new Set(logs.map((l) => l.id));
    const next = new Set<string>();
    selectedIds.forEach((id) => {
      if (visible.has(id)) next.add(id);
    });
    return next;
  }, [logs, selectedIds]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedArray = Array.from(visibleSelected);
  const selectedCount = selectedArray.length;

  const eligibleByAction = useMemo(
    () => computeEligibility(logs, visibleSelected),
    [logs, visibleSelected],
  );

  const [confirmVariant, setConfirmVariant] = useState<'replay' | 'force-retry' | 'cancel' | null>(null);

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

      {selectedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-sf-accent-soft border-2 border-sf-accent flex-wrap">
          <span className="text-sm font-medium text-sf-heading">
            {t('selectedCount', { count: selectedCount })}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setConfirmVariant('replay')}
            disabled={batchRunning || eligibleByAction.replayIds.length === 0}
            title={
              eligibleByAction.replayIds.length === 0
                ? t('batchReplayDisabledHint')
                : undefined
            }
            className="px-3 py-1.5 text-xs font-medium border border-sf-border bg-sf-base text-sf-accent hover:bg-sf-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {batchRunning ? '...' : `${t('batchReplay')} (${eligibleByAction.replayIds.length})`}
          </button>
          <button
            type="button"
            onClick={() => setConfirmVariant('force-retry')}
            disabled={batchRunning || eligibleByAction.forceRetryIds.length === 0}
            title={
              eligibleByAction.forceRetryIds.length === 0
                ? t('batchForceRetryDisabledHint')
                : undefined
            }
            className="px-3 py-1.5 text-xs font-medium border border-sf-border bg-sf-base text-sf-accent hover:bg-sf-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {batchRunning ? '...' : `${t('batchForceRetry')} (${eligibleByAction.forceRetryIds.length})`}
          </button>
          <button
            type="button"
            onClick={() => setConfirmVariant('cancel')}
            disabled={batchRunning || eligibleByAction.cancelIds.length === 0}
            title={
              eligibleByAction.cancelIds.length === 0
                ? t('batchCancelDisabledHint')
                : undefined
            }
            className="px-3 py-1.5 text-xs font-medium border border-sf-border bg-sf-base text-sf-muted hover:text-sf-danger hover:bg-sf-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {batchRunning ? '...' : `${t('batchCancel')} (${eligibleByAction.cancelIds.length})`}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            disabled={batchRunning}
            className="px-3 py-1.5 text-xs text-sf-muted hover:text-sf-heading disabled:opacity-50"
          >
            {t('clearSelection')}
          </button>
        </div>
      )}

      <WebhookBatchConfirmModal
        isOpen={confirmVariant !== null}
        variant={confirmVariant ?? 'replay'}
        count={
          confirmVariant === 'replay' ? eligibleByAction.replayIds.length
            : confirmVariant === 'force-retry' ? eligibleByAction.forceRetryIds.length
            : confirmVariant === 'cancel' ? eligibleByAction.cancelIds.length
            : 0
        }
        busy={batchRunning}
        onClose={() => setConfirmVariant(null)}
        onConfirm={async () => {
          const variant = confirmVariant;
          setConfirmVariant(null);
          if (variant === 'replay') await batchReplay(eligibleByAction.replayIds);
          else if (variant === 'force-retry') await batchForceRetry(eligibleByAction.forceRetryIds);
          else if (variant === 'cancel') await batchCancel(eligibleByAction.cancelIds);
        }}
      />


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
          selectedIds={visibleSelected}
          onToggleSelected={toggleSelected}
        />
      )}
    </div>
  );
}
