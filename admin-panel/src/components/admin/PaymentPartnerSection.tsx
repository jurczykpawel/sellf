'use client';
/** Partner attribution attached to the selected payment. */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getPaymentPartnerDetails } from '@/lib/actions/payment-details';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import type { PaymentPartnerDetail } from '@/lib/actions/payment-details';

export default function PaymentPartnerSection({ transactionId }: { transactionId: string }) {
  const t = useTranslations('admin.payments.partner'), locale = useLocale();
  const [state, setState] = useState<{ id: string; rows: PaymentPartnerDetail[]; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    getPaymentPartnerDetails(transactionId).then(r => { if (active) setState({ id: transactionId, rows: r.data ?? [], error: !r.success }); })
      .catch(() => { if (active) setState({ id: transactionId, rows: [], error: true }); });
    return () => { active = false; };
  }, [transactionId]);
  if (!state || state.id !== transactionId) return null;
  if (state.error) return <p role="status">{t('error')}</p>;
  if (!state.rows.length) return null;
  const money = (amount: number, currency: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(fromMinorUnits(amount, currency));
  return <section aria-label={t('title')} className="my-4 rounded-xl border border-sf-border bg-sf-base p-4 space-y-3">
    <h4 className="font-semibold text-sf-heading">{t('title')}</h4>
    {state.rows.map(c => <dl key={c.id} className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt>{t('partner')}</dt><dd>{c.partner}</dd>
      <dt>{t('coupon')}</dt><dd>{c.coupon ?? '—'}</dd>
      <dt>{t('rate')}</dt><dd>{c.percentage_bps !== null ? `${c.percentage_bps / 100}%` : money(Number(c.fixed_minor), c.currency)}</dd>
      <dt>{t('commission')}</dt><dd>{money(c.current_minor, c.currency)}</dd>
      <dt>{t('original')}</dt><dd>{money(c.accrued_minor, c.currency)}</dd>
      <dt>{t('paidAmount')}</dt><dd>{money(c.paid_minor, c.currency)}</dd>
      <dt>{t('status')}</dt><dd className="font-semibold">{t(`statuses.${c.status}`)}</dd>
    </dl>)}
  </section>;
}
