'use client';

/** Paid Stripe payments for a deleted product, waiting for the admin (refund or manual access). @see lib/stripe/payment-reconciliation.ts */
import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { getPaymentsNeedingReconciliation } from '@/lib/actions/payments-reconciliation';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import type { PaymentToReconcile } from '@/lib/stripe/payment-reconciliation';

export default function PaymentsReconciliationPanel() {
  const t = useTranslations('admin.payments.reconciliation');
  const format = useFormatter();
  const [payments, setPayments] = useState<PaymentToReconcile[]>([]);
  useEffect(() => {
    let cancelled = false;
    getPaymentsNeedingReconciliation().then(result => { if (!cancelled && result.success && result.data) setPayments(result.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (payments.length === 0) return null;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' });
  const money = (p: PaymentToReconcile) => format.number(fromMinorUnits(p.amount, p.currency), { style: 'currency', currency: p.currency.toUpperCase() });
  return (
    <details className="border-2 border-sf-border-subtle bg-sf-base" data-testid="payments-reconciliation" open>
      <summary className="cursor-pointer p-4 font-semibold text-sf-heading">{t('title', { count: payments.length })}</summary>
      <div className="overflow-x-auto p-4 pt-0">
        <p className="mb-3 text-sm text-sf-muted">{t('help')}</p>
        <table className="w-full text-sm text-sf-heading">
          <caption className="sr-only">{t('title', { count: payments.length })}</caption>
          <thead><tr className="border-b-2 border-sf-border-medium">
            {(['payment', 'email', 'amount', 'product', 'recorded'] as const).map(key => <th key={key} scope="col" className="text-left p-2">{t(key)}</th>)}
          </tr></thead>
          <tbody>{payments.map(p => <tr key={p.id} className="border-b border-sf-border-subtle">
            <th scope="row" className="text-left p-2 font-mono text-xs break-all">{p.paymentId}</th>
            <td className="p-2">{p.customerEmail}</td><td className="p-2 tabular-nums">{money(p)}</td>
            <td className="p-2 font-mono text-xs break-all">{p.productId}</td><td className="p-2">{date(p.recordedAt)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
