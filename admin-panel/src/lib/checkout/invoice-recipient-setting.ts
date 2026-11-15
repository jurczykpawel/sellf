/**
 * Shop setting "collect a different invoice recipient" (owner 10.11): OFF by default, switched on
 * by the seller (mostly public institutions: the municipality buys, the school receives). Lives in
 * shop_config.custom_settings, which anon cannot read; the checkout reads it with the service role.
 *
 * @see src/lib/actions/invoice-recipient-config.ts (panel)
 * @see src/app/api/v1/settings/checkout/route.ts (API v1)
 * @see src/app/api/update-payment-metadata/route.ts (server-side enforcement)
 */

import type { createAdminClient } from '@/lib/supabase/admin';

export const INVOICE_RECIPIENT_SETTING = 'invoice_recipient_enabled';

/** Any client that can read/write the caller's own shop_config row (service role or schema-scoped). */
export type SettingsClient = Pick<ReturnType<typeof createAdminClient>, 'from'>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** True only for an explicit boolean true; a read error never blocks the checkout. */
export async function readInvoiceRecipientEnabled(client: SettingsClient): Promise<boolean> {
  try {
    const { data, error } = await client.from('shop_config').select('custom_settings').maybeSingle();
    if (error) {
      console.error('[readInvoiceRecipientEnabled] Error:', error.message);
      return false;
    }
    return asObject(data?.custom_settings)[INVOICE_RECIPIENT_SETTING] === true;
  } catch (error) {
    console.error('[readInvoiceRecipientEnabled] Error:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/** Store the flag, keeping every other custom setting. */
export async function saveInvoiceRecipientEnabled(client: SettingsClient, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row, error: readError } = await client.from('shop_config').select('id, custom_settings').maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const custom_settings = { ...asObject(row?.custom_settings), [INVOICE_RECIPIENT_SETTING]: enabled };
  const updated_at = new Date().toISOString();
  const { error } = row?.id
    ? await client.from('shop_config').update({ custom_settings, updated_at }).eq('id', row.id)
    : await client.from('shop_config').insert({ custom_settings, updated_at });
  return error ? { ok: false, error: error.message } : { ok: true };
}
