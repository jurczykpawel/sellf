'use client';
/** Immutable transfer details, shared by buyer and administrator. @see order/[orderId]/transfer */
import { useLocale, useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import type { Json } from '@/types/database';
export default function TransferInstructions({ transfer, amount, currency, dueAt, print = false, paid = false }: { transfer: Json | null; amount: number; currency: string; dueAt?: string | null; print?: boolean; paid?: boolean }) {
  const t = useTranslations('bankTransfer'), locale = useLocale();
  const details = transfer && typeof transfer === 'object' && !Array.isArray(transfer) ? transfer : {};
  if (paid) return <p className="my-4 font-semibold">{t('paid')}</p>;
  return <section aria-label={t('instructions')} className="space-y-4 rounded-xl border border-sf-border p-5 my-4">
    <h3 className="font-semibold">{t('instructions')}</h3>
    <dl className="grid gap-3 sm:grid-cols-2">
      {(['holder', 'account', 'bank', 'title'] as const).map(key => <div key={key}><dt className="text-sm text-sf-muted">{t(`transfer_${key}`)}</dt><dd className="font-medium break-words">{key === 'account' ? String(details[key] ?? '').replace(/\s/g, '').match(/.{1,4}/g)?.join(' ') : String(details[key] ?? '')}</dd></div>)}
      <div><dt className="text-sm text-sf-muted">{t('amount')}</dt><dd className="font-medium break-words">{formatPrice(fromMinorUnits(amount, currency), currency, locale)}</dd></div>
      <div><dt className="text-sm text-sf-muted">{t('dueAt')}</dt><dd className="font-medium break-words">{dueAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(dueAt)) : '—'}</dd></div>
    </dl>
    {print && <button className="print:hidden rounded-lg border border-sf-border p-3" onClick={() => window.print()}>{t('print')}</button>}
  </section>;
}
