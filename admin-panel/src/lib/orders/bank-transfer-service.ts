/** Recoverable transfer events, reservation timer and fulfillment. @see app/api/cron/route.ts, migration 20261103150000_unpaid_order_reservations.sql */
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { orderMoney, minorOrderLines } from '@/lib/orders/event-money';
import { sendOrderNotice } from '@/lib/orders/transfer-mail';
import { buildOrderPayLink } from '@/lib/orders/transfer-token';
import { WebhookService } from '@/lib/services/webhook-service';
import { fulfillPaidOrder } from '@/lib/services/fulfill-paid-order';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Tx = Database['public']['Tables']['payment_transactions']['Row'];
type TxUpdate = Database['public']['Tables']['payment_transactions']['Update'];
export type TransferEvent = 'order.placed' | 'order.cancelled' | 'order.overdue' | 'order.payment_reminder'
  | 'order.transfer_declared' | 'order.invoice_issued' | 'order.reopened';
const eventColumn = {
  'order.placed': 'order_placed_notified_at', 'order.cancelled': 'order_cancelled_notified_at', 'order.overdue': 'order_overdue_notified_at',
  'order.payment_reminder': 'order_reminder_notified_at', 'order.transfer_declared': 'order_transfer_declared_notified_at',
  'order.invoice_issued': 'order_invoice_issued_notified_at', 'order.reopened': 'order_reopened_notified_at',
} as const satisfies Record<TransferEvent, keyof Tx>;

/** Whether the order is still in the state the event describes (late recovery must never announce a stale state). */
function eventApplies(tx: Tx, event: TransferEvent): boolean {
  switch (event) {
    case 'order.overdue': return tx.status === 'awaiting_payment' && !!tx.payment_due_at && Date.parse(tx.payment_due_at) < Date.now();
    case 'order.cancelled': return tx.status === 'cancelled';
    case 'order.payment_reminder': return tx.status === 'awaiting_payment' && !!tx.release_at;
    case 'order.transfer_declared': return !!tx.transfer_declared_at;
    case 'order.invoice_issued': return !!tx.invoice_hold_at;
    case 'order.reopened': return !!tx.reopened_at;
    default: return true;
  }
}

export function orderLocale(tx: Pick<Tx, 'metadata'>): 'pl' | 'en' {
  return (tx.metadata as Record<string, unknown> | null)?.locale === 'pl' ? 'pl' : 'en';
}

/** Lifecycle block shared by every order.* event (additive to the original payload). */
function lifecycle(tx: Tx) {
  let link: { url: string | null; expiresAt: string | null } = { url: null, expiresAt: null };
  // A missing signing secret must not block the event itself; the link is then simply absent.
  try { link = buildOrderPayLink(tx.id, orderLocale(tx), getSellfBaseUrl()); } catch { console.error('[transfer-event] Pay link unavailable:', tx.id); }
  return {
    payUrl: link.url, payUrlExpiresAt: link.expiresAt,
    reservation: tx.invoice_hold_at ? 'invoice' : tx.release_at ? 'timed' : 'none',
    reminderAt: tx.reminder_at, releaseAt: tx.release_at, invoiceHoldAt: tx.invoice_hold_at,
    transferDeclaredAt: tx.transfer_declared_at, transferDeclaredNote: tx.transfer_declared_note,
    cancelReason: tx.cancel_reason, reopenedAt: tx.reopened_at,
    ...(tx.status === 'cancelled' ? { lateTransferPolicy: 'admin_decision' } : {}),
    ...(tx.reopened_at ? { previousStatus: 'cancelled' } : {}),
  };
}

