/**
 * Creating, revoking, deactivating and reactivating an API key must each
 * record a durable audit-log event — the same guarantee already enforced
 * for rotation in api-key-rotation-audit.test.ts.
 *
 * api_key_audit_log only has a SELECT RLS policy for authenticated (admins
 * reading logs for their own keys). Any handler that writes the event
 * through anything other than the service-role client would have its insert
 * rejected by RLS.
 *
 * REQUIRES: Supabase running locally (npx supabase start). Runs the real
 * route handlers against the local database; only the admin auth/owner
 * resolution is stubbed.
 */

import { randomBytes } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const owner = vi.hoisted(() => ({ adminId: '' }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'admin_users') {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: { id: owner.adminId }, error: null }) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));
vi.mock('@/lib/auth-server', () => ({
  requireAdminApi: async () => ({ user: { id: 'admin-user' }, role: 'owner' }),
}));
vi.mock('@/lib/api/owner-resolution', () => ({
  resolveApiKeyOwner: async () => ({ role: 'owner', adminId: owner.adminId }),
}));
vi.mock('@/lib/license/resolve', () => ({
  resolveCurrentTier: async () => 'business',
}));

import { POST as createKey } from '@/app/api/v1/api-keys/route';
import { PATCH, DELETE } from '@/app/api/v1/api-keys/[id]/route';

const createdKeyIds: string[] = [];

async function insertKey(fields: Record<string, unknown> = {}): Promise<{ id: string }> {
  const { data, error } = await admin
    .from('api_keys')
    .insert({
      name: 'lifecycle audit test',
      key_prefix: `sf_t_${randomBytes(4).toString('hex').slice(0, 7)}`,
      key_hash: randomBytes(32).toString('hex'),
      admin_user_id: owner.adminId,
      ...fields,
    })
    .select('id')
    .single();
  if (error) throw error;
  createdKeyIds.push(data.id);
  return { id: data.id };
}

function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function auditEvents(apiKeyId: string, eventType: string) {
  const { data } = await admin
    .from('api_key_audit_log')
    .select('event_type, api_key_id')
    .eq('api_key_id', apiKeyId)
    .eq('event_type', eventType);
  return data ?? [];
}

beforeAll(async () => {
  const { data } = await admin.from('admin_users').select('id').limit(1).single();
  owner.adminId = data!.id;
});

afterAll(async () => {
  if (createdKeyIds.length) {
    await admin.from('api_key_audit_log').delete().in('api_key_id', createdKeyIds);
    await admin.from('api_keys').delete().in('id', createdKeyIds);
  }
});

describe('API key lifecycle audit log', () => {
  it('records a created event when a key is created', async () => {
    const res = await createKey(req('POST', 'http://localhost:3000/api/v1/api-keys', { name: 'audit create test' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    const keyId = body.data.id;
    createdKeyIds.push(keyId);

    expect(await auditEvents(keyId, 'created')).toHaveLength(1);
  });

  it('records a revoked event when a key is revoked', async () => {
    const key = await insertKey();

    const res = await DELETE(req('DELETE', `http://localhost:3000/api/v1/api-keys/${key.id}`), params(key.id));

    expect(res.status).toBe(200);
    expect(await auditEvents(key.id, 'revoked')).toHaveLength(1);
  });

  it('records a deactivated event when a key is disabled', async () => {
    const key = await insertKey();

    const res = await PATCH(
      req('PATCH', `http://localhost:3000/api/v1/api-keys/${key.id}`, { is_active: false }),
      params(key.id)
    );

    expect(res.status).toBe(200);
    expect(await auditEvents(key.id, 'deactivated')).toHaveLength(1);
  });

  it('records a reactivated event when a key is re-enabled', async () => {
    const key = await insertKey({ is_active: false });

    const res = await PATCH(
      req('PATCH', `http://localhost:3000/api/v1/api-keys/${key.id}`, { is_active: true }),
      params(key.id)
    );

    expect(res.status).toBe(200);
    expect(await auditEvents(key.id, 'reactivated')).toHaveLength(1);
  });
});
