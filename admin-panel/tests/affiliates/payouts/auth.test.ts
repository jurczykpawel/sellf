import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), user: vi.fn(), membership: vi.fn(), order: [] as string[] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.session }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { reservePayout } from '@/lib/affiliates/payouts/actions';
import { getPayoutChoices } from '@/lib/affiliates/payouts/reads';
import { downloadPayoutCsv } from '@/lib/affiliates/payouts/download';
beforeEach(() => {
  vi.clearAllMocks(); mocks.order.length = 0;
  mocks.session.mockResolvedValue({ auth: { getUser: mocks.user }, from: () => ({ select: () => ({ eq: () => ({ single: mocks.membership }) }) }) });
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  mocks.membership.mockImplementation(async () => { mocks.order.push('authorized'); return { data: { user_id: 'admin' } }; });
  mocks.admin.mockImplementation(() => { mocks.order.push('privileged'); return {}; });
});
it('requires a session for commands, pickers and downloads', async () => {
  expect((await reservePayout({})).errorCode).toBe('UNAUTHORIZED');
  expect((await getPayoutChoices({})).errorCode).toBe('UNAUTHORIZED');
  expect((await downloadPayoutCsv({})).status).toBe(401);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('requires admin membership before creating a data client', async () => {
  mocks.user.mockResolvedValue({ data: { user: { id: 'member' } } });
  mocks.membership.mockResolvedValue({ data: null });
  expect((await reservePayout({})).errorCode).toBe('FORBIDDEN');
  expect((await downloadPayoutCsv({})).status).toBe(403);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('creates the data client only after admin authorization', async () => {
  mocks.user.mockResolvedValue({ data: { user: { id: 'admin' } } });
  expect((await reservePayout({})).errorCode).toBe('422');
  expect(mocks.order).toEqual(['authorized', 'privileged']);
});
