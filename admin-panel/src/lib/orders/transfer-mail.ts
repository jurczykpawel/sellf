/** Auth mails for a bank-transfer order: instructions on placement, confirmation once booked. @see auth/magic-link/request.ts */
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import { formatTransferAccount } from '@/lib/orders/transfer-format';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Transaction = Database['public']['Tables']['payment_transactions']['Row'];
type MailContext = { locale: 'pl' | 'en'; productName: string; productSlug: string; amount: string; tx: Transaction };

async function sendOrderMail(db: SupabaseClient<Database>, id: string, kind: 'placement' | 'paid'): Promise<void> {
  try {
    const { data: tx } = await db.from('payment_transactions').select('*').eq('id', id).eq('payment_provider', 'bank_transfer').single();
    if (!tx?.customer_email) return;
    const sentColumn = kind === 'paid' ? 'transfer_paid_mail_sent_at' as const : 'transfer_mail_sent_at' as const;
    const meta = tx.metadata as Record<string, unknown> | null;
    if (tx[sentColumn]) return;
    if (kind === 'paid' ? tx.status !== 'completed' : !['awaiting_payment', 'completed'].includes(tx.status ?? '') || meta?.access_on_placement !== true) return;
    const { data: product } = await db.from('products').select('slug,name').eq('id', tx.product_id).single();
    if (!product) return;
    const locale = meta?.locale === 'pl' ? 'pl' : 'en';
    const context: MailContext = { locale, productName: product.name, productSlug: product.slug, tx,
      amount: formatPrice(fromMinorUnits(tx.amount, tx.currency), tx.currency, locale) };
    const result = await sendTrustedMagicLink({ email: tx.customer_email,
      redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: getSellfBaseUrl(), productSlug: product.slug, locale, sessionId: undefined, paymentIntentId: undefined }),
      data: kind === 'paid' ? paidMailData(context) : placementMailData(context) });
    const sentAt = new Date().toISOString();
    if (result.ok) await db.from('payment_transactions').update(kind === 'paid' ? { transfer_paid_mail_sent_at: sentAt } : { transfer_mail_sent_at: sentAt }).eq('id', id);
  } catch { console.error(`[transfer-mail] ${kind} delivery awaiting recovery:`, id); }
}

function baseData({ locale, productName, amount }: MailContext) {
  return { locale, purchase_product: productName, purchase_amount: amount };
}
function placementMailData(context: MailContext) {
  const { tx, locale, amount } = context;
  const transfer = tx.transfer_details as Record<string, string>;
  const due = tx.payment_due_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(tx.payment_due_at)) : '';
  return { ...baseData(context), transfer: Object.fromEntries(Object.entries({
    holder: transfer.holder, account: formatTransferAccount(transfer.account), bank: transfer.bank, title: transfer.title, amount, due,
  }).filter(([, value]) => value)) };
}
function paidMailData(context: MailContext) {
  return { ...baseData(context), payment_received: 'true' };
}

export const sendTransferAccessMail = (db: SupabaseClient<Database>, id: string) => sendOrderMail(db, id, 'placement');
export const sendTransferPaidMail = (db: SupabaseClient<Database>, id: string) => sendOrderMail(db, id, 'paid');
