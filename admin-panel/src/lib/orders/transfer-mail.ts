/** Buyer mails for a transfer order over the Auth mail channel. @see auth/magic-link/request.ts, supabase/templates/magic-link.html */
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import { buildOrderPayLink } from '@/lib/orders/transfer-token';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type OrderNotice = 'placed' | 'reminder' | 'cancelled';
const NOTICE = {
  placed: { kind: 'transfer_placed', column: 'transfer_mail_sent_at', statuses: ['awaiting_payment', 'completed'] },
  reminder: { kind: 'payment_reminder', column: 'reminder_mail_sent_at', statuses: ['awaiting_payment'] },
  cancelled: { kind: 'order_cancelled', column: 'cancelled_mail_sent_at', statuses: ['cancelled'] },
} as const;

/** Sends each notice at most once per order; a failed delivery stays pending for the reservation job. */
export async function sendOrderNotice(db: SupabaseClient<Database>, id: string, notice: OrderNotice): Promise<void> {
  const spec = NOTICE[notice];
  try {
    const { data: tx } = await db.from('payment_transactions').select('*').eq('id', id).single();
    if (!tx || tx[spec.column] || !(spec.statuses as readonly string[]).includes(tx.status) || !tx.customer_email) return;
    if (notice === 'reminder' && !tx.release_at) return;
    const meta = tx.metadata as Record<string, unknown> | null;
    const { data: product } = await db.from('products').select('slug,name').eq('id', tx.product_id).single();
    if (!product) return;
    const transfer = (tx.transfer_details ?? {}) as Record<string, string>, locale = meta?.locale === 'pl' ? 'pl' : 'en';
    const pl = locale === 'pl', base = getSellfBaseUrl();
    const amount = formatPrice(fromMinorUnits(tx.amount, tx.currency), tx.currency, locale);
    const date = (iso: string | null) => iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(iso)) : '';
    const due = date(tx.release_at ?? tx.payment_due_at);
    const transferText = notice === 'cancelled' ? undefined : [pl ? 'Dane do przelewu' : 'Bank transfer instructions',
      `${pl ? 'Odbiorca' : 'Recipient'}: ${transfer.holder}`, `${pl ? 'Numer konta' : 'Account number'}: ${transfer.account}`,
      transfer.bank && `Bank: ${transfer.bank}`, `${pl ? 'Tytuł' : 'Reference'}: ${transfer.title}`,
      `${pl ? 'Kwota' : 'Amount'}: ${amount}`, due && `${pl ? 'Termin' : 'Due date'}: ${due}`].filter(Boolean).join('\n');
    const releaseText = notice === 'reminder'
      ? (pl ? `Nie widzimy jeszcze wpłaty. Jeśli chcesz zachować miejsce i cenę, zapłać online na stronie zamówienia albo zrób przelew i kliknij tam „Wysłałem przelew” do ${due}. Po tym terminie miejsce i cena przepadają.`
        : `We have not received your payment yet. To keep your seat and price, pay online on the order page, or send the transfer and click "I have sent the transfer" there, by ${due}. After that the seat and price are released.`)
      : notice === 'cancelled'
        ? `${tx.cancel_reason === 'payment_window_expired'
          ? (pl ? 'Zamówienie zostało anulowane, bo nie otrzymaliśmy wpłaty w terminie.' : 'The order was cancelled because we did not receive the payment in time.')
          : (pl ? 'Zamówienie zostało anulowane.' : 'The order was cancelled.')} ${pl
          ? 'Nie wysyłaj już przelewu; jeśli płatność jest w drodze, skontaktuj się ze sprzedawcą.'
          : 'Please do not send the transfer; if it is already on its way, contact the seller.'}`
        : undefined;
    const data = { locale, mail_kind: spec.kind, purchase_product: product.name, purchase_amount: amount,
      pay_url: buildOrderPayLink(tx.id, locale, base).url, ...(transferText ? { transfer_text: transferText } : {}), ...(releaseText ? { release_text: releaseText } : {}) };
    const result = await sendTrustedMagicLink({ email: tx.customer_email,
      redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: base, productSlug: product.slug, locale, sessionId: undefined, paymentIntentId: undefined }), data });
    if (result.ok) await db.from('payment_transactions').update({ [spec.column]: new Date().toISOString() } as Database['public']['Tables']['payment_transactions']['Update']).eq('id', id);
  } catch { console.error('[transfer-mail] Delivery awaiting recovery:', id); }
}
