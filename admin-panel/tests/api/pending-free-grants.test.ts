/**
 * API Integration Test: a free product requested by email reaches the user
 * even when they later sign in through a plain login link (not the
 * product-access link from the original email).
 *
 * @see src/lib/services/pending-free-grants.ts
 * @see supabase/migrations/20260911000000_pending_free_grants.sql
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { solveChallenge } from 'altcha-lib/v1';
import { API_URL } from './setup';

const admin = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const FREE_SLUG = 'free-tutorial';

async function getAltchaPayload(): Promise<string> {
  const response = await fetch(`${API_URL}/api/captcha/challenge`);
  const challenge = await response.json();
  const { promise } = solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm);
  const solution = await promise;
  if (!solution) throw new Error('Failed to solve ALTCHA challenge');
  return btoa(JSON.stringify({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    number: solution.number,
    salt: challenge.salt,
    signature: challenge.signature,
  }));
}

describe('Pending free grants', () => {
  it('grants a requested free product when the user signs in with a plain login link', async () => {
    const email = `pending-api-${Date.now()}@example.com`;

    const request = await fetch(`${API_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, captchaToken: await getAltchaPayload(), flow: 'free_product', productSlug: FREE_SLUG }),
    });
    expect(request.status).toBe(200);

    // The user ignores that email and asks for an ordinary login link instead.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    expect(linkError).toBeNull();
    const callbackUrl = `${API_URL}/auth/callback?flow=login&type=magiclink&token_hash=${link.properties!.hashed_token}`;

    const callback = await fetch(callbackUrl, { redirect: 'manual' });
    expect(callback.status).toBeGreaterThanOrEqual(300);
    expect(callback.status).toBeLessThan(400);
    expect(callback.headers.get('location') || '').toContain('/my-products');

    const { data: product } = await admin.from('products').select('id').eq('slug', FREE_SLUG).single();
    const { data: access } = await admin
      .from('user_product_access')
      .select('id')
      .eq('user_id', link.user!.id)
      .eq('product_id', product!.id);
    expect(access).toHaveLength(1);

    const { data: fresh } = await admin.auth.admin.getUserById(link.user!.id);
    expect(fresh.user?.app_metadata?.pending_free_grants).toEqual([]);
  });
});
