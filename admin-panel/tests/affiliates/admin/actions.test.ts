import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), ip: vi.fn(), email: vi.fn(), captcha: vi.fn(), noStore: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.session }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: mocks.ip, checkRateLimitForIdentifier: mocks.email }));
vi.mock('@/lib/captcha/verify', () => ({ verifyCaptchaToken: mocks.captcha }));
vi.mock('next/cache', () => ({ unstable_noStore: mocks.noStore, revalidatePath: mocks.revalidate }));
import { applyToProgram, getAdminOverview, getApplicationProgram, updateMember, updateProgram, getAcceptedTerms } from '@/lib/affiliates/admin/actions';
const user = { id: 'dddddddd-0000-4000-a000-000000000000', email: 'admin@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const application = { code: 'partner-a', display_name: 'Partner A', channel: 'https://example.com', terms_version: 'v1', accepted: true, captcha_token: 'solved' };
const program = { version: '1', enabled: true, terms_version: 'v1', terms: { en: 'Terms EN', pl: 'Regulamin PL' }, thresholds: { PLN: '10000' }, hold_days: 30, buffer_days: 2 };
let db: ReturnType<typeof query>;
function query(data: unknown = []) {
  const q = { data, error: null as null | { code: string; message?: string }, select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), lt: vi.fn(), lte: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), rpc: vi.fn(), from: vi.fn(), then: undefined as unknown };
  for (const key of ['select', 'eq', 'order', 'limit', 'lt', 'lte', 'maybeSingle', 'single', 'rpc', 'from'] as const) q[key].mockImplementation(() => q);
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: q.data, error: q.error }));
  return q;
}
beforeEach(() => {
  vi.clearAllMocks(); db = query({ ...program, id: user.id }); mocks.admin.mockReturnValue(db);
  mocks.session.mockResolvedValue({ auth: { getUser: async () => ({ data: { user }, error: null }) }, from: () => query({ user_id: user.id }) });
  mocks.ip.mockResolvedValue(true); mocks.email.mockResolvedValue(true); mocks.captcha.mockResolvedValue({ success: true });
});
describe('session boundaries', () => {
  it.each([null, { ...user, email_confirmed_at: null }])('rejects anonymous/unverified application before privileged access', async identity => {
    mocks.session.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: identity } }) } });
    expect((await applyToProgram(application)).status).toBe(identity ? 403 : 401); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('checks session admin before constructing data client', async () => {
    mocks.session.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) }, from: () => query(null) });
    expect((await getAdminOverview({})).status).toBe(403); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('does not accept API key credentials instead of a session', async () => {
    mocks.session.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await updateProgram(program)).status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(['p_user', 'user_id', 'p_actor', 'actor'])('rejects spoofed %s', async key => {
    expect((await applyToProgram({ ...application, [key]: user.id })).status).toBe(422); expect(db.rpc).not.toHaveBeenCalled();
  });
  it('passes only verified identity to application RPC', async () => {
    expect((await applyToProgram(application)).success).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith('affiliate_apply', { p_user: user.id, p_code: application.code, p_display_name: application.display_name, p_channel: application.channel, p_terms_version: 'v1' });
    expect(mocks.noStore).toHaveBeenCalled();
  });
  it.each(['ip', 'email', 'captcha'] as const)('fails closed on %s gate', async gate => {
    mocks[gate].mockResolvedValue(gate === 'captcha' ? { success: false } : false);
    expect((await applyToProgram(application)).status).toBe(gate === 'captcha' ? 422 : 429); expect(db.rpc).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('binds email limiter to verified session email', async () => {
    await applyToProgram(application); expect(mocks.email).toHaveBeenCalledWith('affiliate_apply_email', 5, 1440, 'email:admin@example.com');
  });
});
describe('validation and conflicts', () => {
  it.each([{ accepted: false }, { code: 'BAD CODE' }, { display_name: '' }, { terms_version: 'v1\n' }, { channel: 'x'.repeat(501) }, { captcha_token: 'x'.repeat(40000) }])('rejects invalid application %j', async changes => {
    expect((await applyToProgram({ ...application, ...changes })).status).toBe(422); expect(db.rpc).not.toHaveBeenCalled();
  });
  it('maps stale terms/version and duplicate code to 409 without leaking database errors', async () => {
    for (const code of ['PT409', '40001', '23505']) { db.error = { code, message: 'secret buyer sentinel' }; const result = await applyToProgram(application); expect(result.status).toBe(409); expect(JSON.stringify(result)).not.toContain('sentinel'); }
  });
  it('supports initial program expected_version 0, preserves bigint versions', async () => {
    for (const version of ['0', '9007199254740993']) { await updateProgram({ ...program, version }); expect(db.rpc).toHaveBeenLastCalledWith('affiliate_program_update', expect.objectContaining({ p_actor: user.id, p_expected_version: version })); }
  });
  it.each(['approved', 'rejected', 'suspended', 'terminated'])('records %s with session actor/version/reason', async status => {
    expect((await updateMember({ member_id: user.id, version: '1', status, reason: 'Reviewed' })).success).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith('affiliate_member_update', { p_actor: user.id, p_member: user.id, p_expected_version: '1', p_status: status, p_reason: 'Reviewed' });
  });
  it.each([{ reason: '' }, { reason: 'bad\nreason' }, { status: 'pending' }, { actor: user.id }])('rejects invalid status decision', async changes => {
    expect((await updateMember({ member_id: user.id, version: '1', status: 'approved', reason: 'Reviewed', ...changes })).status).toBe(422); expect(db.rpc).not.toHaveBeenCalled();
  });
  it('returns safe failure if the atomic RPC fails, performs no direct writes', async () => {
    db.error = { code: 'P0001', message: 'audit failed private detail' }; expect(await updateProgram(program)).toMatchObject({ success: false, status: 500 }); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('rejects oversized program before RPC', async () => {
    expect((await updateProgram({ ...program, terms: { en: 'x'.repeat(32768), pl: 'x' } })).status).toBe(422);
  });
  it('bounds cursor page size and returns explicit text version projections', async () => {
    expect((await getAdminOverview({ limit: 101 })).status).toBe(422);
    db.data = [] as never; await getAdminOverview({ limit: 25 }); expect(db.limit).toHaveBeenCalledWith(25); expect(db.select.mock.calls.flat().join()).toContain('version::text'); expect(db.select.mock.calls.flat()).not.toContain('*');
  });
  it('exposes only current terms for verified applicants', async () => {
    await getApplicationProgram(); expect(db.select).toHaveBeenCalledWith('enabled,terms_version,terms');
  });
  it('reconstructs accepted terms by acceptance time, including reused terms label', async () => {
    const member = { accepted_at: '2026-10-01T00:00:00Z', accepted_terms_version: 'v1' };
    const snapshot = { ...program, terms: { en: 'Original', pl: 'Oryginał' } };
    const history = query({ new_values: snapshot }); db.from.mockImplementation((table: string) => table === 'audit_log' ? history : query(member));
    const result = await getAcceptedTerms(user.id); expect(result.data).toEqual({ terms_version: 'v1', terms: snapshot.terms }); expect(history.lte).toHaveBeenCalledWith('performed_at', member.accepted_at);
  });
});

it('requires a fresh terms label when the published wording changes', async () => {
  const published = query({ new_values: program }); db.from.mockReturnValue(published);
  expect(await updateProgram({ ...program, terms: { en: 'Changed', pl: 'Zmienione' } })).toMatchObject({ success: false, status: 409, errorCode: 'TERMS_VERSION_CONFLICT' }); expect(db.rpc).not.toHaveBeenCalled();
});
