'use server';
/** Panel actions for the shop setting "collect a different invoice recipient". @see ../checkout/invoice-recipient-setting.ts */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { readInvoiceRecipientEnabled, saveInvoiceRecipientEnabled } from '@/lib/checkout/invoice-recipient-setting';
import type { ActionResponse } from '@/lib/actions/admin-auth';

export async function getInvoiceRecipientSetting(): Promise<ActionResponse<{ enabled: boolean }>> {
  return withAdminClient(async ({ dataClient }) => ({ success: true, data: { enabled: await readInvoiceRecipientEnabled(dataClient) } }));
}

export async function setInvoiceRecipientSetting(input: unknown): Promise<ActionResponse<void>> {
  const parsed = z.boolean().safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid setting', errorCode: 'INVALID_INPUT' };
  return withAdminClient(async ({ dataClient, user }) => {
    const saved = await saveInvoiceRecipientEnabled(dataClient, parsed.data);
    if (!saved.ok) {
      console.error('[setInvoiceRecipientSetting] Error:', saved.error);
      return { success: false, error: 'Setting not saved', errorCode: 'DATABASE_ERROR' };
    }
    await dataClient.from('audit_log').insert({ table_name: 'shop_config', operation: 'UPDATE', performed_by: user.id, new_values: { invoice_recipient_enabled: parsed.data } });
    revalidatePath('/dashboard/settings');
    return { success: true };
  }, { mutating: true });
}
