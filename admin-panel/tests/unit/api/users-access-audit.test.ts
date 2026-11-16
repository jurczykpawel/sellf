/**
 * Admin grant/revoke of product access and its audit entry are ONE call (W256d): mutate_access_audited
 * writes both in a transaction, so the route itself never writes or deletes audit_log rows. W256c wrote
 * the entry first and deleted it on error, which left a false entry when the process died in between
 * (W256cr P2). The database side is covered by tests/unit/audit/*.integration.test.ts.
 * @see src/app/api/users/[id]/access/route.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { ADMIN_ID, USER_ID, PRODUCT_ID } = vi.hoisted(() => ({
  ADMIN_ID: '11111111-1111-4111-8111-111111111111',
  USER_ID: '22222222-2222-4222-8222-222222222222',
  PRODUCT_ID: '33333333-3333-4333-8333-333333333333',
}));

const m = vi.hoisted(() => ({
  steps: [] as string[],
  auditResult: vi.fn(),
  auditInsert: vi.fn(),
  auditDelete: vi.fn(),
  mutateAccess: vi.fn(),
  existing: null as { id: string; license_requested?: boolean } | null,
}));

function tableClient() {
  return {
    from(table: string) {
      if (table === 'audit_log') {
        return {
          insert: (row: unknown) => { m.steps.push('audit'); m.auditInsert(row); return { select: () => ({ single: m.auditResult }) }; },
          delete: () => ({ eq: (column: string, value: string) => { m.steps.push('discard'); m.auditDelete(column, value); return Promise.resolve({ error: null }); } }),
        };
      }
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () => table === 'products'
        ? { data: { id: PRODUCT_ID, name: 'Course', is_active: true, issue_license_on_purchase: false }, error: null }
        : m.existing ? { data: m.existing, error: null } : { data: null, error: { code: 'PGRST116' } };
      return chain;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => tableClient(), createPlatformClient: () => tableClient() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: vi.fn().mockResolvedValue({ user: { id: ADMIN_ID, email: 'admin@example.com' } }) }));
vi.mock('@/lib/services/business-events', () => ({
  mutateAccessAudited: (...args: unknown[]) => {
    m.steps.push(`mutate:${args[1]}`);
    const result = m.mutateAccess(...args);
    return Object.assign(Promise.resolve(result), { single: async () => result });
  },
}));

import { POST, DELETE } from '@/app/api/users/[id]/access/route';

const params = { params: Promise.resolve({ id: USER_ID }) };
const grant = () => POST(new NextRequest(`http://localhost/api/users/${USER_ID}/access`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product_id: PRODUCT_ID }),
}), params);
const revoke = () => DELETE(new NextRequest(`http://localhost/api/users/${USER_ID}/access?product_id=${PRODUCT_ID}`, { method: 'DELETE' }), params);

beforeEach(() => {
  vi.clearAllMocks();
  m.steps = [];
  m.existing = null;
  m.auditResult.mockResolvedValue({ data: { id: 'audit-1' }, error: null });
  m.mutateAccess.mockReturnValue({ data: { id: 'access-1' }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('admin access grant audit', () => {
  it('grants and audits in one call, naming the admin by auth user UUID', async () => {
    expect((await grant()).status).toBe(201);
    expect(m.steps).toEqual(['mutate:grant']);
    expect(m.mutateAccess).toHaveBeenCalledWith(expect.anything(), 'grant', USER_ID, ADMIN_ID,
      { product_id: PRODUCT_ID, product_name: 'Course', action: 'admin_grant_access' }, expect.anything(), undefined, PRODUCT_ID);
    expect(m.auditInsert).not.toHaveBeenCalled();
  });

  it('reports 500 and deletes nothing when the call fails (refused entry = nothing granted, in the database)', async () => {
    m.mutateAccess.mockReturnValueOnce({ data: null, error: { message: 'audit_log_performed_by_fkey' } });
    expect((await grant()).status).toBe(500);
    expect(m.auditInsert).not.toHaveBeenCalled();
    expect(m.auditDelete).not.toHaveBeenCalled();
  });
});

describe('admin access revoke audit', () => {
  beforeEach(() => { m.existing = { id: 'access-1' }; m.mutateAccess.mockReturnValue({ error: null }); });

  it('revokes and audits in one call', async () => {
    expect((await revoke()).status).toBe(200);
    expect(m.steps).toEqual(['mutate:revoke']);
    expect(m.mutateAccess).toHaveBeenCalledWith(expect.anything(), 'revoke', USER_ID, ADMIN_ID,
      { product_id: PRODUCT_ID, action: 'admin_revoke_access' }, { revoke_license: true }, 'access-1');
    expect(m.auditInsert).not.toHaveBeenCalled();
  });

  it('reports 500 and deletes nothing when the call fails', async () => {
    m.mutateAccess.mockReturnValueOnce({ error: { message: 'revoke failed' } });
    expect((await revoke()).status).toBe(500);
    expect(m.auditDelete).not.toHaveBeenCalled();
  });
});
