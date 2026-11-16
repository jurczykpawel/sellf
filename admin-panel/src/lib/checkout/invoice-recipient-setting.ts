/**
 * Shop setting "collect a different invoice recipient": OFF by default, switched on
 * by the seller (mostly public institutions: the municipality buys, the school receives). Lives in
 * shop_config.custom_settings, which anon cannot read; the checkout reads it with the service role.
 *
 * @see src/lib/actions/invoice-recipient-config.ts (panel)
 * @see src/app/api/v1/settings/checkout/route.ts (API v1)
 * @see src/app/api/update-payment-metadata/route.ts (server-side enforcement)
 * @see supabase/migrations/20261116110000_invoice_recipient_setting_atomic.sql (atomic change + audit)
 */

import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/types/database';

export const INVOICE_RECIPIENT_SETTING = 'invoice_recipient_enabled';

/** Service-role client (set_invoice_recipient_enabled is service_role only). */
/** Checkout settings as read and written by /api/v1/settings/checkout (PATCH body, GET data). */
export const checkoutSettingsSchema = z.object({
  invoice_recipient_enabled: z.boolean().describe('Collect a separate invoice recipient (institutions, always with a NIP). Off by default.'),
}).strict();

export type SettingsClient = Pick<ReturnType<typeof createAdminClient>, 'from' | 'rpc'>;

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

export interface SettingAudit {
  /** UUID of the admin's auth user (audit_log.performed_by references auth.users). */
  performedBy: string;
  /** Extra context stored with the new value, e.g. how the admin authenticated. */
  details?: Record<string, Json>;
}

/**
 * Change the flag with an audit entry (panel and API v1) in ONE database transaction
 * (set_invoice_recipient_enabled): the shop row is locked, only this key of custom_settings changes,
 * and when the audit entry is refused nothing is saved and the caller gets an error. A failing call
 * can never undo a parallel, successful one.
 */
export async function changeInvoiceRecipientEnabled(client: SettingsClient, enabled: boolean, audit: SettingAudit): Promise<SaveResult> {
  try {
    const { error } = await client.rpc('set_invoice_recipient_enabled', {
      p_enabled: enabled,
      p_performed_by: audit.performedBy,
      p_details: audit.details ?? {},
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
