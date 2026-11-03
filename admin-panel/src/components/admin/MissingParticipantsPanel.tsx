'use client';

/** Orders still waiting for the buyer's participant list. @see lib/actions/orders-missing-participants.ts */
import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { getOrdersMissingParticipants } from '@/lib/actions/orders-missing-participants';
import type { MissingParticipantsOrder } from '@/lib/actions/orders-missing-participants';

export default function MissingParticipantsPanel() {
  const t = useTranslations('admin.payments.missingParticipants');
  const format = useFormatter();
  const [orders, setOrders] = useState<MissingParticipantsOrder[]>([]);
  useEffect(() => {
    let cancelled = false;
    getOrdersMissingParticipants().then(result => { if (!cancelled && result.success && result.data) setOrders(result.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (orders.length === 0) return null;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeZone: 'Europe/Warsaw' });
  return (
    <details className="border-2 border-sf-border-subtle bg-sf-base" data-testid="missing-participants">
      <summary className="cursor-pointer p-4 font-semibold text-sf-heading">{t('title', { count: orders.length })}</summary>
      <div className="overflow-x-auto p-4 pt-0">
        <p className="mb-3 text-sm text-sf-muted">{t('help')}</p>
        <table className="w-full text-sm text-sf-heading">
          <caption className="sr-only">{t('title', { count: orders.length })}</caption>
          <thead><tr className="border-b-2 border-sf-border-medium">
            {(['order', 'email', 'product', 'quantity', 'paid', 'mail'] as const).map(key => <th key={key} scope="col" className="text-left p-2">{t(key)}</th>)}
          </tr></thead>
          <tbody>{orders.map(order => <tr key={order.id} className="border-b border-sf-border-subtle">
            <th scope="row" className="text-left p-2 font-medium">#{order.orderNumber ?? '—'}</th>
            <td className="p-2">{order.email}</td><td className="p-2">{order.productName}</td>
            <td className="p-2 tabular-nums">{order.quantity}</td><td className="p-2">{date(order.createdAt)}</td>
            <td className="p-2">{order.mailSentAt ? t('mailSent', { date: date(order.mailSentAt) }) : t('mailPending')}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
