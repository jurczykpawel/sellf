'use client';

/**
 * My-Purchases > Subscriptions panel.
 *
 * Lists the current user's subscriptions, lets them cancel (period-end) or
 * resume a scheduled cancel. Card update + invoice list are deferred for
 * future polish — Phase 6 / 7 of the Subscriptions MVP.
 *
 * @see /api/subscriptions
 * @see /api/subscriptions/[id]/cancel
 * @see /api/subscriptions/[id]/resume
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

interface SubscriptionProduct {
  id: string;
  name: string;
  slug: string;
  currency: string;
  recurring_price: number | null;
  billing_interval: 'day' | 'week' | 'month' | 'year' | null;
  billing_interval_count: number | null;
}

interface SubscriptionRow {
  id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  trial_end: string | null;
  stripe_subscription_id: string;
  product: SubscriptionProduct | null;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatPrice(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency ?? 'USD',
  }).format(amount);
}

function statusBadgeClass(status: string, cancelAtPeriodEnd: boolean): string {
  if (status === 'canceled') return 'bg-sf-raised text-sf-heading';
  if (cancelAtPeriodEnd) return 'bg-sf-warning-soft text-sf-warning';
  if (status === 'trialing') return 'bg-sf-accent-soft text-sf-accent';
  if (status === 'past_due' || status === 'unpaid') return 'bg-red-100 text-red-700';
  return 'bg-emerald-100 text-emerald-700';
}

export default function MySubscriptions() {
  const t = useTranslations('myPurchases.subscriptions');
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/subscriptions', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load subscriptions');
      const json = (await res.json()) as { subscriptions: SubscriptionRow[] };
      setRows(json.subscriptions ?? []);
    } catch (err) {
      console.error('[MySubscriptions] load error:', err);
      toast.error(t('loadError', { defaultValue: 'Could not load subscriptions' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const callAction = async (id: string, action: 'cancel' | 'resume') => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/subscriptions/${id}/${action}`, {
        method: 'POST',
        credentials: 'include',
        // Required by validateCrossOriginRequest (CSRF guard).
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `Failed to ${action} subscription`);
      }
      toast.success(
        action === 'cancel'
          ? t('cancelScheduled', { defaultValue: 'Cancellation scheduled at period end.' })
          : t('resumed', { defaultValue: 'Subscription resumed.' })
      );
      await fetchRows();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-sf-muted text-sm">
        {t('loading', { defaultValue: 'Loading subscriptions...' })}
      </div>
    );
  }

  if (rows.length === 0) {
    return null; // No subscriptions — silently hide the section.
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-sf-heading">
        {t('title', { defaultValue: 'Subscriptions' })}
      </h2>
      <div className="space-y-3">
        {rows.map((row) => {
          const product = row.product;
          const intervalLabel = product?.billing_interval
            ? t(`interval.${product.billing_interval}`, {
                defaultValue: product.billing_interval,
                count: product.billing_interval_count ?? 1,
              })
            : '—';
          const isBusy = busyId === row.id;

          return (
            <div
              key={row.id}
              className="border border-sf-border bg-sf-surface px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sf-heading truncate">
                    {product?.name ?? '—'}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(
                      row.status,
                      row.cancel_at_period_end
                    )}`}
                  >
                    {row.cancel_at_period_end
                      ? t('statusScheduledCancel', { defaultValue: 'Cancels at period end' })
                      : t(`status.${row.status}`, { defaultValue: row.status })}
                  </span>
                </div>
                <div className="text-xs text-sf-muted flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>
                    {formatPrice(product?.recurring_price ?? null, product?.currency ?? 'USD')} / {intervalLabel}
                  </span>
                  <span>
                    {row.cancel_at_period_end || row.status === 'canceled'
                      ? t('endsAt', { defaultValue: 'Ends' })
                      : t('renewsAt', { defaultValue: 'Renews' })}
                    : {formatDate(row.current_period_end)}
                  </span>
                  {row.trial_end && new Date(row.trial_end) > new Date() && (
                    <span>
                      {t('trialUntil', { defaultValue: 'Trial until' })}: {formatDate(row.trial_end)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {row.status !== 'canceled' && !row.cancel_at_period_end && (
                  <button
                    type="button"
                    onClick={() => callAction(row.id, 'cancel')}
                    disabled={isBusy}
                    className="px-3 py-1.5 text-sm border border-sf-border-medium text-sf-body hover:bg-sf-raised disabled:opacity-50"
                  >
                    {t('cancelButton', { defaultValue: 'Cancel' })}
                  </button>
                )}
                {row.cancel_at_period_end && row.status !== 'canceled' && (
                  <button
                    type="button"
                    onClick={() => callAction(row.id, 'resume')}
                    disabled={isBusy}
                    className="px-3 py-1.5 text-sm border border-sf-accent bg-sf-accent text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {t('resumeButton', { defaultValue: 'Resume' })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
