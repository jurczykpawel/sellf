'use client';
/** Session reserved by this purchase, including released seats. */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getPaymentEventDetails } from '@/lib/actions/payment-details';
import type { PaymentEventDetail } from '@/lib/actions/payment-details';

export default function PaymentEventSection({ transactionId, currency }: { transactionId: string; currency: string }) {
  const t = useTranslations('admin.payments.event'), locale = useLocale();
  const [state, setState] = useState<{ id: string; data: PaymentEventDetail | null; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    getPaymentEventDetails(transactionId).then(r => { if (active) setState({ id: transactionId, data: r.data ?? null, error: !r.success }); })
      .catch(() => { if (active) setState({ id: transactionId, data: null, error: true }); });
    return () => { active = false; };
  }, [transactionId]);
  if (!state || state.id !== transactionId) return null;
  if (state.error) return <p role="status">{t('error')}</p>;
  if (!state.data) return null;
  const { session, tier, quantity, status } = state.data;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: session.timezone }).format(new Date(value));
  const url = session.online_url && /^https?:\/\//i.test(session.online_url) ? session.online_url : null;
  return <section aria-label={t('title')} className="my-4 rounded-xl border border-sf-border bg-sf-base p-4 space-y-2">
    <h4 className="font-semibold">{t('title')}{session.title ? `: ${session.title}` : ''}</h4>
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt>{t('date')}</dt><dd>{date(session.starts_at)}{session.ends_at ? ` – ${date(session.ends_at)}` : ''} ({session.timezone})</dd>
      {session.venue && <><dt>{t('venue')}</dt><dd>{session.venue}</dd></>}
      {url && <><dt>{t('online')}</dt><dd className="break-all"><a href={url} target="_blank" rel="noreferrer" className="underline">{url}</a></dd></>}
      <dt>{t('tier')}</dt><dd>{tier.label ?? t('tierNumber', { number: tier.sort + 1 })} · {new Intl.NumberFormat(locale, { style: 'currency', currency }).format(tier.price)}</dd>
      <dt>{t('quantity')}</dt><dd>{quantity}</dd>
      <dt>{t('status')}</dt><dd>{['held', 'confirmed', 'released'].includes(status) ? t(`statuses.${status}`) : status}</dd>
    </dl>
  </section>;
}
