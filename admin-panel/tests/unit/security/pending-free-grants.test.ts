/**
 * DB TEST: pending free-product grants kept in auth.users.raw_app_meta_data
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260911000000_pending_free_grants.sql
 * @see src/lib/services/pending-free-grants.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
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
const anon = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);

const PASSWORD = 'pending-grants-Test-123!';
const FREE_SLUG = 'free-tutorial';

let freeProductId: string;
let paidProduct: { id: string; slug: string };

async function createUser(): Promise<{ id: string; email: string }> {
  const email = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function pendingOf(userId: string): Promise<unknown> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data.user?.app_metadata?.pending_free_grants;
}

beforeAll(async () => {
  const { data: free } = await admin.from('products').select('id').eq('slug', FREE_SLUG).single();
  freeProductId = free!.id;
  const { data: paid } = await admin
    .from('products')
    .select('id, slug')
    .gt('price', 0)
    .eq('allow_custom_price', false)
    .eq('is_active', true)
    .limit(1)
    .single();
  paidProduct = paid!;
});

describe('queue_pending_free_grant', () => {
  it('records an active free product on the user and does not duplicate it', async () => {
    const user = await createUser();

    const first = await admin.rpc('queue_pending_free_grant', { p_email: user.email, p_product_slug: FREE_SLUG });
    const second = await admin.rpc('queue_pending_free_grant', { p_email: user.email.toUpperCase(), p_product_slug: FREE_SLUG });

    expect(first.error).toBeNull();
    expect(first.data).toBe(true);
    expect(second.data).toBe(true);
    expect(await pendingOf(user.id)).toEqual([freeProductId]);
  });

  it('refuses a paid product', async () => {
    const user = await createUser();

    const { data } = await admin.rpc('queue_pending_free_grant', { p_email: user.email, p_product_slug: paidProduct.slug });

    expect(data).toBe(false);
    expect(await pendingOf(user.id)).toBeUndefined();
  });

  it('returns false for an email without an account', async () => {
    const { data, error } = await admin.rpc('queue_pending_free_grant', {
      p_email: `nobody-${Date.now()}@example.com`,
      p_product_slug: FREE_SLUG,
    });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('cannot be executed by anon or authenticated callers', async () => {
    const user = await createUser();
    const userClient = await signIn(user.email);

    const asAnon = await anon.rpc('queue_pending_free_grant', { p_email: user.email, p_product_slug: FREE_SLUG });
    const asUser = await userClient.rpc('queue_pending_free_grant', { p_email: user.email, p_product_slug: FREE_SLUG });

    expect(asAnon.error).not.toBeNull();
    expect(asUser.error).not.toBeNull();
    expect(await pendingOf(user.id)).toBeUndefined();
  });
});

describe('pending_free_grant_products', () => {
  it('returns the caller’s claimable products and prunes ones that are no longer free', async () => {
    const user = await createUser();
    await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { pending_free_grants: [freeProductId, paidProduct.id] },
    });
    const userClient = await signIn(user.email);

    const { data, error } = await userClient.rpc('pending_free_grant_products');

    expect(error).toBeNull();
    expect(data).toEqual([{ product_id: freeProductId, slug: FREE_SLUG }]);
    expect(await pendingOf(user.id)).toEqual([freeProductId]);
  });

  it('is not callable by anon', async () => {
    const { error } = await anon.rpc('pending_free_grant_products');
    expect(error).not.toBeNull();
  });
});

describe('granting access clears the pending entry', () => {
  it('removes the product from pending_free_grants when a user_product_access row appears', async () => {
    const user = await createUser();
    await admin.rpc('queue_pending_free_grant', { p_email: user.email, p_product_slug: FREE_SLUG });

    const { error } = await admin
      .from('user_product_access')
      .insert({ user_id: user.id, product_id: freeProductId });

    expect(error).toBeNull();
    expect(await pendingOf(user.id)).toEqual([]);
  });
});
