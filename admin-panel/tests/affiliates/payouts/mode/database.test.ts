/** Mode-specific instance payout lifecycle. */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';
import { getAffiliateTestConfig, resetAffiliateDatabase } from '@/../tests/affiliates/database';
const context = vi.hoisted(() => ({ client: undefined as unknown, live: true }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ user: { id: 'dddddddd-0000-4000-a000-000000000000' }, dataClient: context.client }) }));
vi.mock('@/lib/stripe/affiliate-mode', () => ({ getAffiliateLivemode: async () => context.live }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { previewPayout } from '@/lib/affiliates/payouts/reads';
import { reservePayout, cancelPayout } from '@/lib/affiliates/payouts/actions';
import { downloadPayoutCsv } from '@/lib/affiliates/payouts/download';
const env = getAffiliateTestConfig();
context.client = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const member = 'af000000-0000-4000-a000-000000000001';
function sql(query: string): string { return execFileSync('docker', ['exec', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim(); }
beforeAll(() => {
  resetAffiliateDatabase();
  sql(`DO $$ DECLARE original public.affiliate_commissions; sample public.affiliate_commissions; BEGIN
    SELECT * INTO original FROM public.affiliate_commissions WHERE payment_id='af000000-0000-4000-a000-000000000010';
    sample := original; sample.id := gen_random_uuid(); sample.livemode := false; sample.accrued_minor := 1234;
    INSERT INTO public.affiliate_commissions SELECT (sample).*;
    INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key) VALUES(sample.member_id,sample.id,'accrual',1234,'PLN','mode:'||sample.id);
  END $$`);
}, 125000);
afterAll(() => resetAffiliateDatabase(), 125000);
it.each([false, true])('uses only current-mode commissions for preview, reservation and CSV on a %s instance', async live => {
  context.live = live;
  const cutoff = new Date(sql('SELECT clock_timestamp()')).toISOString();
  const result = await previewPayout({ member_id: member, currency: 'PLN', cutoff });
  const expected = live ? '2000' : '1234';
  expect(result.data).toMatchObject({ payable_minor: expected, available: true, held_minor: live ? '2000' : '0' });
  const reservation = await reservePayout({ member_id: member, currency: 'PLN', cutoff, member_version: '1', program_version: '1', payee_reference: 'Mode sample' });
  expect(reservation.success).toBe(true);
  const payout = reservation.data!;
  expect(payout).toMatchObject({ earnings_minor: expected, livemode: live });
  const request = { payout_id: payout.id, version: payout.version };
  const response = await downloadPayoutCsv(request);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(`${expected},0,${expected},Mode sample`);
  context.live = !live;
  expect((await downloadPayoutCsv(request)).status).toBe(409);
  context.live = live;
  expect((await cancelPayout({ ...request, no_transfer: true, reason: 'Sample complete' })).success).toBe(true);
});
