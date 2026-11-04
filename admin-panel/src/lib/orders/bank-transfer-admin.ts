/** Shared admin operation for session and API-key callers. @see bank-transfer-service.ts */
import { z } from 'zod';
import { dispatchTransferEvent, fulfillTransfer } from '@/lib/orders/bank-transfer-service';
import { sendOrderNotice } from '@/lib/orders/transfer-mail';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
const reason = z.string().trim().min(1).max(1000);
export const transferOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mark-paid'), amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), paidAt: z.iso.datetime({ offset: true }),
    // A transfer received after the order was cancelled is accepted only on an explicit administrator decision.
    acceptCancelled: z.boolean().optional(), reason: reason.optional() }).strict()
    .refine(v => !v.acceptCancelled || !!v.reason),
  z.object({ action: z.literal('cancel'), reason }).strict(),
  z.object({ action: z.literal('invoice-issued') }).strict(),
]);
export interface TransferOperationResult { success: boolean; error?: string; code?: string; warning?: string; invoiceCorrectionRequired?: boolean }
export async function operateTransfer(db: SupabaseClient<Database>, actor: string, id: string, input: unknown): Promise<TransferOperationResult> {
  const parsed = transferOperationSchema.safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success) return { success: false, error: 'Invalid transfer operation' };
  const op = parsed.data;
  const { data, error } = await db.rpc('admin_bank_transfer_order', { p_id: id, p_actor: actor, p_action: op.action,
    p_amount: op.action === 'mark-paid' ? op.amount : undefined, p_paid_at: op.action === 'mark-paid' ? op.paidAt : undefined,
    p_reason: op.action === 'invoice-issued' ? undefined : op.reason, p_accept_cancelled: op.action === 'mark-paid' ? op.acceptCancelled === true : undefined });
  if (error || !data || typeof data !== 'object' || Array.isArray(data) || data.success !== true) {
    const code = data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string' ? data.error : undefined;
    return { success: false, error: code === 'invoice_corrected' ? 'The invoice was corrected; issue a new order instead'
      : code === 'order_cancelled' ? 'The order is cancelled; accept the late transfer explicitly with a reason'
      : code === 'paid_at_before_order' ? 'The receipt date cannot be earlier than the order date'
      : code === 'paid_at_future' ? 'The receipt date cannot be in the future'
      : 'The order must be awaiting payment and the booked amount must equal its full amount in minor units', ...(code ? { code } : {}) };
  }
  try {
    if (op.action === 'mark-paid') {
      if (data.reopened === true) await dispatchTransferEvent(db, id, 'order.reopened');
      await fulfillTransfer(db, id);
    } else if (op.action === 'cancel') {
      await dispatchTransferEvent(db, id, 'order.cancelled'); await sendOrderNotice(db, id, 'cancelled');
    } else await dispatchTransferEvent(db, id, 'order.invoice_issued');
  } catch { return { success: true, warning: 'Order saved; background delivery will resume' }; }
  return { success: true, ...(op.action === 'cancel' && data.invoice_correction_required === true ? { invoiceCorrectionRequired: true } : {}) };
}
