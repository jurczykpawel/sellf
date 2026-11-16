/**
 * audit_log writer that reports whether the entry was saved.
 *
 * USE ONLY FOR A REQUEST WHOSE EFFECT IS OUTSIDE THE DATABASE (system upgrade, invoice at the provider,
 * handing out an existing key). Such an entry records the INTENT — the admin asked for it — written
 * before anything starts, so a refused entry starts nothing. It is not proof the effect happened, so
 * name the action as a request (`*_requested`) and record a failure as a separate outcome entry; never
 * delete it (a killed process could not, and a deletion would erase a real request).
 *
 * A CHANGE IN THE DATABASE must write its entry in the same transaction as the change (an RPC such as
 * save_invoicing_config, mutate_access_audited, issue_license_with_audit):
 * "entry first, change, take it back on error" leaves a false entry when the process dies in between.
 *
 * performed_by / user_id reference auth.users: pass the admin's auth user UUID (for an API key, the
 * key owner's), never an e-mail. operation accepts only INSERT/UPDATE/DELETE (audit_log_operation_check);
 * the kind of action goes into new_values.
 *
 * @see supabase/migrations/20250101000000_core_schema.sql (audit_log)
 */
import type { createPlatformClient } from '@/lib/supabase/admin';
import type { Json } from '@/types/database';

/** Service-role client that reaches public.audit_log (the platform client, or the admin data client). */
export type AuditClient = Pick<ReturnType<typeof createPlatformClient>, 'from'>;

export interface AuditEntry {
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Auth user UUID of the admin who made the change. */
  performed_by: string;
  user_id?: string | null;
  old_values?: Json;
  new_values?: Json;
}

export type AuditEntryResult = { ok: true; id: string } | { ok: false; error: string };

export async function recordAuditEntry(client: AuditClient, entry: AuditEntry): Promise<AuditEntryResult> {
  try {
    const { data, error } = await client.from('audit_log').insert(entry).select('id').single();
    if (error || !data) return { ok: false, error: error?.message ?? 'audit entry not returned' };
    return { ok: true, id: data.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
