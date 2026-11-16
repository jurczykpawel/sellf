/**
 * Admin grant/revoke of product access writes its audit entry first (W256c): a refused entry changes
 * nothing, and an entry for a change that then failed is taken back. Before, the result of the insert
 * was dropped (`.then(() => {}, …)` never sees a database error), so access changed without a trace.
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
  mutateAccess: (...args: unknown[]) => {
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
  it('writes the entry (admin auth user UUID) before granting', async () => {
    expect((await grant()).status).toBe(201);
    expect(m.steps).toEqual(['audit', 'mutate:grant']);
    expect(m.auditInsert).toHaveBeenCalledWith(expect.objectContaining({ performed_by: ADMIN_ID, user_id: USER_ID, operation: 'INSERT' }));
  });

  it('grants nothing when the audit entry is refused', async () => {
    m.auditResult.mockResolvedValueOnce({ data: null, error: { message: 'audit down' } });
    expect((await grant()).status).toBe(500);
    expect(m.mutateAccess).not.toHaveBeenCalled();
  });

  it('takes the entry back when the grant itself fails', async () => {
    m.mutateAccess.mockReturnValueOnce({ data: null, error: { message: 'grant failed' } });
    expect((await grant()).status).toBe(500);
    expect(m.steps).toEqual(['audit', 'mutate:grant', 'discard']);
    expect(m.auditDelete).toHaveBeenCalledWith('id', 'audit-1');
  });
});

describe('admin access revoke audit', () => {
  beforeEach(() => { m.existing = { id: 'access-1' }; m.mutateAccess.mockReturnValue({ error: null }); });

  it('writes the entry before revoking', async () => {
    expect((await revoke()).status).toBe(200);
    expect(m.steps).toEqual(['audit', 'mutate:revoke']);
    expect(m.auditInsert).toHaveBeenCalledWith(expect.objectContaining({ performed_by: ADMIN_ID, user_id: USER_ID, operation: 'DELETE' }));
  });

  it('revokes nothing when the audit entry is refused', async () => {
    m.auditResult.mockResolvedValueOnce({ data: null, error: { message: 'audit down' } });
    expect((await revoke()).status).toBe(500);
    expect(m.mutateAccess).not.toHaveBeenCalled();
  });

  it('takes the entry back when the revoke itself fails', async () => {
    m.mutateAccess.mockReturnValueOnce({ error: { message: 'revoke failed' } });
    expect((await revoke()).status).toBe(500);
    expect(m.steps).toEqual(['audit', 'mutate:revoke', 'discard']);
  });
});
