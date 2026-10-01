import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }),
  })),
}));

vi.mock('@/lib/auth-server', () => ({
  requireAdminApi: vi.fn(async () => ({ user: { id: 'user-1' }, role: 'platform_admin' })),
}));

const OLD_KEY_ID = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';
const ADMIN_ID = 'admin-row-1';

let updateResult: { error: unknown } = { error: null };

vi.mock('@/lib/supabase/admin', () => ({
  createPlatformClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'admin_users') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: ADMIN_ID }, error: null }) }) }) };
      }
      if (table === 'api_keys') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: {
                    id: OLD_KEY_ID,
                    name: 'Old key',
                    scopes: ['products:read'],
                    rate_limit_per_minute: 60,
                    expires_at: null,
                    is_active: true,
                    revoked_at: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: { id: 'new-key-id', name: 'Old key (rotated)', key_prefix: 'sf_live_aaaa', scopes: ['products:read'], rate_limit_per_minute: 60, expires_at: null, created_at: new Date().toISOString() },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve(updateResult) }),
        };
      }
      if (table === 'api_key_audit_log') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

import { POST } from '@/app/api/v1/api-keys/[id]/rotate/route';

function makeRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/v1/api-keys/${OLD_KEY_ID}/rotate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

beforeEach(() => {
  updateResult = { error: null };
});

describe('POST /api/v1/api-keys/:id/rotate — old-key deactivation reporting', () => {
  it('reports the old key as deactivated when the update succeeds', async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: OLD_KEY_ID }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.old_key.deactivated).toBe(true);
    expect(body.data._warnings).toBeUndefined();
  });

  it('does not report success when deactivating the old key fails', async () => {
    updateResult = { error: { message: 'db unavailable' } };
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: OLD_KEY_ID }) });
    const body = await res.json();
    expect(res.status).toBe(207);
    expect(body.data.old_key.deactivated).toBe(false);
    expect(body.data._warnings).toBeDefined();
    expect(body.data._warnings[0]).toMatch(/could not be deactivated/i);
  });
});
