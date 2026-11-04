/** Transfer account number as the buyer reads it on the order page and in mail. @see components/checkout/TransferInstructions.tsx */
export function formatTransferAccount(account: unknown): string {
  return String(account ?? '').replace(/\s/g, '').match(/.{1,4}/g)?.join(' ') ?? '';
}

/**
 * The one deadline a transfer buyer must meet: the reservation end while it runs (the order is
 * cancelled then, see release_unpaid_transfer), otherwise the seller's payment term. Used by the
 * order page and every transfer mail so both always show the same date (W146).
 */
export function transferDeadline(tx: { release_at?: string | null; payment_due_at?: string | null }): string | null {
  return tx.release_at ?? tx.payment_due_at ?? null;
}

/** Deadline as the buyer reads it, identical on the page and in mail (Warsaw time, with the hour). */
export function formatTransferDeadline(iso: string | null | undefined, locale: string): string {
  return iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(iso)) : '';
}
