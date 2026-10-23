'use server';
/** Admin invoice settings and order actions. @see ../invoicing/service.ts */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { configuredProvider, invoiceTokenUpdate, readInvoiceConfig, redactInvoiceConfig, settingsSchema } from '@/lib/invoicing/config';
import { issueInvoiceForTransaction } from '@/lib/invoicing/service';

export async function getInvoiceSettings() {
  return withAdminClient(async ({ dataClient }) => {
    const config = await readInvoiceConfig(dataClient);
    return config ? { success: true, data: redactInvoiceConfig(config) } : { success: false, error: 'Invoice settings unavailable' };
  });
}
export async function saveInvoiceSettings(input: unknown) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid invoice settings' };
  return withAdminClient(async ({ dataClient, user }) => {
    const { token, ...settings } = parsed.data;
    const previous = await readInvoiceConfig(dataClient);
    if (settings.provider !== 'none' && !token && !previous?.token) return { success: false, error: 'API token required' };
    if (previous?.domain && previous.domain !== settings.domain && !token) return { success: false, error: 'API token required for new account' };
    const { error } = await dataClient.from('invoicing_config').update({ ...settings, ...await invoiceTokenUpdate(token) }).eq('id', true);
    if (error) return { success: false, error: 'Invoice settings not saved' };
    await dataClient.from('audit_log').insert({ table_name: 'invoicing_config', operation: 'UPDATE', performed_by: user.id, new_values: { provider: settings.provider } });
    revalidatePath('/dashboard/settings');
    return { success: true };
  }, { mutating: true });
}
export async function checkInvoiceConnection() {
  return withAdminClient(async ({ dataClient }) => {
    try {
      const config = await readInvoiceConfig(dataClient);
      const provider = config && await configuredProvider(config);
      if (!provider) return { success: false, error: 'Invoice provider not configured' };
      const result = await provider.findByExternalKey('sellf-connection-check');
      return result && !result.success ? { success: false, error: result.error } : { success: true };
    } catch { return { success: false, error: 'Invoice connection failed' }; }
  }, { mutating: true });
}
export async function mutateInvoice(transactionId: string, action: 'issue' | 'corrected') {
  if (!z.string().uuid().safeParse(transactionId).success || !['issue','corrected'].includes(action)) return { success: false, error: 'Invalid invoice request' };
  return withAdminClient(async ({ dataClient, user }) => {
    if (action === 'corrected') {
      const { data: tx } = await dataClient.from('payment_transactions').select('status').eq('id', transactionId).single();
      if (!tx || !['refunded','cancelled'].includes(tx.status)) return { success: false, error: 'Order does not require correction' };
      const { data, error } = await dataClient.from('invoices').update({ status: 'corrected', updated_at: new Date().toISOString() }).eq('transaction_id', transactionId).eq('status','issued').select('id');
      if (error || !data?.length) return { success: false, error: 'Invoice not updated' };
    } else {
      const result = await issueInvoiceForTransaction(transactionId, { client: dataClient, manual: true });
      if (!result?.success) return { success: false, error: result?.error ?? 'Invoice unavailable' };
    }
    await dataClient.from('audit_log').insert({ table_name: 'invoices', operation: 'UPDATE', performed_by: user.id, new_values: { transaction_id: transactionId, action } });
    revalidatePath('/dashboard/payments');
    return { success: true };
  }, { mutating: true });
}
