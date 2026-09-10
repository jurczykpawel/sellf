/**
 * SECURITY TEST: captcha_nonces table grants/RLS + consumeCaptchaNonce
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260910000000_auth_hardening.sql
 * @see src/lib/captcha/nonce-store.ts
 */

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import { consumeCaptchaNonce } from '@/lib/captcha/nonce-store';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

describe('captcha_nonces — grants and RLS', () => {
  it('anon cannot select from captcha_nonces', async () => {
    const { data, error } = await supabaseAnon.from('captcha_nonces').select('nonce_hash').limit(1);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('anon cannot insert into captcha_nonces', async () => {
    const { error } = await supabaseAnon
      .from('captcha_nonces')
      .insert({ nonce_hash: `anon-probe-${Date.now()}`, expires_at: new Date().toISOString() });
    expect(error).not.toBeNull();
  });
});

describe('consumeCaptchaNonce', () => {
  it('returns true on first use and false on replay of the same nonce hash', async () => {
    const nonceHash = `test-nonce-${Date.now()}-${Math.random()}`;
    const expiresAt = new Date(Date.now() + 60_000);

    const first = await consumeCaptchaNonce(nonceHash, expiresAt);
    expect(first).toBe(true);

    const second = await consumeCaptchaNonce(nonceHash, expiresAt);
    expect(second).toBe(false);
  });
});