export async function dispatchTransferEvent(db: SupabaseClient<Database>, id: string, event: TransferEvent): Promise<void> {
  const { data: tx, error } = await db.from('payment_transactions').select('*').eq('id', id).single();
  if (error || !tx) throw new Error('Transfer unavailable');
  if (tx[eventColumn[event]] || tx.payment_provider !== 'bank_transfer' || !eventApplies(tx, event)) return;
  const { data: lines, error: lineError } = await db.from('payment_line_items').select('*').eq('transaction_id', id);
  if (lineError) throw new Error('Transfer lines unavailable');
  const roots = [...new Set([tx.product_id, ...(lines ?? []).map(l => l.product_id!).filter(Boolean)])];
  const components = await db.from('bundle_items').select('component_product_id').in('bundle_product_id', roots);
  if (components.error) throw new Error('Transfer components unavailable');
  const productIds = [...new Set([...roots, ...(components.data ?? []).map(c => c.component_product_id)])];
  const buyer = tx.user_id ? { data: tx.user_id, error: null } : await db.rpc('find_user_id_by_email', { p_email: tx.customer_email });
  if (buyer.error) throw new Error('Transfer buyer unavailable');
  const { data: grants, error: accessError } = buyer.data ? await db.from('user_product_access').select('product_id,access_granted_at,access_expires_at').eq('user_id', buyer.data).in('product_id', productIds) : { data: [], error: null };
  if (accessError) throw new Error('Transfer access unavailable');
  const onPlacement = (tx.metadata as Record<string, unknown> | null)?.access_on_placement === true;
  const access = { policy: onPlacement ? 'on_placement' : 'after_payment', grants: productIds.map(productId => {
    const grant = grants?.find(g => g.product_id === productId);
    return { productId, status: grant ? (grant.access_expires_at && Date.parse(grant.access_expires_at) <= Date.now() ? 'expired' : 'granted') : tx.status === 'cancelled' ? 'revoked' : onPlacement || tx.status === 'completed' ? 'pending_confirmation' : 'pending_payment',
      grantedAt: grant?.access_granted_at ?? null, expiresAt: grant?.access_expires_at ?? null };
  }) };
  await WebhookService.trigger(event, { amountUnit: 'minor', customer: { email: tx.customer_email, userId: buyer.data, locale: orderLocale(tx) },
    order: { orderId: tx.id, orderNumber: tx.order_number, ...orderMoney(tx), status: tx.status, dueAt: tx.payment_due_at, transfer: tx.transfer_details, ...lifecycle(tx) },
    access, orderDetails: tx.order_details, lines: minorOrderLines(lines ?? []) }, db, productIds);
  const saved = await db.from('payment_transactions').update({ [eventColumn[event]]: new Date().toISOString() } as TxUpdate).eq('id', id);
  if (saved.error) throw new Error('Transfer event state unavailable');
}

export async function fulfillTransfer(db: SupabaseClient<Database>, id: string): Promise<void> {
  const { data: tx, error } = await db.from('payment_transactions').select('*').eq('id', id).eq('payment_provider', 'bank_transfer').eq('status', 'completed').single();
  if (error || !tx) throw new Error('Paid transfer unavailable');
  await fulfillPaidOrder({ supabase: db, transactionId: id, provider: { kind: 'offline' }, productId: tx.product_id,
    customerEmail: tx.customer_email, amount: tx.amount, currency: tx.currency, couponId: tx.coupon_id, isGuest: !tx.user_id });
  await sendOrderNotice(db, id, 'paid');
}

const BATCH = 100;
async function ids(query: PromiseLike<{ data: { id: string }[] | null; error: unknown }>): Promise<string[]> {
  const { data, error } = await query;
  if (error) throw new Error('Transfer query unavailable');
  return (data ?? []).map(r => r.id);
}

