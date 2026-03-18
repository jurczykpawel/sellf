'use client';

import { useState, useEffect } from 'react';
import { Link2, CheckCircle2, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { initSellerStripeConnect } from '@/lib/actions/sellers';

interface ConnectStatus {
  has_account: boolean;
  onboarding_complete: boolean;
  account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
}

export default function StripeConnectStatus() {
  const t = useTranslations('settings.marketplace.stripeConnect');
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStatus() {
      try {
        const res = await fetch('/api/stripe/connect/status?context=seller');
        if (res.ok) {
          setStatus(await res.json());
        }
      } catch {
        // Non-fatal — seller may not have account yet
      } finally {
        setLoading(false);
      }
    }
    loadStatus();
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const result = await initSellerStripeConnect();
      if (result.success && result.data?.onboardingUrl) {
        window.location.href = result.data.onboardingUrl;
      } else {
        setError(result.error || 'Failed to start Stripe Connect setup');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setConnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-sf-surface border border-sf-border rounded-lg p-6">
        <div className="flex items-center gap-2 text-sf-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">{t('loading')}</span>
        </div>
      </div>
    );
  }

  const isConnected = status?.has_account && status?.onboarding_complete;
  const isIncomplete = status?.has_account && !status?.onboarding_complete;

  return (
    <div className="bg-sf-surface border border-sf-border rounded-lg p-6">
      <div className="flex items-center gap-3 mb-2">
        <Link2 className="w-5 h-5 text-sf-accent" />
        <h3 className="text-lg font-semibold text-sf-heading">{t('title')}</h3>
      </div>
      <p className="text-sm text-sf-muted mb-6">{t('description')}</p>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="p-4 bg-sf-deep border border-sf-border rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isConnected ? (
              <CheckCircle2 className="w-5 h-5 text-sf-success flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-sf-warning flex-shrink-0" />
            )}
            <div>
              <div className="text-sm font-medium text-sf-heading">
                {isConnected ? t('connected') : isIncomplete ? t('incomplete') : t('notConnected')}
              </div>
              <div className="text-xs text-sf-muted mt-0.5">
                {isConnected
                  ? `${t('accountId')}: ${status?.account_id}`
                  : isIncomplete
                  ? t('incompleteDesc')
                  : t('notConnectedDesc')}
              </div>
            </div>
          </div>

          {!isConnected && (
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 px-4 py-2 bg-sf-accent text-white text-sm font-medium rounded-lg hover:bg-sf-accent/90 transition-colors disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              {isIncomplete ? t('completeButton') : t('connectButton')}
            </button>
          )}

          {isConnected && (
            <a
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-sf-border-light text-sf-muted hover:text-sf-heading hover:bg-sf-hover transition-colors text-xs"
            >
              Stripe Dashboard
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
