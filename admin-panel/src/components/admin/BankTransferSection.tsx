'use client';
/** Transfer administration uses the same operation as API v1. @see lib/orders/bank-transfer-actions.ts */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import { updateBankTransfer } from '@/lib/orders/bank-transfer-actions';
import { fromMinorUnits, toMinorUnits, currencyExponent } from '@/lib/currency/minor-units';
import type { PaymentTransaction } from '@/types/payment';
export default function BankTransferSection({ transaction: tx, onRefresh }: { transaction: PaymentTransaction; onRefresh(): void | Promise<void> }) {
  const t = useTranslations('bankTransfer');
  const [amount, setAmount] = useState(String(fromMinorUnits(tx.amount, tx.currency))), [paidAt, setPaidAt] = useState(''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function run(action: 'mark-paid' | 'cancel') {
    if (action === 'mark-paid' && toMinorUnits(Number(amount), tx.currency) !== tx.amount) { setMessage(t('amountMismatch')); return; }
    setBusy(true);
    try {
      const input = action === 'cancel' ? { action, reason } : { action, amount: toMinorUnits(Number(amount), tx.currency), paidAt: new Date(`${paidAt}T00:00:00Z`).toISOString() };
      const r = await updateBankTransfer(tx.id, input); if (r.success) await onRefresh(); else setMessage(t('operationError'));
    } catch { setMessage(t('operationError')); } finally { setBusy(false); }
  }
  if (tx.payment_provider !== 'bank_transfer') return null;
  return <section aria-label={t('title')}>
    <TransferInstructions transfer={tx.transfer_details ?? null} amount={tx.amount} currency={tx.currency} dueAt={tx.payment_due_at} />
    {tx.status === 'awaiting_payment' && <div className="space-y-3">
      <form onSubmit={e => { e.preventDefault(); void run('mark-paid'); }} className="flex flex-wrap gap-3 items-end">
        <label>{t('bookedAmount')} ({tx.currency})<input className="block rounded border border-sf-border bg-sf-input p-2" type="number" min="0" step={currencyExponent(tx.currency) === 0 ? '1' : '0.01'} required value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label>{t('paidAt')}<input className="block rounded border border-sf-border bg-sf-input p-2" type="date" required value={paidAt} onChange={e => setPaidAt(e.target.value)} /></label>
        <button disabled={busy} className="rounded bg-sf-accent-bg text-sf-inverse p-2">{t('markPaid')}</button>
      </form>
      <form onSubmit={e => { e.preventDefault(); void run('cancel'); }} className="flex flex-wrap items-end gap-3">
        <label>{t('reason')}<input className="block rounded border border-sf-border bg-sf-input p-2" required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button disabled={busy || !reason.trim()} className="rounded border border-sf-danger text-sf-danger p-2">{t('cancel')}</button>
      </form>
      <p role="status">{message}</p>
    </div>}
  </section>;
}
