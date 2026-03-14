'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getStripePaymentMethodConfigsCached,
  refreshStripePaymentMethodConfigs,
} from '@/lib/actions/payment-config';
import type { StripePaymentMethodConfig } from '@/types/payment-config';

interface UseStripePmcsReturn {
  stripePmcs: StripePaymentMethodConfig[];
  stripePmcsLoading: boolean;
  refreshing: boolean;
  loadStripePmcs: () => Promise<void>;
  handleRefreshStripePmcs: () => Promise<void>;
}

export function useStripePmcs(): UseStripePmcsReturn {
  const t = useTranslations('settings');

  const [stripePmcs, setStripePmcs] = useState<StripePaymentMethodConfig[]>([]);
  const [stripePmcsLoading, setStripePmcsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function loadStripePmcs() {
    try {
      setStripePmcsLoading(true);
      const result = await getStripePaymentMethodConfigsCached();
      if (result.success && result.data) {
        setStripePmcs(result.data);
      } else {
        toast.error(result.error || t('paymentMethods.stripeConfig.error'));
      }
    } catch (error) {
      console.error('[useStripePmcs] Failed to load Stripe PMCs:', error);
      toast.error(t('paymentMethods.stripeConfig.error'));
    } finally {
      setStripePmcsLoading(false);
    }
  }

  async function handleRefreshStripePmcs() {
    try {
      setRefreshing(true);
      const result = await refreshStripePaymentMethodConfigs();
      if (result.success) {
        await loadStripePmcs();
        toast.success(t('paymentMethods.messages.refreshSuccess'));
      } else {
        toast.error(result.error || t('paymentMethods.stripeConfig.error'));
      }
    } catch (error) {
      console.error('[useStripePmcs] Failed to refresh Stripe PMCs:', error);
      toast.error(t('paymentMethods.stripeConfig.error'));
    } finally {
      setRefreshing(false);
    }
  }

  return { stripePmcs, stripePmcsLoading, refreshing, loadStripePmcs, handleRefreshStripePmcs };
}
