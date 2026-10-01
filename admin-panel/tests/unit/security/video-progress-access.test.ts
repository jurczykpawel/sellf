/**
 * DB TEST: update_video_progress records progress only for products the user can access
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
const PASSWORD = 'video-progress-Test-123!';
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let user: { id: string; client: SupabaseClient };
const productIds: string[] = [];

async function product(): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .insert({ name: `Video ${RUN}`, slug: `video-progress-${RUN}-${productIds.length}`, price: 10, currency: 'USD', is_active: true })
    .select('id')
    .single();
  if (error) throw error;
  productIds.push(data.id);
  return data.id;
}

function record(productId: string) {
  return user.client.rpc('update_video_progress', {
    product_id_param: productId,
    video_id_param: 'lesson-1',
    position_param: 42,
  });
}

beforeAll(async () => {
  const email = `video-progress-${RUN}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  user = { id: data.user.id, client };
});

afterAll(async () => {
  await admin.from('video_progress').delete().in('product_id', productIds);
  await admin.from('user_product_access').delete().in('product_id', productIds);
  await admin.from('products').delete().in('id', productIds);
  if (user) await admin.auth.admin.deleteUser(user.id);
});

describe('update_video_progress', () => {
  it('records nothing for a product the user has no access to', async () => {
    const productId = await product();

    const { error } = await record(productId);

    expect(error).not.toBeNull();
    const { data } = await admin.from('video_progress').select('id').eq('product_id', productId);
    expect(data).toEqual([]);
  });

  it('records progress for a product the user owns', async () => {
    const productId = await product();
    await admin.from('user_product_access').insert({ user_id: user.id, product_id: productId });

    const { data, error } = await record(productId);

    expect(error).toBeNull();
    expect(data?.last_position).toBe(42);
  });
});
