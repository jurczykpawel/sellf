/**
 * DB TEST: seller_embed_settings is managed by the shop admin only
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const CLIENT_OPTS = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTS);
const PASSWORD = 'embed-settings-Test-123!';
const createdUserIds: string[] = [];

async function signedInUser(): Promise<{ id: string; client: SupabaseClient }> {
  const email = `embed-settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  await admin.from('seller_embed_settings').delete().in('seller_id', createdUserIds);
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe('seller_embed_settings write access', () => {
  it('rejects a row written by a signed-in customer for their own account', async () => {
    const user = await signedInUser();

    const { error } = await user.client
      .from('seller_embed_settings')
      .insert({ seller_id: user.id, allowed_embed_origins: ['https://shop.example.com'] });

    expect(error).not.toBeNull();
    const { data } = await admin.from('seller_embed_settings').select('seller_id').eq('seller_id', user.id);
    expect(data).toEqual([]);
  });

  it('does not let a customer change or remove an existing row', async () => {
    const user = await signedInUser();
    await admin
      .from('seller_embed_settings')
      .insert({ seller_id: user.id, allowed_embed_origins: ['https://shop.example.com'] });

    await user.client
      .from('seller_embed_settings')
      .update({ allowed_embed_origins: ['https://other.example.com'] })
      .eq('seller_id', user.id);
    await user.client.from('seller_embed_settings').delete().eq('seller_id', user.id);

    const { data } = await admin
      .from('seller_embed_settings')
      .select('allowed_embed_origins')
      .eq('seller_id', user.id)
      .single();
    expect(data?.allowed_embed_origins).toEqual(['https://shop.example.com']);
  });

  it('still lets the service role manage rows', async () => {
    const user = await signedInUser();
    const { error } = await admin
      .from('seller_embed_settings')
      .upsert({ seller_id: user.id, allowed_embed_origins: ['https://shop.example.com'] });
    expect(error).toBeNull();
  });
});
