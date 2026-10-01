/**
 * Revoking, disabling and re-enabling API keys that were rotated.
 *
 * REQUIRES: Supabase running locally (npx supabase start). Runs the real
 * route handlers against the local database; only the admin session is stubbed.
 */

import { randomBytes } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Missing Supabase env variables for testing');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const owner = vi.hoisted(() => ({ adminId: '' }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/auth-server', () => ({
  requireAdminApi: async () => ({ user: { id: 'admin-user' }, role: 'owner' }),
}));
vi.mock('@/lib/api/owner-resolution', () => ({
  resolveApiKeyOwner: async () => ({ role: 'owner', adminId: owner.adminId }),
}));

import { PATCH, DELETE } from '@/app/api/v1/api-keys/[id]/route';

const createdKeyIds: string[] = [];
const graceUntil = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function insertKey(fields: Record<string, unknown>): Promise<{ id: string; hash: string }> {
  const hash = randomBytes(32).toString('hex');
  const { data, error } = await admin
    .from('api_keys')
    .insert({
      name: 'deactivation test',
      key_prefix: `sf_t_${randomBytes(4).toString('hex').slice(0, 7)}`,
      key_hash: hash,
      admin_user_id: owner.adminId,
      ...fields,
    })
    .select('id')
    .single();
  if (error) throw error;
  createdKeyIds.push(data.id);
  return { id: data.id, hash };
}

async function rotatedKey(): Promise<{ id: string; hash: string }> {
  const old = await insertKey({ is_active: false, rotation_grace_until: graceUntil() });
  await insertKey({ rotated_from_id: old.id });
  return old;
}

async function row(id: string) {
  const { data } = await admin
    .from('api_keys')
    .select('is_active, rotation_grace_until, revoked_at')
    .eq('id', id)
    .single();
  return data!;
}

function req(method: string, id: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/api-keys/${id}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const { data } = await admin.from('admin_users').select('id').limit(1).single();
  owner.adminId = data!.id;
});

afterAll(async () => {
  if (createdKeyIds.length) await admin.from('api_keys').delete().in('id', createdKeyIds);
});

describe('rotated API keys', () => {
  it('verify_api_key refuses a revoked key inside its rotation window', async () => {
    const key = await insertKey({
      is_active: false,
      rotation_grace_until: graceUntil(),
      revoked_at: new Date().toISOString(),
    });

    const { data } = await admin.rpc('verify_api_key', { p_key_hash: key.hash });

    expect(data?.[0]?.is_valid).toBe(false);
  });

  it('revoking a rotated key ends its rotation window', async () => {
    const key = await rotatedKey();

    const res = await DELETE(req('DELETE', key.id), params(key.id));

    expect(res.status).toBe(200);
    expect((await row(key.id)).rotation_grace_until).toBeNull();
    const { data } = await admin.rpc('verify_api_key', { p_key_hash: key.hash });
    expect(data?.[0]?.is_valid).toBe(false);
  });

  it('disabling a rotated key ends its rotation window', async () => {
    const key = await rotatedKey();

    const res = await PATCH(req('PATCH', key.id, { is_active: false }), params(key.id));

    expect(res.status).toBe(200);
    expect((await row(key.id)).rotation_grace_until).toBeNull();
  });

  it('does not re-enable a key that was rotated', async () => {
    const key = await rotatedKey();

    const res = await PATCH(req('PATCH', key.id, { is_active: true }), params(key.id));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await row(key.id)).is_active).toBe(false);
  });

  it('still re-enables a key that was only disabled', async () => {
    const key = await insertKey({ is_active: false });

    const res = await PATCH(req('PATCH', key.id, { is_active: true }), params(key.id));

    expect(res.status).toBe(200);
    expect((await row(key.id)).is_active).toBe(true);
  });
});
