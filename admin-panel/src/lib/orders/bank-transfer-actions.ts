'use server';
/** Private transfer settings and operations. @see bank-transfer-admin.ts */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAdminAuth } from '@/lib/actions/admin-auth';
import { bankTransferConfigSchema } from '@/lib/orders/bank-transfer-config';
import { recordAuditEntry } from '@/lib/audit/audit-entry';
import { sendOrderNotice } from '@/lib/orders/transfer-mail';
import { operateTransfer } from '@/lib/orders/bank-transfer-admin';
import { previewLateTransfer } from '@/lib/orders/late-transfer-preview';
import { createAdminClient } from '@/lib/supabase/admin';

export async function saveBankTransferConfig(input: unknown) {
  return withAdminAuth(async ({ user }) => {
    const parsed = bankTransferConfigSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Invalid bank transfer configuration' };
    const { error } = await createAdminClient().rpc('save_bank_transfer_config', { p_config: parsed.data, p_actor: user.id });
    if (error) return { success: false, error: 'Could not save bank transfer configuration' };
    revalidatePath('/dashboard');
    return { success: true };
  }, { mutating: true });
}
export async function getBankTransferConfig() {
  return withAdminAuth(async () => {
    const { data, error } = await createAdminClient().from('bank_transfer_config').select('*').single();
    return error ? { success: false, error: 'Settings unavailable' } : { success: true, data };
  });
}
export async function updateBankTransfer(id: string, input: unknown) {
  return withAdminAuth(async ({ user }) => {
    const result = await operateTransfer(createAdminClient(), user.id, id, input);
    if (result.success) revalidatePath('/dashboard');
    return result;
  }, { mutating: true });
}
/** Read-only facts the administrator weighs before accepting a transfer that arrived after cancellation. */
export async function getLateTransferPreview(id: string) {
  return withAdminAuth(async () => {
    if (!z.uuid().safeParse(id).success) return { success: false, error: 'Invalid order' };
    const data = await previewLateTransfer(createAdminClient(), id, new Date());
    return data ? { success: true, data } : { success: false, error: 'Preview unavailable' };
  });
}
export async function getOverdueTransferCount() {
  return withAdminAuth(async () => {
    const { count, error } = await createAdminClient().from('payment_transactions').select('id', { count: 'exact', head: true })
      .eq('payment_provider', 'bank_transfer').eq('status', 'awaiting_payment').lt('payment_due_at', new Date().toISOString());
    return error ? { success: false, error: 'Orders unavailable' } : { success: true, data: count ?? 0 };
  });
}

export async function retryOrderNotice(id: string, notice: unknown) {
  return withAdminAuth(async ({ user }) => {
    const parsed = z.enum(['placed', 'reminder', 'cancelled', 'paid']).safeParse(notice);
    if (!z.uuid().safeParse(id).success || !parsed.success) return { success: false, error: 'Invalid notice' };
    const db = createAdminClient();
    const audit = await recordAuditEntry(db, { table_name: 'payment_transactions', operation: 'UPDATE', performed_by: user.id, new_values: { action: 'retry_order_notice_requested', order_id: id, notice: parsed.data } });
    if (!audit.ok) return { success: false, error: 'Could not record retry' };
    const result = await sendOrderNotice(db, id, parsed.data, true);
    const outcome = await recordAuditEntry(db, { table_name: 'payment_transactions', operation: 'UPDATE', performed_by: user.id, new_values: { action: 'retry_order_notice_result', order_id: id, notice: parsed.data, outcome: result.outcome, sent: result.sent } });
    revalidatePath('/dashboard');
    return result.sent && outcome.ok ? { success: true } : { success: false, error: 'Notice delivery not confirmed' };
  }, { mutating: true });
}
