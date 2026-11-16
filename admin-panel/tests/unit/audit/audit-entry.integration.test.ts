/**
 * DB TEST: audit entries against the real audit_log. performed_by references auth.users, so
 * an e-mail never lands there; the writer reports that instead of the caller silently going on.
 * (Entries are never taken back: database changes audit inside their RPC, see
 * audit-sigkill.integration.test.ts.)
 *
 * REQUIRES: the local Supabase stack (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
 * @see src/lib/audit/audit-entry.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import { recordAuditEntry, type AuditClient } from '@/lib/audit/audit-entry';

const admin = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
const client = admin as unknown as AuditClient;

describe('audit entries in audit_log', () => {
  const email = `audit-entry-${Date.now()}@example.com`;
  let adminUserId = '';

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
    if (error || !data.user) throw error ?? new Error('user missing');
    adminUserId = data.user.id;
  });
  afterAll(async () => {
    await admin.from('audit_log').delete().eq('performed_by', adminUserId);
    await admin.auth.admin.deleteUser(adminUserId);
  });

  it('saves an entry naming the admin by auth user UUID and returns its id', async () => {
    const saved = await recordAuditEntry(client, { table_name: 'system', operation: 'UPDATE', performed_by: adminUserId, user_id: adminUserId, new_values: { action: 'audit_entry_probe' } });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const row = await admin.from('audit_log').select('performed_by, new_values').eq('id', saved.id).single();
    expect(row.data).toEqual({ performed_by: adminUserId, new_values: { action: 'audit_entry_probe' } });
  });

  it('reports a refused entry: an e-mail in performed_by (the old upgrade audit) is not saved', async () => {
    const saved = await recordAuditEntry(client, { table_name: 'system', operation: 'UPDATE', performed_by: email });
    expect(saved.ok).toBe(false);
    const rows = await admin.from('audit_log').select('id').eq('user_id', adminUserId).eq('new_values->>action', 'audit_entry_email');
    expect(rows.data).toEqual([]);
  });

  it('reports a refused entry: an operation outside INSERT/UPDATE/DELETE is not saved', async () => {
    const saved = await recordAuditEntry(client, { table_name: 'system', operation: 'system_upgrade_triggered' as 'UPDATE', performed_by: adminUserId });
    expect(saved.ok).toBe(false);
  });
});
