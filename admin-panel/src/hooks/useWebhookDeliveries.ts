'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api/client';
import { runBatch } from '@/lib/webhooks/batch-runner';
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
  const [filter, setFilter] = useState<DeliveryFilter>('permanently_failed');
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.list<WebhookLog>('webhooks/logs', { status: filter, limit: 50 });
      setLogs(response.data || []);
    } catch (err) {
      console.error('[useWebhookDeliveries] fetch failed', err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [filter, t]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const replay = useCallback(
    async (logId: string) => {
      setReplayingId(logId);
      try {
        await api.postCustom(`webhooks/logs/${logId}/replay`, {});
        toast.success(t('replaySuccess'));
        await fetchLogs();
      } catch (err) {
        console.error(err);
        toast.error(t('replayError'));
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
        console.error(err);
        toast.error(tCommon('error'));
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

  return {
    logs,
    loading,
    filter,
    setFilter,
    replay,
    forceRetry,
    cancel,
    batchReplay,
    batchCancel,
    batchRunning,
    replayingId,
    actingId,
    refresh: fetchLogs,
  };
}
