'use client';
/** "Pay online" for an unpaid or released transfer order. @see app/api/orders/[orderId]/pay/route.ts */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';

export default function QuickPayButton({ orderId, token, amount, currency }: { orderId: string; token: string; amount: number; currency: string }) {
  const t = useTranslations('bankTransfer'), locale = useLocale();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(amount);
  const label = formatPrice(fromMinorUnits(confirmed, currency), currency, locale);
  async function pay() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/orders/${orderId}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, expectedAmount: confirmed }) });
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body.url === 'string') { window.location.assign(body.url); return; }
      if (body.reason === 'amount_changed' && typeof body.quote?.amount === 'number') { setConfirmed(body.quote.amount); setError(t('quickPayAmountChanged')); }
      else if (typeof body.checkoutUrl === 'string') { setError(t('quickPayUnavailable')); }
      else setError(t('quickPayError'));
    } catch { setError(t('quickPayError')); } finally { setBusy(false); }
  }
  return <div className="my-4 space-y-2 rounded-xl border border-sf-border p-4 print:hidden">
    <p className="text-sm text-sf-muted">{t('quickPayHelp')}</p>
    <button type="button" disabled={busy} onClick={() => void pay()} className="rounded-lg bg-sf-accent-bg p-3 text-sf-inverse">{t('quickPayButton', { amount: label })}</button>
    {error && <p role="alert" className="text-sf-danger">{error}</p>}
  </div>;
}
