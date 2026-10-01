/**
 * API key rotation must record its audit log event durably.
 *
 * api_key_audit_log only has a SELECT RLS policy for authenticated (admins
 * reading logs for their own keys). If the rotation handler writes the
 * event through the session-scoped client, the insert is rejected by RLS
 * and the error is silently discarded — the event never lands.
 *
 * REQUIRES: Supabase running locally (npx supabase start). Runs the real
 * route handler against the local database; only the admin auth check is
 * stubbed. The session client used inside the route is a genuine signed-in
 * (non-admin) user, so it is bound by the same RLS the production route
 * client would see.
 */

import { randomBytes } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteChecked, deleteAuthUsers } from '../../helpers/db-cleanup';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const CLIENT_OPTS = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTS);
const PASSWORD = 'rotate-audit-Test-123!';

const owner = vi.hoisted(() => ({ adminId: '' }));
const sessionCtx = vi.hoisted(() => ({ client: undefined as unknown as SupabaseClient }));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => sessionCtx.client }));
vi.mock('@/lib/auth-server', () => ({
  requireAdminApi: async () => ({ user: { id: 'admin-user' }, role: 'owner' }),
}));
vi.mock('@/lib/api/owner-resolution', () => ({
  resolveApiKeyOwner: async () => ({ role: 'owner', adminId: owner.adminId }),
}));

import { POST } from '@/app/api/v1/api-keys/[id]/rotate/route';

const createdKeyIds: string[] = [];
const createdUserIds: string[] = [];

async function insertKey(): Promise<{ id: string }> {
  const { data, error } = await admin
    .from('api_keys')
    .insert({
      name: 'rotate audit test',
      key_prefix: `sf_t_${randomBytes(4).toString('hex').slice(0, 7)}`,
      key_hash: randomBytes(32).toString('hex'),
      admin_user_id: owner.adminId,
    })
    .select('id')
    .single();
  if (error) throw error;
  createdKeyIds.push(data.id);
  return { id: data.id };
}

function req(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/api-keys/${id}/rotate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  const { data } = await admin.from('admin_users').select('id').limit(1).single();
  owner.adminId = data!.id;

  const email = `rotate-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data: userData, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !userData.user) throw error ?? new Error('createUser failed');
  createdUserIds.push(userData.user.id);

  sessionCtx.client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
  const { error: signInError } = await sessionCtx.client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
});

afterAll(async () => {
  if (createdKeyIds.length) {
    await deleteChecked('api_key_audit_log', admin.from('api_key_audit_log').delete().in('api_key_id', createdKeyIds));
    await deleteChecked('api_keys', admin.from('api_keys').delete().in('id', createdKeyIds));
  }
  await deleteAuthUsers(admin, createdUserIds);
});

describe('API key rotation audit log', () => {
  it('stores a rotation event that survives the request', async () => {
    const key = await insertKey();

    const res = await POST(req(key.id), params(key.id));
    expect(res.status).toBe(201);
    // Rotation inserts a brand new api_keys row (rotated_from_id is ON DELETE SET NULL, so
    // deleting the old key above does not cascade to it) — track it for cleanup too.
    const resBody = (await res.json()) as { data?: { new_key?: { id?: string } } };
    if (resBody.data?.new_key?.id) createdKeyIds.push(resBody.data.new_key.id);

    const { data } = await admin
      .from('api_key_audit_log')
      .select('event_type, api_key_id')
      .eq('api_key_id', key.id)
      .eq('event_type', 'rotated');

    expect(data).toHaveLength(1);
  });
});
