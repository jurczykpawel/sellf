'use client';

/**
 * "Source" box in the payment details: where the order came from, frozen at purchase.
 * @see src/lib/actions/attribution.ts
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getPurchaseAttribution } from '@/lib/actions/attribution';
import type { PurchaseAttributionView } from '@/lib/attribution/report';

const KNOWN_CHANNELS = ['email', 'paid_social', 'paid_search', 'organic_social', 'organic_search', 'referral', 'affiliate', 'direct', 'other', 'unknown'];

function describeTouch(touch: Record<string, string | null> | null): string | null {
  if (!touch) return null;
  const parts = [
    [touch.source, touch.medium].filter(Boolean).join(' / '),
    touch.campaign, touch.content, touch.referrer_host, touch.landing_path,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export default function AttributionSection({ transactionId }: { transactionId: string }) {
  const t = useTranslations('admin.payments.attribution');
  const [state, setState] = useState<{ loading: boolean; data: PurchaseAttributionView | null; error: boolean }>({ loading: true, data: null, error: false });

  useEffect(() => {
    let active = true;
    getPurchaseAttribution(transactionId).then(result => {
      if (active) setState({ loading: false, data: result.data ?? null, error: !result.success });
    });
    return () => { active = false; };
  }, [transactionId]);

  const channelLabel = (channel: string | null) =>
    channel ? (KNOWN_CHANNELS.includes(channel) ? t(`channels.${channel}`) : channel) : '—';
  const d = state.data;
  const last = d ? describeTouch(d.last) : null;
  const first = d ? describeTouch(d.first) : null;

  return (
    <div className="mb-6">
      <div className="text-xs font-medium uppercase tracking-wider text-sf-muted mb-2">{t('title')}</div>
      {state.loading ? (
        <div className="text-sm text-sf-muted">…</div>
      ) : state.error ? (
        <div className="text-sm text-sf-muted">{t('error')}</div>
      ) : !d ? (
        <div className="text-sm text-sf-muted">{t('none')}</div>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-sf-muted">{t('channel')}</dt>
          <dd className="text-sf-heading">{channelLabel(d.channel)}</dd>
          <dt className="text-sf-muted">{t('lastTouch')}</dt>
          <dd className="text-sf-heading break-all">{last ?? t('direct')}</dd>
          {first && (
            <>
              <dt className="text-sf-muted">{t('firstTouch')}</dt>
              <dd className="text-sf-heading break-all">{channelLabel(d.first_channel)}: {first}</dd>
            </>
          )}
          {d.sessions_count !== null && (
            <>
              <dt className="text-sf-muted">{t('journey')}</dt>
              <dd className="text-sf-heading">{t('journeyValue', { sessions: d.sessions_count, days: d.days_to_purchase ?? 0 })}</dd>
            </>
          )}
          <dt className="text-sf-muted">{t('device')}</dt>
          <dd className="text-sf-heading">{[t(`devices.${d.device_class}`), d.country].filter(Boolean).join(' · ')}</dd>
          {d.click && (
            <>
              <dt className="text-sf-muted">{t('click')}</dt>
              <dd className="text-sf-heading">{d.click.type}{d.click.id ? '' : ` (${t('clickExpired')})`}</dd>
            </>
          )}
          <dt className="text-sf-muted">{t('mode')}</dt>
          <dd className="text-sf-muted">{t(`modes.${d.mode}`)}</dd>
        </dl>
      )}
    </div>
  );
}
