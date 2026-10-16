/** Shared private payout preview. @see supabase/migrations/20261016000000_release_2026_10_6.sql */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreviewInfo } from '@/lib/affiliates/payouts/contracts';

export async function readPreview(client: SupabaseClient, member: string, currency: string, cutoff: string): Promise<PreviewInfo | null> {
  const { data, error } = await client.rpc('affiliate_preview', { p_member: member, p_currency: currency, p_cutoff: cutoff })
    .select('member_version,program_version,earnings_minor,debt_offset_minor,payable_minor,held_minor,threshold_minor,sync_required,available').maybeSingle();
  return error ? null : data as PreviewInfo | null;
}
