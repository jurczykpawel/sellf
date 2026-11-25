'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { api, ApiError, isExpectedApiError } from '@/lib/api/client';
import { runBatch } from '@/lib/webhooks/batch-runner';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import type { WebhookLog } from '@/types/webhooks';

export type DeliveryFilter =
  | 'permanently_failed'
  | 'pending_retry'
  | 'all_failed'
  | 'success'
  | 'failed'
  | 'archived'
  | 'retried'
  | 'all';

export function useWebhookDeliveries() {
  const t = useTranslations('admin.webhooks.logs');
  const tCommon = useTranslations('common');

  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilterValue] = useState<DeliveryFilter>('permanently_failed');
  const [cursors, setCursors] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const cursor = cursors.at(-1);
  const beginRequest = useLatestRequest(JSON.stringify([filter, cursor]));

  const loadLogs = useCallback(async (refresh = false) => {
    const isCurrent = beginRequest();
    if (!isCurrent()) return;
    if (refresh) setLoading(true);
    try {
      const response = await api.list<WebhookLog>('webhooks/logs', { status: filter, limit: 50, cursor });
      if (!isCurrent()) return;
      setLogs(response.data || []);
      setNextCursor(response.pagination?.next_cursor ?? null);
    } catch (err) {
      if (!isCurrent() || isExpectedApiError(err)) return;
      console.error('[useWebhookDeliveries] fetch failed', err);
      toast.error(t('loadError'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [filter, cursor, beginRequest, t]);

  const goToPage = (pageCursors: string[]) => {
    setLoading(true);
    setLogs([]);
    setNextCursor(null);
    setCursors(pageCursors);
  };

  const setFilter = (value: DeliveryFilter) => {
    if (value === filter) return;
    setFilterValue(value);
    goToPage([]);
  };

  const fetchLogs = useCallback(() => loadLogs(true), [loadLogs]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const replay = useCallback(
    async (logId: string) => {
      setReplayingId(logId);
      try {
        await api.postCustom(`webhooks/logs/${logId}/replay`, {});
        toast.success(t('replaySuccess'));
        await fetchLogs();
      } catch (err) {
        if (isExpectedApiError(err)) return;
        console.error(err);
        toast.error(t(err instanceof ApiError && err.status === 409 && err.message.startsWith('Endpoint URL changed') ? 'destinationChanged' : 'replayError'));
      } finally {
        setReplayingId(null);
      }
    },
    [fetchLogs, t],
  );

  const forceRetry = useCallback(
    async (logId: string) => {
      setActingId(logId);
      try {
        await api.postCustom(`webhooks/logs/${logId}/force-retry`, {});
        toast.success(t('forceRetrySuccess'));
        await fetchLogs();
      } catch (err) {
        if (isExpectedApiError(err)) return;
        console.error(err);
        toast.error(err instanceof ApiError && err.status === 409 && err.message.startsWith('Endpoint URL changed') ? t('destinationChanged') : tCommon('error'));
      } finally {
        setActingId(null);
      }
    },
    [fetchLogs, t, tCommon],
  );

  const cancel = useCallback(
    async (logId: string) => {
      setActingId(logId);
      try {
        await api.postCustom(`webhooks/logs/${logId}/cancel`, {});
        toast.success(t('cancelSuccess'));
        await fetchLogs();
      } catch (err) {
        if (isExpectedApiError(err)) return;
        console.error(err);
        toast.error(tCommon('error'));
      } finally {
        setActingId(null);
      }
    },
    [fetchLogs, t, tCommon],
  );

  const [batchRunning, setBatchRunning] = useState(false);

  const batchReplay = useCallback(
    async (logIds: string[]) => {
      if (logIds.length === 0) return;
      setBatchRunning(true);
      try {
        const { succeeded, failed } = await runBatch(logIds, (id) =>
          api.postCustom(`webhooks/logs/${id}/replay`, {}),
        );
        if (failed === 0) toast.success(t('batchReplaySuccess', { count: succeeded }));
        else toast.warning(t('batchReplayPartial', { succeeded, failed }));
        await fetchLogs();
      } finally {
        setBatchRunning(false);
      }
    },
    [fetchLogs, t],
  );

  const batchCancel = useCallback(
    async (logIds: string[]) => {
      if (logIds.length === 0) return;
      setBatchRunning(true);
      try {
        const { succeeded, failed } = await runBatch(logIds, (id) =>
          api.postCustom(`webhooks/logs/${id}/cancel`, {}),
        );
        if (failed === 0) toast.success(t('batchCancelSuccess', { count: succeeded }));
        else toast.warning(t('batchCancelPartial', { succeeded, failed }));
        await fetchLogs();
      } finally {
        setBatchRunning(false);
      }
    },
    [fetchLogs, t],
  );

  const batchForceRetry = useCallback(
    async (logIds: string[]) => {
      if (logIds.length === 0) return;
      setBatchRunning(true);
      try {
        const { succeeded, failed } = await runBatch(logIds, (id) =>
          api.postCustom(`webhooks/logs/${id}/force-retry`, {}),
        );
        if (failed === 0) toast.success(t('batchForceRetrySuccess', { count: succeeded }));
        else toast.warning(t('batchForceRetryPartial', { succeeded, failed }));
        await fetchLogs();
      } finally {
        setBatchRunning(false);
      }
    },
    [fetchLogs, t],
  );

  return {
    logs,
    loading,
    filter,
    setFilter,
    page: cursors.length + 1,
    hasNextPage: nextCursor !== null,
    nextPage: () => {
      if (!loading && nextCursor) goToPage([...cursors, nextCursor]);
    },
    previousPage: () => {
      if (!loading && cursors.length) goToPage(cursors.slice(0, -1));
    },
    replay,
    forceRetry,
    cancel,
    batchReplay,
    batchForceRetry,
    batchCancel,
    batchRunning,
    replayingId,
    actingId,
    refresh: fetchLogs,
  };
}
