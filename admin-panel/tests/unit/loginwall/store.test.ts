/**
 * Login wall nonce store — atomic single-use semantics.
 *
 * REQUIRES: Supabase running locally (npx supabase start).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import {
  storeLoginwallNonce,
  consumeLoginwallNonce,
} from '@/lib/loginwall/store';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
});

const NS = `loginwall-store-${Date.now()}`;
let testUserId: string;
let testProductId: string;

beforeAll(async () => {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email: `${NS}@example.com`,
    password: 'test123456',
    email_confirm: true,
  });
  if (userErr || !userData.user) throw new Error(`create user failed: ${userErr?.message}`);
  testUserId = userData.user.id;

  const { data: product, error: productErr } = await supabaseAdmin
    .from('products')
    .insert({ name: `LW Test ${NS}`, slug: `lw-${NS}`, price: 0, currency: 'USD' })
    .select('id')
    .single();
  if (productErr || !product) throw new Error(`create product failed: ${productErr?.message}`);
  testProductId = product.id;
});

afterAll(async () => {
  if (testProductId) {
    await supabaseAdmin.from('products').delete().eq('id', testProductId);
  }
  if (testUserId) {
    await supabaseAdmin.auth.admin.deleteUser(testUserId);
  }
});

describe('storeLoginwallNonce', () => {
  it('inserts a nonce row with the given fields', async () => {
    const nonceHash = `hash-${NS}-store-1`;
    const expiresAt = new Date(Date.now() + 60_000);

    await storeLoginwallNonce({
      productId: testProductId,
      userId: testUserId,
      nonceHash,
      expiresAt,
    });

    const { data, error } = await supabaseAdmin
      .from('loginwall_tokens')
      .select('user_id, product_id, nonce_hash, used_at')
      .eq('nonce_hash', nonceHash)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.user_id).toBe(testUserId);
    expect(data!.product_id).toBe(testProductId);
    expect(data!.used_at).toBeNull();
  });

  it('rejects a duplicate nonce hash (UNIQUE constraint)', async () => {
    const nonceHash = `hash-${NS}-dup`;
    const expiresAt = new Date(Date.now() + 60_000);

    await storeLoginwallNonce({ productId: testProductId, userId: testUserId, nonceHash, expiresAt });
    await expect(
      storeLoginwallNonce({ productId: testProductId, userId: testUserId, nonceHash, expiresAt }),
    ).rejects.toThrow();
  });
});

describe('consumeLoginwallNonce', () => {
  it('returns the row payload and marks used_at when called the first time', async () => {
    const nonceHash = `hash-${NS}-consume-1`;
    const expiresAt = new Date(Date.now() + 60_000);
    await storeLoginwallNonce({ productId: testProductId, userId: testUserId, nonceHash, expiresAt });

    const result = await consumeLoginwallNonce(nonceHash);
    expect(result).toEqual({ userId: testUserId, productId: testProductId });

    const { data } = await supabaseAdmin
      .from('loginwall_tokens')
      .select('used_at')
      .eq('nonce_hash', nonceHash)
      .maybeSingle();
    expect(data!.used_at).not.toBeNull();
  });

  it('returns null on the second call (single-use)', async () => {
    const nonceHash = `hash-${NS}-consume-2`;
    const expiresAt = new Date(Date.now() + 60_000);
    await storeLoginwallNonce({ productId: testProductId, userId: testUserId, nonceHash, expiresAt });

    const first = await consumeLoginwallNonce(nonceHash);
    expect(first).not.toBeNull();

    const second = await consumeLoginwallNonce(nonceHash);
    expect(second).toBeNull();
  });

  it('returns null for an unknown nonce', async () => {
    const result = await consumeLoginwallNonce(`hash-${NS}-never-stored`);
    expect(result).toBeNull();
  });

  it('returns null for an expired nonce', async () => {
    const nonceHash = `hash-${NS}-expired`;
    const expiresAt = new Date(Date.now() - 60_000);
    await storeLoginwallNonce({ productId: testProductId, userId: testUserId, nonceHash, expiresAt });

    const result = await consumeLoginwallNonce(nonceHash);
    expect(result).toBeNull();
  });
});
