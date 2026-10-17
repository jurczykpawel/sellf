/** Fresh-install program reads against a disposable stack. @see tests/affiliates/database.ts */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, expect, it, vi } from 'vitest';
import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';
import { getAffiliateTestConfig, resetAffiliateDatabase } from '@/../tests/affiliates/database';
const context = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ dataClient: context.client }) }));
import { getPayoutChoices } from '@/lib/affiliates/payouts/reads';
const env = getAffiliateTestConfig();
context.client = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
beforeAll(() => {
  resetAffiliateDatabase();
  execFileSync('docker', ['exec', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'TRUNCATE public.affiliate_programs, public.affiliate_memberships CASCADE'], { stdio: 'pipe' });
});
it('loads partner and payout choices without creating a program on a fresh installation', async () => {
  expect(await getPayoutChoices({})).toEqual({ success: true, data: { programConfigured: false, members: [], currencies: ['PLN'], payouts: [], commissions: [] } });
  const db = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  expect(await db.from('affiliate_programs').select('id')).toMatchObject({ data: [], error: null });
});
