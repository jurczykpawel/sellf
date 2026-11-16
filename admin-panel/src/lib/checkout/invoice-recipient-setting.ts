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
import type { Json } from '@/types/database';

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

type SaveResult = { ok: true } | { ok: false; error: string };

async function writeCustomSettings(client: SettingsClient, rowId: string | undefined, custom_settings: Record<string, unknown>): Promise<SaveResult> {
  const updated_at = new Date().toISOString();
  const values = { custom_settings: custom_settings as Json, updated_at };
  const { error } = rowId
    ? await client.from('shop_config').update(values).eq('id', rowId)
    : await client.from('shop_config').insert(values);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface SettingAudit {
  /** Where audit_log lives (the platform client for API keys, the panel's data client otherwise). */
  auditClient: SettingsClient;
  /** UUID of the admin's auth user (audit_log.performed_by references auth.users). */
  performedBy: string;
  /** Extra context stored with the new value, e.g. how the admin authenticated. */
  details?: Record<string, Json>;
}

/**
 * Change the flag, keeping every other custom setting, with an audit entry (panel and API v1).
 * No change stays without a trace: when
 * the audit entry is not written the previous settings are put back and the caller gets an error.
 */
export async function changeInvoiceRecipientEnabled(client: SettingsClient, enabled: boolean, audit: SettingAudit): Promise<SaveResult> {
  const { data: row, error: readError } = await client.from('shop_config').select('id, custom_settings').maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const previous = asObject(row?.custom_settings);
  const saved = await writeCustomSettings(client, row?.id, { ...previous, [INVOICE_RECIPIENT_SETTING]: enabled });
  if (!saved.ok) return saved;

  const { error: auditError } = await audit.auditClient.from('audit_log').insert({
    user_id: audit.performedBy,
    performed_by: audit.performedBy,
    table_name: 'shop_config',
    operation: 'UPDATE',
    old_values: { [INVOICE_RECIPIENT_SETTING]: previous[INVOICE_RECIPIENT_SETTING] === true },
    new_values: { [INVOICE_RECIPIENT_SETTING]: enabled, ...audit.details },
  });
  if (!auditError) return { ok: true };

  // On a fresh install the row was just created, so look its id up again before restoring.
  const rowId = row?.id ?? (await client.from('shop_config').select('id, custom_settings').maybeSingle()).data?.id;
  const restored = await writeCustomSettings(client, rowId, previous);
  if (!restored.ok) console.error('[changeInvoiceRecipientEnabled] Could not restore the previous setting:', restored.error);
  return { ok: false, error: `audit_log: ${auditError.message}` };
}
