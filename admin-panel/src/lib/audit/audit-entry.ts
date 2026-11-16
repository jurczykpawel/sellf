/**
 * audit_log writer that reports whether the entry was saved (W256c).
 *
 * performed_by / user_id reference auth.users: pass the admin's auth user UUID (for an API key, the
 * key owner's), never an e-mail. operation accepts only INSERT/UPDATE/DELETE (audit_log_operation_check);
 * the kind of action goes into new_values. Callers write the entry BEFORE the change it describes and
 * change nothing when it is refused; when the change itself then fails, discardAuditEntry takes the
 * entry back, so an entry exists exactly when the change happened.
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

/** Takes back an entry written for a change that then failed. Never throws. */
export async function discardAuditEntry(client: AuditClient, id: string): Promise<void> {
  try {
    const { error } = await client.from('audit_log').delete().eq('id', id);
    if (error) console.error('[discardAuditEntry] Error:', error.message);
  } catch (error) {
    console.error('[discardAuditEntry] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}
