'use server';
/** Private transfer settings and operations. @see bank-transfer-admin.ts */
import { revalidatePath } from 'next/cache';
import { withAdminAuth } from '@/lib/actions/admin-auth';
import { bankTransferConfigSchema } from '@/lib/orders/bank-transfer-config';
import { operateTransfer } from '@/lib/orders/bank-transfer-admin';
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
export async function getOverdueTransferCount() {
  return withAdminAuth(async () => {
    const { count, error } = await createAdminClient().from('payment_transactions').select('id', { count: 'exact', head: true })
      .eq('payment_provider', 'bank_transfer').eq('status', 'awaiting_payment').lt('payment_due_at', new Date().toISOString());
    return error ? { success: false, error: 'Orders unavailable' } : { success: true, data: count ?? 0 };
  });
}
