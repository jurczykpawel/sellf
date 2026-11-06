/**
 * Participants added after payment: validation, atomic storage, buyer mail.
 * @see supabase/migrations/20261103191000_participants_later.sql
 * @see ./transfer-mail.ts
 */
import { resolveCustomerLocale } from '@/lib/webhooks/customer-locale';
import { WebhookService } from '@/lib/services/webhook-service';
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

/** Stage 1: 24 h after purchase; stage 2: 2 days before the event. Each stage mails at most once; a failed delivery stays pending. */
export async function sendParticipantsNotice(db: Db, id: string, stage: 1 | 2 = 1): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    const { data: tx } = await db.from('payment_transactions').select('*').eq('id', id).single();
    const sent = stage === 1 ? tx?.participants_mail_sent_at : tx?.participants_reminder2_sent_at;
    const people = (tx?.order_details as { participants?: { people?: unknown[] } } | null)?.participants?.people ?? [];
    if (!tx || sent || people.length > 0 || tx.status !== 'completed' || !tx.customer_email) return 'skipped';
    const { data: product } = await db.from('products').select('slug,name').eq('id', tx.product_id).single();
    if (!product) return 'failed';
    const locale = await resolveCustomerLocale(db, (tx.metadata as Record<string, unknown> | null)?.locale), base = getSellfBaseUrl();
    const soon = locale === 'pl' ? 'Wydarzenie zbliża się, a lista uczestników nadal jest pusta.' : 'The event is coming up and the participant list is still empty.';
    const participantsUrl = buildParticipantsLink(tx.id, locale, base).url;
    await WebhookService.trigger('order.participants_needed', {
      amountUnit: 'minor', customer: { email: tx.customer_email, locale },
      product: { id: tx.product_id, name: product.name, slug: product.slug },
      order: { orderId: tx.id, orderNumber: tx.order_number, amount: tx.amount, currency: tx.currency, status: tx.status },
      orderDetails: tx.order_details, reminder: { stage, participantsUrl },
    }, db, tx.product_id, `participants:${tx.id}:${stage}`);
    const result = await sendTrustedMagicLink({ transactionalOnly: true, email: tx.customer_email,
      redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: base, productSlug: product.slug, locale, sessionId: undefined, paymentIntentId: undefined }),
      data: { locale, mail_kind: 'participants_needed', purchase_product: product.name,
        purchase_amount: formatPrice(fromMinorUnits(tx.amount, tx.currency), tx.currency, locale),
        participants_url: participantsUrl, ...(stage === 2 ? { release_text: soon } : {}) } });
    if (!result.ok) return 'failed';
    const now = new Date().toISOString();
    const { error } = await db.from('payment_transactions').update(stage === 1 ? { participants_mail_sent_at: now }
      : { participants_reminder2_sent_at: now, participants_mail_sent_at: tx.participants_mail_sent_at ?? now }).eq('id', id);
    return error ? 'failed' : 'sent';
  } catch { console.error('[participants-mail] Delivery awaiting recovery:', id); return 'failed'; }
}

export async function runParticipantsReminders(db: Db, now = new Date()): Promise<{ processed: number; errors: number }> {
  const { data, error } = await db.rpc('list_participants_reminders_due', { p_now: now.toISOString(), p_limit: BATCH });
  if (error) throw new Error('Participants query unavailable');
  let processed = 0, errors = 0;
  for (const row of (data ?? []) as Array<{ id: string; stage: number }>) {
    try {
      const result = await sendParticipantsNotice(db, row.id, row.stage === 2 ? 2 : 1);
      if (result === 'sent') processed++;
      else if (result === 'failed') errors++;
    } catch { errors++; }
  }
  return { processed, errors };
}
