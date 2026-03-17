'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, ShoppingBag, Link2, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useAdminSchema } from '@/contexts/AdminSchemaContext';
import { initSellerStripeConnect } from '@/lib/actions/sellers';
import type { ConnectAccountStatus } from '@/lib/stripe/connect';

type StripeState = 'loading' | 'not_connected' | 'incomplete' | 'connected' | 'error';

function getStripeState(status: ConnectAccountStatus | null, loading: boolean): StripeState {
  if (loading) return 'loading';
  if (!status || !status.accountId) return 'not_connected';
  if (status.onboardingComplete) return 'connected';
  return 'incomplete';
}

/** Platform admin view: link to sellers management page. */
function PlatformAdminView() {
  const t = useTranslations('settings.marketplace');
  const locale = useLocale();

  return (
    <div className="bg-sf-surface border border-sf-border rounded-lg p-6">
      <div className="flex items-center gap-3 mb-2">
        <ShoppingBag className="w-5 h-5 text-sf-accent" />
        <h3 className="text-lg font-semibold text-sf-heading">{t('title')}</h3>
      </div>
      <p className="text-sm text-sf-muted mb-6">{t('description')}</p>

      <a
        href={`/${locale}/admin/sellers`}
        className="flex items-center justify-between p-4 bg-sf-deep border border-sf-border rounded-lg hover:border-sf-accent/50 transition-colors group"
      >
        <div>
          <div className="text-sm font-medium text-sf-heading group-hover:text-sf-accent transition-colors">
            {t('sellersLink')}
          </div>
          <div className="text-xs text-sf-muted mt-0.5">
            {t('sellersDescription')}
          </div>
        </div>
        <ExternalLink className="w-4 h-4 text-sf-muted group-hover:text-sf-accent transition-colors flex-shrink-0 ml-4" />
      </a>
    </div>
  );
}

/** Seller admin view: Stripe Connect self-service status card. */
function SellerConnectCard() {
  const t = useTranslations('settings.marketplace');
  const [status, setStatus] = useState<ConnectAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/stripe/connect/status?context=seller');
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to load status' }));
        throw new Error(body.error || 'Failed to load status');
      }
      const data: ConnectAccountStatus = await res.json();
      setStatus(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[SellerConnectCard] Failed to fetch status:', message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleConnect = async () => {
    try {
      setActionLoading(true);
      setError(null);
      const result = await initSellerStripeConnect();
      if (!result.success || !result.data?.onboardingUrl) {
        setError(result.error || 'Failed to initiate Stripe Connect');
        return;
      }
      window.location.href = result.data.onboardingUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const stripeState = error ? 'error' : getStripeState(status, loading);

  return (
    <div className="bg-sf-surface border border-sf-border rounded-lg p-6">
      <div className="flex items-center gap-3 mb-2">
        <Link2 className="w-5 h-5 text-sf-accent" />
        <h3 className="text-lg font-semibold text-sf-heading">{t('stripeConnect.title')}</h3>
      </div>
      <p className="text-sm text-sf-muted mb-6">{t('stripeConnect.description')}</p>

      {/* Status card */}
      <div className="p-4 bg-sf-deep border border-sf-border rounded-lg">
        {stripeState === 'loading' && (
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-sf-muted animate-spin" />
            <span className="text-sm text-sf-muted">{t('stripeConnect.loading')}</span>
          </div>
        )}

        {stripeState === 'error' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-sf-heading">{t('stripeConnect.error')}</div>
                <div className="text-xs text-sf-muted mt-0.5">{error}</div>
              </div>
            </div>
            <button
              onClick={fetchStatus}
              className="text-sm text-sf-accent hover:underline flex-shrink-0 ml-4"
            >
              {t('stripeConnect.retry')}
            </button>
          </div>
        )}

        {stripeState === 'not_connected' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-sf-heading">{t('stripeConnect.notConnected')}</div>
                <div className="text-xs text-sf-muted mt-0.5">{t('stripeConnect.notConnectedDesc')}</div>
              </div>
            </div>
            <button
              onClick={handleConnect}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-sf-accent text-white text-sm font-medium rounded-lg hover:bg-sf-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ml-4"
            >
              {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('stripeConnect.connectButton')}
            </button>
          </div>
        )}

        {stripeState === 'incomplete' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-sf-heading">{t('stripeConnect.incomplete')}</div>
                <div className="text-xs text-sf-muted mt-0.5">{t('stripeConnect.incompleteDesc')}</div>
              </div>
            </div>
            <button
              onClick={handleConnect}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-sf-accent text-white text-sm font-medium rounded-lg hover:bg-sf-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ml-4"
            >
              {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('stripeConnect.completeButton')}
            </button>
          </div>
        )}

        {stripeState === 'connected' && (
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium text-sf-heading">{t('stripeConnect.connected')}</div>
              <div className="text-xs text-sf-muted mt-0.5">
                {t('stripeConnect.accountId')}: {status?.accountId}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MarketplaceSettings() {
  // Marketplace tab is only shown to platform admins (filtered in SettingsTabs)
  return <PlatformAdminView />;
}
