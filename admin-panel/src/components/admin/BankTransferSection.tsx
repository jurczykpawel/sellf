'use client';
/** Transfer administration uses the same operation as API v1. @see lib/orders/bank-transfer-actions.ts */
import { useEffect, useState, useId, useRef } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import TutorialHelpButton from '@/components/tutorials/TutorialHelpButton';
import TutorialTrigger from '@/components/tutorials/TutorialTrigger';
import TransferInstructions from '@/components/checkout/TransferInstructions';
import { getLateTransferPreview, updateBankTransfer, retryOrderNotice } from '@/lib/orders/bank-transfer-actions';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits, toMinorUnits, currencyExponent } from '@/lib/currency/minor-units';
import { ORDER_NOTICES, NOTICE_RETRY_DELAY, noticeMatchesStatus } from '@/lib/orders/notice-state';
import { transferDeadline } from '@/lib/orders/transfer-format';
import type { LateTransferPreview } from '@/lib/orders/late-transfer-preview';
import type { PaymentTransaction } from '@/types/payment';
const buttonStyle = 'inline-flex min-h-11 items-center justify-center gap-2 rounded px-4 py-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:opacity-50 disabled:cursor-not-allowed';
const primaryButton = `${buttonStyle} bg-sf-accent-bg text-sf-inverse hover:bg-sf-accent-hover`;
const input = 'block rounded border border-sf-border bg-sf-input p-2';
export default function BankTransferSection({ transaction: tx, onRefresh }: { transaction: PaymentTransaction; onRefresh(): void | Promise<void> }) {
  const t = useTranslations('bankTransfer'), locale = useLocale();
  const [amount, setAmount] = useState(String(fromMinorUnits(tx.amount, tx.currency))), [paidAt, setPaidAt] = useState(''), [reason, setReason] = useState('');
  const amountErrorId = useId();
  const [amountError, setAmountError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null), amountErrorRef = useRef<HTMLParagraphElement>(null);
  const [amountRefusals, setAmountRefusals] = useState(0);
  // Every refused amount is shown where the seller looks: the field takes focus and its message scrolls into view.
  useEffect(() => {
    if (!amountRefusals) return;
    amountRef.current?.focus({ preventScroll: true });
    amountErrorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [amountRefusals]);
  const [lateReason, setLateReason] = useState('');
  const lock = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const deadlines = Object.values(ORDER_NOTICES).filter(spec => tx[spec.state] && tx[spec.column])
      .map(spec => Date.parse(tx[spec.column]!) + NOTICE_RETRY_DELAY).filter(at => at > now);
    if (!deadlines.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => clearTimeout(timer);
  }, [tx, now]);
  const [message, setMessage] = useState('');
  const lateDecision = tx.payment_provider === 'bank_transfer' && tx.status === 'cancelled' && tx.invoice?.status !== 'corrected';
  const [preview, setPreview] = useState<LateTransferPreview | null | 'error'>(null);
  const [declined, setDeclined] = useState(false);
  // Over a seat limit the acceptance is a second explicit decision; the server refuses it without one.
  const [overLimitRefused, setOverLimitRefused] = useState(false), [acceptOversold, setAcceptOversold] = useState(false);
  const overLimit = overLimitRefused || (!!preview && preview !== 'error' && preview.seats?.oversold === true);
  useEffect(() => {
    if (!lateDecision) return;
    let live = true;
    getLateTransferPreview(tx.id).then(r => { if (live) setPreview(r.success && r.data ? r.data : 'error'); }).catch(() => { if (live) setPreview('error'); });
    return () => { live = false; };
  }, [lateDecision, tx.id]);
  const price = (major: number) => formatPrice(major, tx.currency, locale);
  const progress = (action: string, label: string) => <>{pending === action && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}{t(pending === action ? `${label}Pending` : label)}</>;
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  // Receipt date window (UTC days, as sent to the server): order day … today. @see supabase/tests/transfer-paid-at-window.sql
  const orderDay = tx.created_at ? tx.created_at.slice(0, 10) : undefined, today = new Date().toISOString().slice(0, 10);
  const failure = (code?: string) => t(code === 'paid_at_before_order' ? 'paidAtBeforeOrder' : code === 'paid_at_future' ? 'paidAtFuture'
    : code === 'oversold_confirmation_required' ? 'lateOversoldRequired' : 'operationError');
  async function run(action: 'mark-paid' | 'cancel' | 'invoice-issued' | 'accept-late') {
    if (lock.current) return;
    setMessage('');
    setAmountError('');
    if ((action === 'mark-paid' || action === 'accept-late') && toMinorUnits(Number(amount), tx.currency) !== tx.amount) { setAmountError(t('amountMismatch')); setAmountRefusals(n => n + 1); return; }
    if ((action === 'mark-paid' || action === 'accept-late') && orderDay && paidAt && paidAt < orderDay) { setMessage(failure('paid_at_before_order')); return; }
    if ((action === 'mark-paid' || action === 'accept-late') && paidAt > today) { setMessage(failure('paid_at_future')); return; }
    lock.current = true;
    setPending(action);
    try {
      // The receipt date is only parsed for payment actions; an empty date field must not break cancellation.
      const paid = () => ({ amount: toMinorUnits(Number(amount), tx.currency), paidAt: new Date(`${paidAt}T00:00:00Z`).toISOString() });
      const body = action === 'cancel' ? { action, reason } : action === 'invoice-issued' ? { action }
        : action === 'accept-late' ? { action: 'mark-paid', ...paid(), acceptCancelled: true, reason: lateReason, acceptOversold: overLimit && acceptOversold } : { action, ...paid() };
      const r = await updateBankTransfer(tx.id, body);
      if (r.success) await onRefresh();
      else {
        const code = 'code' in r && typeof r.code === 'string' ? r.code : undefined;
        if (code === 'oversold_confirmation_required') setOverLimitRefused(true);
        setMessage(failure(code));
      }
    } catch { setMessage(t('operationError')); } finally { lock.current = false; setPending(null); }
  }
  if (tx.payment_provider !== 'bank_transfer') return null;
  const paidFields = <>
    <div><label>{t('bookedAmount')} ({tx.currency})<input ref={amountRef} className={input} type="number" min="0" step={currencyExponent(tx.currency) === 0 ? '1' : '0.01'} required value={amount} aria-invalid={!!amountError} aria-describedby={amountError ? amountErrorId : undefined} onChange={e => { setAmount(e.target.value); setAmountError(''); }} /></label>
    {amountError && <p ref={amountErrorRef} id={amountErrorId} role="alert" className="mt-1 text-sm text-sf-danger">{amountError}</p>}</div>
    <label>{t('paidAt')}<input className={input} type="date" required min={orderDay} max={today} value={paidAt} onChange={e => setPaidAt(e.target.value)} /></label>
  </>;
  return <section aria-label={t('title')}>
    {tx.status === 'awaiting_payment' && <><TutorialTrigger id="unpaid-orders" /><TutorialHelpButton id="unpaid-orders" /></>}
    {(['placed', 'reminder', 'cancelled', 'paid'] as const).map(notice => {
      const spec = ORDER_NOTICES[notice];
      const retryAt = tx[spec.column] ? Date.parse(tx[spec.column]!) + NOTICE_RETRY_DELAY : Infinity;
      return tx[spec.state] && noticeMatchesStatus(notice, tx.status) && <div key={notice} className="my-3 text-sf-warning" role="status"><p>{t('mailUnknown', { notice: t(`mailNotice_${notice}`) })}</p>
        {retryAt <= now && <button type="button" disabled={busy} className={primaryButton} onClick={async () => {
          if (lock.current) return;
          lock.current = true; setPending('mail'); setMessage('');
          try { const r = await retryOrderNotice(tx.id, notice); await onRefresh(); if (!r.success) setMessage(t('operationError')); }
          catch { setMessage(t('operationError')); } finally { lock.current = false; setPending(null); }
        }}>{t('retryMail')}</button>}</div>;
    })}
    <div data-tour="unpaid-instructions"><TransferInstructions transfer={tx.transfer_details ?? null} amount={tx.amount} currency={tx.currency} dueAt={transferDeadline(tx)} /></div>
    {tx.status === 'awaiting_payment' && <div className="space-y-3">
      <form data-tour="unpaid-mark-paid" onSubmit={e => { e.preventDefault(); void run('mark-paid'); }} className="flex flex-wrap gap-3 items-end">
        {paidFields}
        <button aria-busy={busy} disabled={busy} className={primaryButton}>{progress('mark-paid', 'markPaid')}</button>
      </form>
      <form data-tour="unpaid-cancel" onSubmit={e => { e.preventDefault(); void run('cancel'); }} className="flex flex-wrap items-end gap-3">
        <label>{t('reason')}<input className={input} required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button aria-busy={busy} disabled={busy || !reason.trim()} className={`${buttonStyle} bg-sf-danger text-white hover:opacity-90`}>{progress('cancel', 'cancel')}</button>
      </form>
    </div>}
    <p role="status">{message}</p>
    <ul data-tour="unpaid-lifecycle" className="my-3 space-y-1 text-sm" aria-label={t('lifecycle')}>
      {tx.status === 'awaiting_payment' && tx.invoice_hold_at && <li>{t('invoiceHoldAdmin')}</li>}
      {tx.status === 'awaiting_payment' && tx.release_at && <li>{t('releaseAt', { date: date(tx.release_at) })}{tx.reminder_at ? ` · ${t('reminderAt', { date: date(tx.reminder_at) })}` : ''}</li>}
      {tx.transfer_declared_at && <li className="font-semibold text-sf-warning [overflow-wrap:anywhere]">{t('declaredBadge', { date: date(tx.transfer_declared_at) })}{tx.transfer_declared_note ? `: ${tx.transfer_declared_note}` : ''}{tx.release_at && Date.parse(tx.transfer_declared_at) >= Date.parse(tx.release_at) ? ` (${t('declaredAfterDeadline')})` : ''}</li>}
      {tx.status === 'cancelled' && tx.cancel_reason && <li>{t(`cancelReason_${tx.cancel_reason === 'payment_window_expired' ? 'expired' : 'admin'}`)}</li>}
      {tx.reopened_at && <li>{t('reopened', { date: date(tx.reopened_at) })}</li>}
    </ul>
    {tx.status === 'awaiting_payment' && !tx.invoice_hold_at && <button type="button" data-tour="unpaid-invoice" aria-busy={busy} disabled={busy} onClick={() => void run('invoice-issued')} className={primaryButton}>{progress('invoice-issued', 'markInvoiceIssued')}</button>}
    {lateDecision && <div className="space-y-3">
      <p className="text-sm text-sf-muted">{t('lateHelp')}</p>
      {/* Facts at the moment of the decision; acceptance always keeps the order price. */}
      <section aria-label={t('latePreview')} className="rounded border border-sf-border p-3 text-sm">
        <h4 className="font-semibold">{t('latePreview')}</h4>
        {preview === 'error' && <p>{t('latePreviewError')}</p>}
        {preview && preview !== 'error' && <ul className="mt-1 space-y-1">
          <li>{t('latePrice', { then: price(preview.unitPrice), today: preview.unitPriceToday === null ? t('latePriceTodayUnavailable') : price(preview.unitPriceToday) })}{preview.priceChanged && preview.unitPriceToday !== null ? ` ${t('latePriceChanged')}` : ''}</li>
          {preview.seats && <li className={preview.seats.oversold ? 'font-semibold text-sf-warning' : undefined}>{preview.seats.oversold ? t('lateSeatsOversold')
            : preview.seats.remaining === null ? t('lateSeatsUnlimited') : t('lateSeatsFree', { remaining: preview.seats.remaining })}</li>}
          {preview.seats && preview.seats.tierRemaining !== null && <li>{t('lateSeatsTier', { remaining: preview.seats.tierRemaining })}</li>}
          {preview.seats?.started && <li className="font-semibold text-sf-warning">{t('lateSessionStarted')}</li>}
          {preview.coupon && <li>{t('lateCoupon', { code: preview.coupon.code ?? '—', status: t(`lateCoupon_${preview.coupon.status}`) })}</li>}
        </ul>}
      </section>
      {declined ? <div className="flex flex-wrap items-center gap-3">
        <p role="status">{t('lateDeclined')}</p>
        <button type="button" onClick={() => setDeclined(false)} className={`${buttonStyle} border border-sf-border`}>{t('lateReconsider')}</button>
      </div> : <form onSubmit={e => { e.preventDefault(); void run('accept-late'); }} className="flex flex-wrap gap-3 items-end" aria-label={t('acceptLate')}>
        {paidFields}
        <label>{t('lateReason')}<input className={input} required maxLength={1000} value={lateReason} onChange={e => setLateReason(e.target.value)} /></label>
        {overLimit && <label className="flex min-h-11 items-center gap-2 font-semibold text-sf-warning">
          <input type="checkbox" required checked={acceptOversold} onChange={e => setAcceptOversold(e.target.checked)} />{t('lateOversoldConfirm')}</label>}
        <button aria-busy={busy} disabled={busy || !lateReason.trim() || (overLimit && !acceptOversold)} className={primaryButton}>{progress('accept-late', 'acceptLate')}</button>
        {/* Declining changes nothing: the order stays cancelled and the money is returned outside Sellf. */}
        <button type="button" disabled={busy} onClick={() => { setDeclined(true); setMessage(''); }} className={`${buttonStyle} border border-sf-border`}>{t('lateDecline')}</button>
      </form>}
    </div>}
  </section>;
}
