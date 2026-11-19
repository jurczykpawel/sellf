'use server';
/** Admin invoice settings and order actions. @see ../invoicing/service.ts */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { configuredProvider, invoiceTokenUpdate, readInvoiceConfig, redactInvoiceConfig, settingsSchema } from '@/lib/invoicing/config';
import { issueInvoiceForTransaction } from '@/lib/invoicing/service';
import { recordAuditEntry } from '@/lib/audit/audit-entry';

export async function getInvoiceSettings() {
  return withAdminClient(async ({ dataClient }) => {
    const config = await readInvoiceConfig(dataClient);
    return config ? { success: true, data: redactInvoiceConfig(config) } : { success: false, error: 'Invoice settings unavailable' };
  });
}
export async function saveInvoiceSettings(input: unknown) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid invoice settings', fieldErrors: Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), 'invalidField'])) }; 
  return withAdminClient(async ({ dataClient, user }) => {
    const { token, ...settings } = parsed.data;
    const previous = await readInvoiceConfig(dataClient);
    if (settings.provider !== 'none' && !token && !previous?.token) return { success: false, error: 'API token required', fieldErrors: { token: 'tokenRequired' } };
    if (previous?.domain && previous.domain !== settings.domain && !token) return { success: false, error: 'API token required for new account', fieldErrors: { token: 'tokenRequired' } };
    // Settings and their audit entry commit together (save_invoicing_config): a refused entry saves
    // nothing, and no entry exists for settings that were not saved.
    const { error } = await dataClient.rpc('save_invoicing_config', {
      p_settings: settings, p_token: (await invoiceTokenUpdate(token)).token ?? null, p_performed_by: user.id,
    });
    if (error) return { success: false, error: 'Invoice settings not saved' };
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
      const { data, error } = await dataClient.rpc('record_invoice_correction', { p_transaction: transactionId, p_actor: user.id });
      if (error || !data) return { success: false, error: 'Invoice not updated' };
    } else {
      // Issuing happens at the invoice provider, outside the database, so no transaction can cover it.
      // The entry records the admin's REQUEST before anything is sent (a refused entry issues
      // nothing); it is not proof that an invoice exists — the invoices row is. A failure adds an
      // outcome entry instead of deleting the request.
      const audit = await recordAuditEntry(dataClient, { table_name: 'invoices', operation: 'UPDATE', performed_by: user.id, new_values: { transaction_id: transactionId, action: 'issue_requested' } });
      if (!audit.ok) return { success: false, error: 'Invoice not updated' };
      const result = await issueInvoiceForTransaction(transactionId, { client: dataClient, manual: true });
      if (!result?.success) {
        const outcome = await recordAuditEntry(dataClient, { table_name: 'invoices', operation: 'UPDATE', performed_by: user.id, new_values: { transaction_id: transactionId, action: 'issue_failed', request_audit_id: audit.id } });
        if (!outcome.ok) console.error('[mutateInvoice] Outcome entry refused:', outcome.error);
        return { success: false, error: result?.error ?? 'Invoice unavailable' };
      }
    }
    revalidatePath('/dashboard/payments');
    return { success: true };
  }, { mutating: true });
}