/** Reminder, release and recovery of every timer-driven notification. Time comes from one clock read per run. */
async function runReservations(db: SupabaseClient<Database>, run: (id: string, action: () => Promise<void>) => Promise<void>): Promise<void> {
  const now = new Date().toISOString();
  const transfers = () => db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer');
  for (const id of await ids(transfers().eq('status', 'awaiting_payment').lte('reminder_at', now).not('release_at', 'is', null).is('order_reminder_notified_at', null).limit(BATCH))) {
    await run(id, async () => { await dispatchTransferEvent(db, id, 'order.payment_reminder'); await sendOrderNotice(db, id, 'reminder'); });
  }
  for (const id of await ids(transfers().eq('status', 'awaiting_payment').lte('release_at', now).limit(BATCH))) {
    await run(id, async () => {
      const { data, error } = await db.rpc('release_unpaid_transfer', { p_id: id, p_now: now });
      if (error) throw new Error('Release failed');
      if ((data as { released?: boolean } | null)?.released !== true) return;
      await dispatchTransferEvent(db, id, 'order.cancelled'); await sendOrderNotice(db, id, 'cancelled');
    });
  }
  const pending: Array<[TransferEvent, ReturnType<typeof transfers>]> = [
    ['order.invoice_issued', transfers().not('invoice_hold_at', 'is', null).is('order_invoice_issued_notified_at', null)],
    ['order.transfer_declared', transfers().not('transfer_declared_at', 'is', null).is('order_transfer_declared_notified_at', null)],
    ['order.reopened', transfers().not('reopened_at', 'is', null).is('order_reopened_notified_at', null)],
  ];
  for (const [event, query] of pending) for (const id of await ids(query.limit(BATCH))) await run(id, () => dispatchTransferEvent(db, id, event));
  for (const id of await ids(transfers().eq('status', 'awaiting_payment').not('order_reminder_notified_at', 'is', null).is('reminder_mail_sent_at', null).limit(BATCH))) {
    await run(id, () => sendOrderNotice(db, id, 'reminder'));
  }
  for (const id of await ids(transfers().eq('status', 'cancelled').not('order_cancelled_notified_at', 'is', null).is('cancelled_mail_sent_at', null).limit(BATCH))) {
    await run(id, () => sendOrderNotice(db, id, 'cancelled'));
  }
}

export async function runTransferJob(db: SupabaseClient<Database>, job: 'bank-transfer-overdue' | 'fulfillment-resume' | 'transfer-reservations'): Promise<{ processed: number; errors: number }> {
  let processed = 0; let errors = 0;
  const run = async (id: string, action: () => Promise<void>) => {
    try { await action(); processed++; } catch { console.error('[runTransferJob] Order failed:', id); errors++; }
  };
  if (job === 'transfer-reservations') {
    await runReservations(db, run);
  } else if (job === 'bank-transfer-overdue') {
    const { data, error } = await db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer')
      .eq('status', 'awaiting_payment').lt('payment_due_at', new Date().toISOString()).is('order_overdue_notified_at', null).limit(BATCH);
    if (error) throw new Error('Transfer query unavailable');
    for (const tx of data ?? []) await run(tx.id, () => dispatchTransferEvent(db, tx.id, 'order.overdue'));
  } else {
    for (const event of ['order.placed', 'order.cancelled'] as const) {
      let query = db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer').is(eventColumn[event], null);
      query = event === 'order.cancelled' ? query.eq('status', 'cancelled') : query.not('payment_due_at', 'is', null);
      const { data, error } = await query.limit(BATCH);
      if (error) throw new Error('Transfer events unavailable');
      for (const tx of data ?? []) await run(tx.id, () => dispatchTransferEvent(db, tx.id, event));
    }
    const { data, error } = await db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer')
      .eq('status', 'completed').eq('fulfillment_pending', true).lt('updated_at', new Date(Date.now() - 120000).toISOString()).limit(BATCH);
    if (error) throw new Error('Transfer fulfillment unavailable');
    for (const tx of data ?? []) await run(tx.id, () => fulfillTransfer(db, tx.id));
    const mail = await db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer')
      .in('status', ['awaiting_payment', 'completed']).is('transfer_mail_sent_at', null)
      // Recovery window: orders placed before the mail was sent for every transfer are not mailed retroactively.
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).limit(BATCH);
    if (mail.error) throw new Error('Transfer mail unavailable');
    for (const tx of mail.data ?? []) await run(tx.id, () => sendOrderNotice(db, tx.id, 'placed'));
    const paid = await db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer')
      .eq('status', 'completed').eq('fulfillment_pending', false).is('transfer_paid_mail_sent_at', null).limit(BATCH);
    if (paid.error) throw new Error('Transfer payment mail unavailable');
    for (const tx of paid.data ?? []) await run(tx.id, () => sendOrderNotice(db, tx.id, 'paid'));
  }
  return { processed, errors };
}
