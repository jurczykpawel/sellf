/**
 * Participants added after payment: validation, atomic storage, buyer mail.
 * @see supabase/migrations/20261103191000_participants_later.sql
 * @see ./transfer-mail.ts
 */
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import { buildParticipantsLink } from '@/lib/orders/participants-token';
import { valueSchema } from '@/lib/checkout-modules/participants';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Db = SupabaseClient<Database>;
export type SubmitResult = { ok: true } | { ok: false; code: string; field?: string };
const BATCH = 50;

/** Same rules as checkout (count, e-mail, duplicates), then one database call that also emits the webhook. */
export async function submitParticipants(db: Db, orderId: string, quantity: number, people: unknown): Promise<SubmitResult> {
  const parsed = valueSchema({ id: 'participants', required: true, prefill_from_buyer: false }, { locale: 'en', currency: '', quantity }).safeParse(people);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, code: issue.code === 'custom' ? issue.message : 'invalid', ...(issue.path.length ? { field: issue.path.join('.') } : {}) };
  }
  const { data, error } = await db.rpc('submit_order_participants', { p_order_id: orderId, p_people: parsed.data });
  if (error) { console.error('[submitParticipants] Storage failed'); return { ok: false, code: 'unavailable' }; }
  const result = data as { ok: boolean; code?: string };
  return result.ok ? { ok: true } : { ok: false, code: result.code ?? 'unavailable' };
}

/** One mail per order; a failed delivery stays pending for the next run. */
export async function sendParticipantsNotice(db: Db, id: string): Promise<void> {
  try {
    const { data: tx } = await db.from('payment_transactions').select('*').eq('id', id).single();
    if (!tx || tx.participants_mail_sent_at || tx.status !== 'completed' || !tx.customer_email) return;
    const { data: product } = await db.from('products').select('slug,name').eq('id', tx.product_id).single();
    if (!product) return;
    const locale = (tx.metadata as Record<string, unknown> | null)?.locale === 'pl' ? 'pl' : 'en', base = getSellfBaseUrl();
    const result = await sendTrustedMagicLink({ email: tx.customer_email,
      redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: base, productSlug: product.slug, locale, sessionId: undefined, paymentIntentId: undefined }),
      data: { locale, mail_kind: 'participants_needed', purchase_product: product.name,
        purchase_amount: formatPrice(fromMinorUnits(tx.amount, tx.currency), tx.currency, locale),
        participants_url: buildParticipantsLink(tx.id, locale, base).url } });
    if (result.ok) await db.from('payment_transactions').update({ participants_mail_sent_at: new Date().toISOString() }).eq('id', id);
  } catch { console.error('[participants-mail] Delivery awaiting recovery:', id); }
}

export async function runParticipantsReminders(db: Db): Promise<{ processed: number; errors: number }> {
  const { data, error } = await db.rpc('list_orders_missing_participants', { p_unsent_only: true, p_limit: BATCH });
  if (error) throw new Error('Participants query unavailable');
  let processed = 0, errors = 0;
  for (const row of (data ?? []) as Array<{ id: string }>) {
    try { await sendParticipantsNotice(db, row.id); processed++; } catch { errors++; }
  }
  return { processed, errors };
}
