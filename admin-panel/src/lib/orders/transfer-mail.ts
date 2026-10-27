/** Auth access mail for a placed transfer. @see auth/magic-link/request.ts */
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
export async function sendTransferAccessMail(db: SupabaseClient<Database>, id: string): Promise<void> {
  try {
    const { data: tx } = await db.from('payment_transactions').select('*').eq('id', id).single();
    if (!tx || tx.transfer_mail_sent_at || !['awaiting_payment', 'completed'].includes(tx.status) || !tx.customer_email) return;
    const meta = tx.metadata as Record<string, unknown> | null;
    if (meta?.access_on_placement !== true) return;
    const { data: product } = await db.from('products').select('slug,name').eq('id', tx.product_id).single();
    if (!product) return;
    const transfer = tx.transfer_details as Record<string, string>, locale = meta.locale === 'pl' ? 'pl' : 'en';
    const pl = locale === 'pl';
    const amount = formatPrice(fromMinorUnits(tx.amount, tx.currency), tx.currency, locale);
    const due = tx.payment_due_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(tx.payment_due_at)) : '';
    const data = { locale, purchase_product: product.name, purchase_amount: amount,
      transfer_text: [pl ? 'Dane do przelewu' : 'Bank transfer instructions',
        `${pl ? 'Odbiorca' : 'Recipient'}: ${transfer.holder}`, `${pl ? 'Numer konta' : 'Account number'}: ${transfer.account}`,
        transfer.bank && `Bank: ${transfer.bank}`, `${pl ? 'Tytuł' : 'Reference'}: ${transfer.title}`,
        `${pl ? 'Kwota' : 'Amount'}: ${amount}`, due && `${pl ? 'Termin' : 'Due date'}: ${due}`].filter(Boolean).join('\n') };
    const result = await sendTrustedMagicLink({ email: tx.customer_email,
      redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: getSellfBaseUrl(), productSlug: product.slug, locale, sessionId: undefined, paymentIntentId: undefined }), data });
    if (result.ok) await db.from('payment_transactions').update({ transfer_mail_sent_at: new Date().toISOString() }).eq('id', id);
  } catch { console.error('[transfer-mail] Delivery awaiting recovery:', id); }
}
