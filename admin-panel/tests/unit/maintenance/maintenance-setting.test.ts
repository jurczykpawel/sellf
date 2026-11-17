/**
 * Maintenance mode for the admin: panel action and API v1 switch the database source with one
 * audited RPC (the admin named by auth user UUID), and the status says which source is in effect
 * and where the server file is. The transaction itself is proven in maintenance-mode.integration.test.ts.
 *
 * @see src/lib/maintenance/setting.ts
 * @see src/app/api/v1/system/maintenance/route.ts
 * @see src/lib/actions/maintenance.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_USER_ID = '6f1c1c3e-9b7a-4d55-8a5e-2a8b9c0d1e2f';
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), row: null as Record<string, unknown> | null, authenticate: vi.fn() }));
const client = () => ({ rpc: h.rpc, from: h.from });

vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: () => client(), createAdminClient: () => client() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), authenticate: h.authenticate }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ dataClient: client(), user: { id: ADMIN_USER_ID, email: 'admin@example.invalid' } }),
}));

import { GET, PATCH } from '@/app/api/v1/system/maintenance/route';
import { setMaintenanceMode } from '@/lib/actions/maintenance';

const request = (method: 'GET' | 'PATCH', body?: unknown) => new NextRequest('http://localhost/api/v1/system/maintenance', {
  method, headers: { 'content-type': 'application/json', authorization: 'Bearer sf_test' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const future = () => new Date(Date.now() + 3_600_000).toISOString();
let dir = '';

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(path.join(tmpdir(), 'sellf-maintenance-setting-'));
  vi.stubEnv('SELLF_MAINTENANCE_FILE', path.join(dir, 'MAINTENANCE'));
  vi.stubEnv('SELLF_MAINTENANCE', '');
  h.row = { enabled: false, message: null, expected_end_at: null, changed_at: '2026-11-17T09:00:00Z' };
  h.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
    h.row = { enabled: args.p_enabled, message: args.p_message, expected_end_at: args.p_expected_end_at, changed_at: '2026-11-17T10:00:00Z' };
    return { data: {}, error: null };
  });
  h.from.mockImplementation(() => ({ select: () => ({ maybeSingle: async () => ({ data: h.row, error: null }) }) }));
  h.authenticate.mockResolvedValue({ method: 'api_key', supabase: client(), admin: { userId: ADMIN_USER_ID, adminId: 'adm-1', email: null }, scopes: ['system:read', 'system:write'] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const refused = { data: null, error: { code: '23503', message: 'insert or update on table "audit_log" violates foreign key constraint' } };

describe('maintenance mode — admin switch', () => {
  it('API v1 PATCH switches it on with one audited RPC naming the key owner by UUID @J652', async () => {
    const end = future();
    const res = await PATCH(request('PATCH', { enabled: true, message: ' Inventory day ', expected_end_at: end }));
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('set_maintenance_mode', { p_enabled: true, p_message: 'Inventory day', p_expected_end_at: end, p_performed_by: ADMIN_USER_ID, p_details: { auth: 'api_key' } });
    expect((await res.json()).data).toMatchObject({ active: true, source: 'database', message: 'Inventory day', expected_end_at: end, database: { enabled: true } });
  });

  it('turning it off clears the message and the expected end', async () => {
    await PATCH(request('PATCH', { enabled: false, message: 'left over', expected_end_at: future() }));
    expect(h.rpc).toHaveBeenCalledWith('set_maintenance_mode', expect.objectContaining({ p_enabled: false, p_message: null, p_expected_end_at: null }));
  });

  it.each([
    [{}, 'no enabled'],
    [{ enabled: 'yes' }, 'not a boolean'],
    [{ enabled: true, message: 'x'.repeat(501) }, 'message too long'],
    [{ enabled: true, expected_end_at: 'tomorrow' }, 'not ISO 8601'],
    [{ enabled: true, extra: 1 }, 'unknown field'],
  ])('PATCH %j is refused (%s) without touching the database', async body => {
    const res = await PATCH(request('PATCH', body));
    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('an expected end in the past is refused without touching the database', async () => {
    const res = await PATCH(request('PATCH', { enabled: true, expected_end_at: '2020-01-01T00:00:00Z' }));
    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('a refused audit entry answers 500', async () => {
    h.rpc.mockResolvedValue(refused);
    expect((await PATCH(request('PATCH', { enabled: true }))).status).toBe(500);
  });

  it('the panel action names the signed-in admin', async () => {
    const result = await setMaintenanceMode({ enabled: true, message: null });
    expect(result.success).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith('set_maintenance_mode', expect.objectContaining({ p_enabled: true, p_performed_by: ADMIN_USER_ID, p_details: { auth: 'session' } }));
  });

  it('GET says the server file is in effect, why it is there and where to delete it, even with the database switch off', async () => {
    writeFileSync(path.join(dir, 'MAINTENANCE'), JSON.stringify({ reason: 'migration_state_unknown', message: 'Update stopped' }));
    const res = await GET(request('GET'));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      active: true, source: 'file', message: 'Update stopped', expected_end_at: null,
      database: { enabled: false, message: null, expected_end_at: null, changed_at: '2026-11-17T09:00:00Z' },
      server: { file_path: path.join(dir, 'MAINTENANCE'), file_present: true, file_reason: 'migration_state_unknown', env: false },
    });
  });

  it('GET with nothing on is inactive', async () => {
    expect((await (await GET(request('GET'))).json()).data).toMatchObject({ active: false, source: null, message: null });
  });

  it('PATCH and GET require system:write / system:read', async () => {
    await PATCH(request('PATCH', { enabled: true }));
    expect(h.authenticate).toHaveBeenLastCalledWith(expect.anything(), ['system:write']);
    await GET(request('GET'));
    expect(h.authenticate).toHaveBeenLastCalledWith(expect.anything(), ['system:read']);
  });
});
