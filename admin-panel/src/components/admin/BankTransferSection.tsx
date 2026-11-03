'use client';
/** Transfer administration uses the same operation as API v1. @see lib/orders/bank-transfer-actions.ts */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import { updateBankTransfer } from '@/lib/orders/bank-transfer-actions';
import { fromMinorUnits, toMinorUnits, currencyExponent } from '@/lib/currency/minor-units';
import type { PaymentTransaction } from '@/types/payment';
const input = 'block rounded border border-sf-border bg-sf-input p-2';
export default function BankTransferSection({ transaction: tx, onRefresh }: { transaction: PaymentTransaction; onRefresh(): void | Promise<void> }) {
  const t = useTranslations('bankTransfer'), locale = useLocale();
  const [amount, setAmount] = useState(String(fromMinorUnits(tx.amount, tx.currency))), [paidAt, setPaidAt] = useState(''), [reason, setReason] = useState('');
  const [lateReason, setLateReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  async function run(action: 'mark-paid' | 'cancel' | 'invoice-issued' | 'accept-late') {
    if ((action === 'mark-paid' || action === 'accept-late') && toMinorUnits(Number(amount), tx.currency) !== tx.amount) { setMessage(t('amountMismatch')); return; }
    setBusy(true);
    try {
      // The receipt date is only parsed for payment actions; an empty date field must not break cancellation.
      const paid = () => ({ amount: toMinorUnits(Number(amount), tx.currency), paidAt: new Date(`${paidAt}T00:00:00Z`).toISOString() });
      const body = action === 'cancel' ? { action, reason } : action === 'invoice-issued' ? { action }
        : action === 'accept-late' ? { action: 'mark-paid', ...paid(), acceptCancelled: true, reason: lateReason } : { action, ...paid() };
      const r = await updateBankTransfer(tx.id, body); if (r.success) await onRefresh(); else setMessage(t('operationError'));
    } catch { setMessage(t('operationError')); } finally { setBusy(false); }
  }
  if (tx.payment_provider !== 'bank_transfer') return null;
  const paidFields = <>
    <label>{t('bookedAmount')} ({tx.currency})<input className={input} type="number" min="0" step={currencyExponent(tx.currency) === 0 ? '1' : '0.01'} required value={amount} onChange={e => setAmount(e.target.value)} /></label>
    <label>{t('paidAt')}<input className={input} type="date" required value={paidAt} onChange={e => setPaidAt(e.target.value)} /></label>
  </>;
  return <section aria-label={t('title')}>
    <TransferInstructions transfer={tx.transfer_details ?? null} amount={tx.amount} currency={tx.currency} dueAt={tx.payment_due_at} />
    {tx.status === 'awaiting_payment' && <div className="space-y-3">
      <form onSubmit={e => { e.preventDefault(); void run('mark-paid'); }} className="flex flex-wrap gap-3 items-end">
        {paidFields}
        <button disabled={busy} className="rounded bg-sf-accent-bg text-sf-inverse p-2">{t('markPaid')}</button>
      </form>
      <form onSubmit={e => { e.preventDefault(); void run('cancel'); }} className="flex flex-wrap items-end gap-3">
        <label>{t('reason')}<input className={input} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button disabled={busy || !reason.trim()} className="rounded border border-sf-danger text-sf-danger p-2">{t('cancel')}</button>
      </form>
      <p role="status">{message}</p>
    </div>}
    <ul className="my-3 space-y-1 text-sm" aria-label={t('lifecycle')}>
      {tx.status === 'awaiting_payment' && tx.invoice_hold_at && <li>{t('invoiceHoldAdmin')}</li>}
      {tx.status === 'awaiting_payment' && tx.release_at && <li>{t('releaseAt', { date: date(tx.release_at) })}{tx.reminder_at ? ` · ${t('reminderAt', { date: date(tx.reminder_at) })}` : ''}</li>}
      {tx.transfer_declared_at && <li className="font-semibold text-sf-warning">{t('declaredBadge', { date: date(tx.transfer_declared_at) })}{tx.transfer_declared_note ? `: ${tx.transfer_declared_note}` : ''}</li>}
      {tx.status === 'cancelled' && tx.cancel_reason && <li>{t(`cancelReason_${tx.cancel_reason === 'payment_window_expired' ? 'expired' : 'admin'}`)}</li>}
      {tx.reopened_at && <li>{t('reopened', { date: date(tx.reopened_at) })}</li>}
    </ul>
    {tx.status === 'awaiting_payment' && !tx.invoice_hold_at && <button type="button" disabled={busy} onClick={() => void run('invoice-issued')} className="rounded border border-sf-border p-2">{t('markInvoiceIssued')}</button>}
    {tx.status === 'cancelled' && tx.invoice?.status !== 'corrected' && <div className="space-y-3">
      <p className="text-sm text-sf-muted">{t('lateHelp')}</p>
      <form onSubmit={e => { e.preventDefault(); void run('accept-late'); }} className="flex flex-wrap gap-3 items-end" aria-label={t('acceptLate')}>
        {paidFields}
        <label>{t('lateReason')}<input className={input} required maxLength={1000} value={lateReason} onChange={e => setLateReason(e.target.value)} /></label>
        <button disabled={busy || !lateReason.trim()} className="rounded bg-sf-accent-bg text-sf-inverse p-2">{t('acceptLate')}</button>
      </form>
      <p role="status">{message}</p>
    </div>}
  </section>;
}
