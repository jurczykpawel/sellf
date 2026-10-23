/** Shared admin operation for session and API-key callers. @see bank-transfer-service.ts */
import { z } from 'zod';
import { dispatchTransferEvent, fulfillTransfer } from '@/lib/orders/bank-transfer-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
export const transferOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mark-paid'), amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), paidAt: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(1).max(1000) }).strict(),
]);
export async function operateTransfer(db: SupabaseClient<Database>, actor: string, id: string, input: unknown) {
  const parsed = transferOperationSchema.safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success) return { success: false, error: 'Invalid transfer operation' };
  const op = parsed.data;
  const { data, error } = await db.rpc('admin_bank_transfer_order', { p_id: id, p_actor: actor, p_action: op.action,
    p_amount: op.action === 'mark-paid' ? op.amount : undefined, p_paid_at: op.action === 'mark-paid' ? op.paidAt : undefined,
    p_reason: op.action === 'cancel' ? op.reason : undefined });
  if (error || !data || typeof data !== 'object' || Array.isArray(data) || data.success !== true) return {
    success: false, error: 'The order must be awaiting payment and the booked amount must equal its full amount in minor units',
  };
  try {
    if (op.action === 'mark-paid') await fulfillTransfer(db, id);
    else await dispatchTransferEvent(db, id, 'order.cancelled');
  } catch { return { success: true, warning: 'Order saved; background delivery will resume' }; }
  return { success: true };
}
