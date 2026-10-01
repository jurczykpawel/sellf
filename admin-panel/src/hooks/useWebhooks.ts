/**
 * Webhooks Hook for v1 API
 *
 * Provides a consistent interface for webhook endpoint operations.
 */

import { useState, useCallback } from 'react';
import { WebhookEndpoint } from '@/types/webhooks';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api/client';

export function useWebhooks() {
  const t = useTranslations('admin.webhooks');
  const tCommon = useTranslations('common');

  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchEndpoints = useCallback(async () => {
    try {
      setLoading(true);
      const { data, truncated } = await api.listAll<WebhookEndpoint>('webhooks');
      if (truncated) {
        console.warn('[useWebhooks] Endpoint list truncated at the safety ceiling; not every endpoint was loaded.');
      }
      setEndpoints(data);
    } catch (err) {
      console.error(err);
      toast.error(tCommon('error'));
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  const createEndpoint = async (data: Partial<WebhookEndpoint>) => {
    setSubmitting(true);
    try {
      await api.create<WebhookEndpoint>('webhooks', data as Record<string, unknown>);
      toast.success(t('createSuccess'));
      fetchEndpoints();
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(tCommon('error'));
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const updateEndpoint = async (id: string, data: Partial<WebhookEndpoint>) => {
    setSubmitting(true);
    try {
      await api.update<WebhookEndpoint>('webhooks', id, data as Record<string, unknown>);
      toast.success(t('updateSuccess'));
      fetchEndpoints();
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(tCommon('error'));
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const deleteEndpoint = async (id: string) => {
    try {
      await api.delete('webhooks', id);
      toast.success(tCommon('success'));
      fetchEndpoints();
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message);
      } else {
        toast.error(tCommon('error'));
      }
      return false;
    }
  };

  const testEndpoint = async (id: string, eventType: string) => {
    try {
      // Use v1 test endpoint
      const response = await api.postCustom<{ success: boolean; status?: number; error?: string }>(
        `webhooks/${id}/test`,
        { event_type: eventType }
      );

      if (response.success) {
        toast.success(t('testSuccess') + ` (HTTP ${response.status})`);
        return true;
      } else {
        toast.error(t('testFailed') + `: ${response.error}`);
        return false;
      }
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(t('testFailed') + `: ${err.message}`);
      } else {
        toast.error(tCommon('error'));
      }
      return false;
    }
  };

  return {
    endpoints,
    loading,
    submitting,
    fetchEndpoints,
    createEndpoint,
    updateEndpoint,
    deleteEndpoint,
    testEndpoint
  };
}
