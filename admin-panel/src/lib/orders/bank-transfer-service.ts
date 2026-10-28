/** Recoverable transfer events and fulfillment. @see app/api/cron/route.ts */
import { orderMoney, minorOrderLines } from '@/lib/orders/event-money';
import { sendTransferAccessMail } from '@/lib/orders/transfer-mail';
import { WebhookService } from '@/lib/services/webhook-service';
import { fulfillPaidOrder } from '@/lib/services/fulfill-paid-order';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
type TransferEvent = 'order.placed' | 'order.cancelled' | 'order.overdue';
const eventColumn = { 'order.placed': 'order_placed_notified_at', 'order.cancelled': 'order_cancelled_notified_at', 'order.overdue': 'order_overdue_notified_at' } as const;
export async function dispatchTransferEvent(db: SupabaseClient<Database>, id: string, event: TransferEvent): Promise<void> {
  const { data: tx, error } = await db.from('payment_transactions').select('*').eq('id', id).single();
  if (error || !tx) throw new Error('Transfer unavailable');
  if (tx[eventColumn[event]] || tx.payment_provider !== 'bank_transfer') return;
  if (event === 'order.overdue' && (tx.status !== 'awaiting_payment' || !tx.payment_due_at || Date.parse(tx.payment_due_at) >= Date.now())) return;
  if (event === 'order.cancelled' && tx.status !== 'cancelled') return;
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
  await WebhookService.trigger(event, { amountUnit: 'minor', customer: { email: tx.customer_email, userId: buyer.data }, order: { orderId: tx.id, orderNumber: tx.order_number, ...orderMoney(tx),
    status: tx.status, dueAt: tx.payment_due_at, transfer: tx.transfer_details }, access, orderDetails: tx.order_details, lines: minorOrderLines(lines ?? []) }, db, productIds);
  const saved = await db.from('payment_transactions').update({ [eventColumn[event]]: new Date().toISOString() } as Database['public']['Tables']['payment_transactions']['Update']).eq('id', id);
  if (saved.error) throw new Error('Transfer event state unavailable');
}
export async function fulfillTransfer(db: SupabaseClient<Database>, id: string): Promise<void> {
  const { data: tx, error } = await db.from('payment_transactions').select('*').eq('id', id).eq('payment_provider', 'bank_transfer').eq('status', 'completed').single();
  if (error || !tx) throw new Error('Paid transfer unavailable');
  await fulfillPaidOrder({ supabase: db, transactionId: id, provider: { kind: 'offline' }, productId: tx.product_id,
    customerEmail: tx.customer_email, amount: tx.amount, currency: tx.currency, couponId: tx.coupon_id, isGuest: !tx.user_id });
}
export async function runTransferJob(db: SupabaseClient<Database>, job: 'bank-transfer-overdue' | 'fulfillment-resume'): Promise<{ processed: number; errors: number }> {
  let processed = 0; let errors = 0;
  const run = async (id: string, action: () => Promise<void>) => {
    try { await action(); processed++; } catch { console.error('[runTransferJob] Order failed:', id); errors++; }
  };
  if (job === 'bank-transfer-overdue') {
    const { data, error } = await db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer')
      .eq('status', 'awaiting_payment').lt('payment_due_at', new Date().toISOString()).is('order_overdue_notified_at', null).limit(100);
    if (error) throw new Error('Transfer query unavailable');
    for (const tx of data ?? []) await run(tx.id, () => dispatchTransferEvent(db, tx.id, 'order.overdue'));
  } else {
    for (const event of ['order.placed', 'order.cancelled'] as const) {
      let query = db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer').is(eventColumn[event], null);
      query = event === 'order.cancelled' ? query.eq('status', 'cancelled') : query.not('payment_due_at', 'is', null);
      const { data, error } = await query.limit(100);
      if (error) throw new Error('Transfer events unavailable');
      for (const tx of data ?? []) await run(tx.id, () => dispatchTransferEvent(db, tx.id, event));
    }
    const { data, error } = await db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer')
      .eq('status', 'completed').eq('fulfillment_pending', true).lt('updated_at', new Date(Date.now() - 120000).toISOString()).limit(100);
    if (error) throw new Error('Transfer fulfillment unavailable');
    for (const tx of data ?? []) await run(tx.id, () => fulfillTransfer(db, tx.id));
  }
  if (job === 'fulfillment-resume') {
    const { data, error } = await db.from('payment_transactions').select('id').eq('payment_provider', 'bank_transfer')
      .in('status', ['awaiting_payment', 'completed']).contains('metadata', { access_on_placement: true }).is('transfer_mail_sent_at', null).limit(100);
    if (error) throw new Error('Transfer mail unavailable');
    for (const tx of data ?? []) await run(tx.id, () => sendTransferAccessMail(db, tx.id));
  }
  return { processed, errors };
}
