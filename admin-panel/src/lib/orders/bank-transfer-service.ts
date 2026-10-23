/** Recoverable transfer events and fulfillment. @see app/api/cron/route.ts */
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
  await WebhookService.trigger(event, { order: { orderId: tx.id, orderNumber: tx.order_number, amount: tx.amount,
    currency: tx.currency, dueAt: tx.payment_due_at, transfer: tx.transfer_details }, orderDetails: tx.order_details, lines }, db, (lines ?? []).map(l => l.product_id!));
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
  return { processed, errors };
}
