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
  const touch = (value: Record<string, string | null> | null) => value && Object.values(value).some(Boolean) ? <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
    {(['source', 'medium', 'campaign', 'content', 'term', 'referrer_host', 'landing_path'] as const).map(field => value[field] ? <div key={field} className="contents"><dt className="text-sf-muted">{t(`fields.${field}`)}</dt><dd className="break-all">{value[field]}</dd></div> : null)}
  </dl> : t('direct');

  return (
    <section aria-label={t('title')} className="my-4 rounded-xl border border-sf-border bg-sf-base p-4">
      <h4 className="font-semibold text-sf-heading mb-2">{t('title')}</h4>
      <p className="text-sm text-sf-muted mb-3">{t('touchHelp')}</p>
      {state.loading ? (
        <div className="text-sm text-sf-muted">…</div>
      ) : state.error ? (
        <div className="text-sm text-sf-muted">{t('error')}</div>
      ) : !d ? (
        <div className="text-sm text-sf-muted">{t('none')}</div>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-sf-muted">{t('channel')}</dt>
          <dd><span className="inline-flex rounded-full bg-sf-accent-bg px-3 py-1 font-semibold text-sf-inverse">{channelLabel(d.channel)}</span></dd>
          <dt className="text-sf-muted">{t('lastTouch')}</dt>
          <dd className="text-sf-heading break-all">{touch(d.last)}</dd>
          {d.first && (
            <>
              <dt className="text-sf-muted">{t('firstTouch')}</dt>
              <dd className="text-sf-heading break-all"><span className="font-medium">{channelLabel(d.first_channel)}</span>{touch(d.first)}</dd>
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
    </section>
  );
}
