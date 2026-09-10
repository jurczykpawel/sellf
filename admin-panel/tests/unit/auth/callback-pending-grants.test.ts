/**
 * /auth/callback grants pending free products on every sign-in
 * (magic link of any flow, OAuth), skipping the product the redirect's
 * /auth/product-access step grants itself (keeps success_url / OTO page).
 *
 * @see src/app/[locale]/auth/callback/route.ts
 * @see src/lib/services/pending-free-grants.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const claimPendingFreeGrants = vi.hoisted(() => vi.fn());
const verifyOtp = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { verifyOtp, exchangeCodeForSession: vi.fn(), signOut: vi.fn() }, rpc }),
}));
vi.mock('@/lib/services/disposable-email', () => ({
  DisposableEmailService: { validateEmail: async () => ({ isValid: true }) },
}));
vi.mock('@/lib/services/pending-free-grants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/pending-free-grants')>();
  return { ...actual, claimPendingFreeGrants };
});

import { GET } from '@/app/[locale]/auth/callback/route';

const USER = {
  id: 'user-1',
  email: 'buyer@example.com',
  app_metadata: { pending_free_grants: ['p-1'] },
};

function callback(query: string): Promise<Response> {
  return GET(new NextRequest(`https://shop.example.com/auth/callback?${query}`));
}

describe('auth callback pending free grants', () => {
  beforeEach(() => {
    process.env.SITE_URL = 'https://shop.example.com';
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_ANON_KEY = 'anon';
    claimPendingFreeGrants.mockReset();
    claimPendingFreeGrants.mockResolvedValue(1);
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ data: { session: { user: USER } }, error: null });
    rpc.mockReset();
    rpc.mockResolvedValue({ data: false });
  });

  it('claims pending grants on a plain login and still lands on my-products', async () => {
    const response = await callback('flow=login&type=magiclink&token_hash=abc');

    expect(claimPendingFreeGrants).toHaveBeenCalledWith(
      expect.objectContaining({ user: USER, skipSlug: undefined }),
    );
    expect(response.headers.get('location')).toBe('https://shop.example.com/my-products');
  });

  it('skips the product the product-access redirect grants itself', async () => {
    const redirectTo = encodeURIComponent('/auth/product-access?product=widget&success_url=x');
    const response = await callback(`redirect_to=${redirectTo}&type=magiclink&token_hash=abc`);

    expect(claimPendingFreeGrants).toHaveBeenCalledWith(expect.objectContaining({ skipSlug: 'widget' }));
    expect(response.headers.get('location')).toContain('/auth/product-access?product=widget');
  });

  it('does not claim when the sign-in failed', async () => {
    verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { message: 'expired' } });

    await callback('flow=login&type=magiclink&token_hash=abc');

    expect(claimPendingFreeGrants).not.toHaveBeenCalled();
  });
});
