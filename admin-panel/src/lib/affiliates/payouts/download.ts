/** Private CSV response adapter for the A1.8 route shell. @see reads.ts */
import 'server-only';
import { withAdminClient } from '@/lib/actions/admin-auth';
import { formatPayoutCsv } from '@/lib/affiliates/csv/formatter';
import { exportSchema, payoutProjection } from '@/lib/affiliates/payouts/contracts';
import { readPreview } from '@/lib/affiliates/payouts/query';
import type { PayoutInfo } from '@/lib/affiliates/payouts/contracts';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
export async function downloadPayoutCsv(input: unknown): Promise<Response> {
  const result = await withAdminClient(async ({ user, dataClient }) => {
    const parsed = exportSchema.safeParse(input);
    if (!parsed.success) return { success: false, errorCode: '422' };
    const found = await dataClient.from('affiliate_payouts').select(payoutProjection).eq('id', parsed.data.payout_id).single();
    if (found.error) return { success: false, errorCode: '404' };
    const p = found.data as unknown as PayoutInfo;
    if (p.version !== parsed.data.version || p.status !== 'reserved' || p.needs_review) return { success: false, errorCode: '409' };
    const [preview, member, program] = await Promise.all([
      readPreview(dataClient, p.member_id, p.currency, new Date().toISOString()),
      dataClient.from('affiliate_memberships').select('code,status,user_id').eq('id', p.member_id).single(),
      dataClient.from('affiliate_programs').select('enabled,thresholds').single(),
    ]);
    if (!preview || preview.sync_required || member.error || member.data.status !== 'approved' || !member.data.user_id || program.error || !program.data.enabled || !program.data.thresholds[p.currency] || BigInt(p.earnings_minor) < BigInt(program.data.thresholds[p.currency])) return { success: false, errorCode: '409' };
    let positive = BigInt(0), negative = BigInt(0), cursor = '';
    while (true) {
      let query = dataClient.from('affiliate_payout_allocations').select('entry_id,entry:affiliate_ledger!inner(amount_minor::text)').eq('payout_id', p.id).is('released_at', null).order('entry_id').limit(100);
      if (cursor) query = query.gt('entry_id', cursor);
      const page = await query;
      if (page.error) return { success: false, errorCode: '409' };
      const rows = page.data as unknown as { entry_id: string; entry: { amount_minor: string } }[];
      for (const row of rows) { const amount = BigInt(row.entry.amount_minor); if (amount > BigInt(0)) positive += amount; else negative -= amount; }
      if (rows.length < 100) break;
      cursor = rows[rows.length - 1].entry_id;
    }
    if (positive - negative !== BigInt(p.earnings_minor)) return { success: false, errorCode: '409' };
    const audit = await dataClient.from('audit_log').insert({ table_name: 'affiliate_payouts', operation: 'UPDATE', performed_by: user.id, new_values: { payout_id: p.id, version: p.version, event: 'csv_download' } });
    if (audit.error) return { success: false, errorCode: '422' };
    const current = await dataClient.from('affiliate_payouts').select('version::text,status,needs_review').eq('id', p.id).single();
    if (current.error || current.data.version !== p.version || current.data.status !== 'reserved' || current.data.needs_review) return { success: false, errorCode: '409' };
    return { success: true, data: { payout_id: p.id, version: p.version, affiliate_code: member.data.code as string, currency: p.currency, earnings_minor: positive.toString(), debt_offset_minor: negative.toString(), payable_minor: p.earnings_minor, payee_reference: p.payee_reference } };
  }, { mutating: true });
  if (!result.success || !result.data) {
    const status = result.errorCode === 'UNAUTHORIZED' ? 401 : result.errorCode === 'FORBIDDEN' || result.errorCode === 'DEMO_MODE' ? 403 : Number(result.errorCode) || 422;
    return Response.json({ error: 'unavailable' }, { status, headers: privateHeaders });
  }
  const csv = formatPayoutCsv(result.data);
  if (!csv.success) return Response.json({ error: 'unavailable' }, { status: 422, headers: privateHeaders });
  return new Response(csv.data as Uint8Array<ArrayBuffer>, { headers: { ...privateHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sellf-affiliate-payout.csv"' } });
}
