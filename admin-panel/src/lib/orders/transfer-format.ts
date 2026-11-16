/** Transfer account number as the buyer reads it on the order page and in mail. @see components/checkout/TransferInstructions.tsx */
export function formatTransferAccount(account: unknown): string {
  return String(account ?? '').replace(/\s/g, '').match(/.{1,4}/g)?.join(' ') ?? '';
}

/**
 * The one deadline a transfer buyer must meet: the reservation end while it runs (the order is
 * cancelled then, see release_unpaid_transfer), otherwise the seller's payment term. Used by the
 * order page and every transfer mail so both always show the same date.
 */
export function transferDeadline(tx: { release_at?: string | null; payment_due_at?: string | null }): string | null {
  return tx.release_at ?? tx.payment_due_at ?? null;
}

/**
 * Unpaid order past its reservation deadline, waiting for the release job to cancel it: no new online
 * payment starts, and the order page says the deadline passed instead of showing the transfer details.
 * @see supabase migration 20261115110000_cancelled_order_no_payment.sql (open_order_payment_attempt, release_unpaid_transfer)
 */
export function isReservationOverdue(tx: { status: string; release_at?: string | null }, now: Date): boolean {
  return tx.status === 'awaiting_payment' && !!tx.release_at && Date.parse(tx.release_at) <= now.getTime();
}

/** Deadline as the buyer reads it, identical on the page and in mail (Warsaw time, with the hour). */
export function formatTransferDeadline(iso: string | null | undefined, locale: string): string {
  return iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(iso)) : '';
}
