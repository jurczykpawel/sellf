'use client';
/**
 * Buyer "I have sent the transfer" on the signed order page. Past the reservation deadline it only tells the seller and
 * promises no extension. @see app/api/orders/bank-transfer/declare/route.ts
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

interface Declaration { declaredAt: string; releaseAt: string | null; afterDeadline?: boolean }

export default function TransferDeclaration({ orderId, token, declaredAt, overdue = false }: { orderId: string; token: string; declaredAt: string | null; overdue?: boolean }) {
  const t = useTranslations('bankTransfer'), locale = useLocale();
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [done, setDone] = useState<Declaration | null>(declaredAt ? { declaredAt, releaseAt: null, afterDeadline: overdue } : null);
  const format = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
  async function declare() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/orders/bank-transfer/declare', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, token, ...(note.trim() ? { note: note.trim() } : {}) }) });
      if (response.ok) setDone(await response.json()); else setError(t('declareError'));
    } catch { setError(t('declareError')); } finally { setBusy(false); }
  }
  if (done) return <p role="status" className="my-4 rounded-xl border border-sf-border p-4 print:hidden">
    {done.afterDeadline ? t('declaredLate')
      : <>{t('declared', { date: format(done.declaredAt) })}{done.releaseAt ? ` ${t('declaredHold', { date: format(done.releaseAt) })}` : ''}</>}
  </p>;
  return <form className="my-4 space-y-3 rounded-xl border border-sf-border p-4 print:hidden" onSubmit={e => { e.preventDefault(); void declare(); }}>
    <p className="text-sm text-sf-muted">{t(overdue ? 'declareHelpOverdue' : 'declareHelp')}</p>
    <label className="block text-sm">{t('declareNote')}
      <input className="mt-1 block w-full rounded border border-sf-border bg-sf-input p-2" maxLength={200} value={note} onChange={e => setNote(e.target.value)} />
    </label>
    <button disabled={busy} className="rounded-lg bg-sf-accent-bg p-3 text-sf-inverse">{t('declareButton')}</button>
    {error && <p role="alert" className="text-sf-danger">{error}</p>}
  </form>;
}
