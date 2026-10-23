'use client';
/** Immutable transfer details, shared by buyer and administrator. @see order/[orderId]/transfer */
import { useLocale, useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import type { Json } from '@/types/database';
export default function TransferInstructions({ transfer, amount, currency, dueAt, print = false }: { transfer: Json | null; amount: number; currency: string; dueAt?: string | null; print?: boolean }) {
  const t = useTranslations('bankTransfer'), locale = useLocale();
  const details = transfer && typeof transfer === 'object' && !Array.isArray(transfer) ? transfer : {};
  return <section aria-label={t('instructions')} className="space-y-4 rounded-xl border border-sf-border p-5 my-4">
    <h3 className="font-semibold">{t('instructions')}</h3>
    <dl className="grid gap-3 sm:grid-cols-2">
      {(['holder', 'account', 'bank', 'title'] as const).map(key => <div key={key}><dt className="text-sm text-sf-muted">{t(`transfer_${key}`)}</dt><dd className="font-medium break-words">{String(details[key] ?? '')}</dd></div>)}
      <div><dt>{t('amount')}</dt><dd>{formatPrice(fromMinorUnits(amount, currency), currency, locale)}</dd></div>
      <div><dt>{t('dueAt')}</dt><dd>{dueAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(dueAt)) : '—'}</dd></div>
    </dl>
    {print && <button className="print:hidden rounded-lg border border-sf-border p-3" onClick={() => window.print()}>{t('print')}</button>}
  </section>;
}
