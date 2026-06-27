import { createAdminClient } from '@/lib/supabase/admin';

/** Reads the seeded singleton instance id (created by the migration seed); throws if missing. */
export async function readInstanceId(): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('telemetry_state').select('instance_id').eq('id', 'singleton').single();
  if (error || !data) throw new Error('telemetry_state singleton missing');
  return data.instance_id;
}

/**
 * Atomic claim via a raw SQL UPDATE ... RETURNING (sole send gate). Wins only if the
 * 20h window elapsed AND the retry lease is free. Reuses report_id across attempts.
 * Returns null when not due / lease held (no row updated).
 */
export async function claimSend(windowMs: number, leaseMs: number):
  Promise<{ instanceId: string; reportId: string } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('telemetry_claim_send', {
    p_window_ms: windowMs, p_lease_ms: leaseMs,
  });
  if (error) throw error;
  const row = (data as Array<{ instance_id: string; report_id: string }> | null)?.[0];
  return row ? { instanceId: row.instance_id, reportId: row.report_id } : null;
}

export async function confirmSend(): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc('telemetry_confirm_send');
  if (error) throw error;
}
