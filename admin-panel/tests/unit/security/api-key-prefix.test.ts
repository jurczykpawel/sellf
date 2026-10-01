/**
 * DB TEST: api_keys.key_prefix accepts the current and the earlier prefix length
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { randomBytes } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import { generateApiKey } from '@/lib/api/api-keys';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Missing Supabase env variables for testing');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let adminId: string;
const createdIds: string[] = [];

async function store(prefix: string) {
  const { data, error } = await admin
    .from('api_keys')
    .insert({ name: 'prefix test', key_prefix: prefix, key_hash: randomBytes(32).toString('hex'), admin_user_id: adminId })
    .select('id')
    .single();
  if (data) createdIds.push(data.id);
  return error;
}

beforeAll(async () => {
  const { data } = await admin.from('admin_users').select('id').limit(1).single();
  adminId = data!.id;
});

afterAll(async () => {
  if (createdIds.length) await admin.from('api_keys').delete().in('id', createdIds);
});

describe('api_keys.key_prefix', () => {
  it('stores the prefix of a newly generated key', async () => {
    expect(await store(generateApiKey().prefix)).toBeNull();
  });

  it('keeps accepting the shorter prefix of earlier keys', async () => {
    expect(await store(`sf_live_${randomBytes(2).toString('hex')}`)).toBeNull();
  });
});
