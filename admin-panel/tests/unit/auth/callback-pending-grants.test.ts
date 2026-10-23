/**
 * /auth/callback grants pending free products on every sign-in
 * (magic link of any flow, OAuth), skipping the product the redirect's
 * /auth/product-access step grants itself (keeps success_url / OTO page).
 *
 * @see src/app/[locale]/auth/callback/route.ts
 * @see src/lib/services/pending-free-grants.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const claimPendingFreeGrants = vi.hoisted(() => vi.fn());
const exchangeCodeForSession = vi.hoisted(() => vi.fn());
const verifyOtp = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { verifyOtp, exchangeCodeForSession, signOut: vi.fn() }, rpc }),
}));
vi.mock('@/lib/services/disposable-email', () => ({
  DisposableEmailService: { validateEmail: async () => ({ isValid: true }) },
}));
vi.mock('@/lib/services/pending-free-grants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/pending-free-grants')>();
  return { ...actual, claimPendingFreeGrants };
});

import { GET } from '@/app/[locale]/auth/callback/route';
import { buildFreeProductMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';

const USER = {
  id: 'user-1',
  email: 'buyer@example.com',
  app_metadata: { pending_free_grants: ['p-1'] },
};

function callback(query: string): Promise<Response> {
  return GET(new NextRequest(`https://shop.example.com/auth/callback?${query}`));
}

describe('auth callback pending free grants', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('DEMO_MODE', 'false');
    vi.stubEnv('SITE_URL', 'https://shop.example.com');
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
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

  it.each(['/affiliates/apply', '/pl/affiliates/apply', '/en/affiliates/apply', '/auth/product-access?product=course', '/pl/auth/product-access?product=course', '/en/auth/product-access?product=course&coupon=SAVE'])('retains supported arrival destination %s', async path => {
    const response = await callback(`redirect_to=${encodeURIComponent(path)}&type=magiclink&token_hash=abc`);
    expect(response.headers.get('location')).toBe(`https://shop.example.com${path}`);
  });

  it('keeps the nested success query intact through arrival', async () => {
    const link = new URL(buildFreeProductMagicLinkRedirect({ origin: 'https://shop.example.com', productSlug: 'course', locale: 'pl', successUrl: '/thanks?a=1&b=2' }));
    const response = await callback(`${link.searchParams.toString()}&type=magiclink&token_hash=abc`);
    const destination = new URL(response.headers.get('location')!);
    expect(destination.pathname).toBe('/pl/auth/product-access');
    expect(destination.searchParams.get('success_url')).toBe('/thanks?a=1&b=2');
    expect([...destination.searchParams.keys()]).toEqual(['product', 'success_url']);
  });

  it.each(['/dashboard', '//elsewhere.test', '/\t/elsewhere.test', '/%09/elsewhere.test', '%2Fpl%2Faffiliates%2Fapply', 'https://shop.example.com/pl/affiliates/apply', '/auth/product-access?product=course&return_url=/dashboard'])('uses the account default for unsupported arrival %j', async path => {
    const response = await callback(`redirect_to=${encodeURIComponent(path)}&type=magiclink&token_hash=abc`);
    expect(response.headers.get('location')).toBe('https://shop.example.com/my-products');
  });

  it('uses the admin default for an unsupported arrival destination', async () => {
    rpc.mockResolvedValueOnce({ data: true });
    const response = await callback('redirect_to=%2Fother&type=magiclink&token_hash=abc');
    expect(response.headers.get('location')).toBe('https://shop.example.com/dashboard');
  });

  it.each(['/pl/affiliates/apply', '/en/affiliates/apply'])('retains the parsed OAuth return cookie %s', async path => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: { user: USER } }, error: null });
    const response = await GET(new NextRequest('https://shop.example.com/auth/callback?code=local-code', { headers: { cookie: `sf_oauth_redirect=${encodeURIComponent(path)}` } }));
    expect(response.headers.get('location')).toBe(`https://shop.example.com${path}`);
    expect(response.cookies.get('sf_oauth_redirect')?.value).toBe('');
  });

  it('retains the complete nested query in the parsed OAuth return cookie', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: { user: USER } }, error: null });
    const link = new URL(buildFreeProductMagicLinkRedirect({ origin: 'https://shop.example.com', productSlug: 'course', locale: 'pl', successUrl: '/thanks?a=1&b=2' }));
    const path = link.searchParams.get('redirect_to')!;
    const response = await GET(new NextRequest('https://shop.example.com/auth/callback?code=local-code', { headers: { cookie: `sf_oauth_redirect=${encodeURIComponent(path)}` } }));
    expect(response.headers.get('location')).toBe(`https://shop.example.com${path}`);
    expect(new URL(response.headers.get('location')!).searchParams.get('success_url')).toBe('/thanks?a=1&b=2');
    expect(claimPendingFreeGrants).toHaveBeenCalledWith(expect.objectContaining({ skipSlug: 'course' }));
    expect(response.cookies.get('sf_oauth_redirect')?.value).toBe('');
  });

  it('uses the account default for a noncanonical parsed OAuth cookie', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: { user: USER } }, error: null });
    const value = encodeURIComponent('/pl/affiliates/apply');
    const response = await GET(new NextRequest('https://shop.example.com/auth/callback?code=local-code', { headers: { cookie: `sf_oauth_redirect=${encodeURIComponent(value)}` } }));
    expect(response.headers.get('location')).toBe('https://shop.example.com/my-products');
  });

  it.each(['', '/other'])('uses the account default for explicit unsupported arrival %j even with an OAuth cookie', async path => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: { user: USER } }, error: null });
    const response = await GET(new NextRequest(`https://shop.example.com/auth/callback?code=local-code&redirect_to=${encodeURIComponent(path)}`, { headers: { cookie: `sf_oauth_redirect=${encodeURIComponent('/pl/affiliates/apply')}` } }));
    expect(response.headers.get('location')).toBe('https://shop.example.com/my-products');
  });

  it.each(['', '/en', '/pl'])('retains the complete loginwall destination for email and OAuth with prefix %s', async prefix => {
    const path = `${prefix}/loginwall/protect?id=a1b2c3d4-e5f6-4890-abcd-ef0123456789&redirect=${encodeURIComponent('https://customer.example/course?a=1&b=2')}`;
    const emailResponse = await callback(`redirect_to=${encodeURIComponent(path)}&type=magiclink&token_hash=abc`);
    expect(emailResponse.headers.get('location')).toBe(`https://shop.example.com${path}`);
    exchangeCodeForSession.mockResolvedValue({ data: { session: { user: USER } }, error: null });
    const oauthResponse = await GET(new NextRequest('https://shop.example.com/auth/callback?code=local-code', { headers: { cookie: `sf_oauth_redirect=${encodeURIComponent(path)}` } }));
    expect(oauthResponse.headers.get('location')).toBe(`https://shop.example.com${path}`);
    expect(oauthResponse.cookies.get('sf_oauth_redirect')?.value).toBe('');
  });

  it('retains the parsed OAuth return cookie', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: { user: USER } }, error: null });
    const path = '/auth/product-access?product=course&success_url=%2Fthanks%3Fa%3D1%26b%3D2';
    const response = await GET(new NextRequest('https://shop.example.com/auth/callback?code=local-code', { headers: { cookie: `sf_oauth_redirect=${encodeURIComponent(path)}` } }));
    expect(response.headers.get('location')).toBe(`https://shop.example.com${path}`);
  });

  it.each(['/other', '/\t/elsewhere.test', '/auth/product-access?product=course&return_url=/dashboard'])('uses the account default for unsupported OAuth return cookie %j', async path => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: { user: USER } }, error: null });
    const response = await GET(new NextRequest('https://shop.example.com/auth/callback?code=local-code', { headers: { cookie: `sf_oauth_redirect=${encodeURIComponent(path)}` } }));
    expect(response.headers.get('location')).toBe('https://shop.example.com/my-products');
  });

  it('does not claim when the sign-in failed', async () => {
    verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { message: 'expired' } });

    await callback('flow=login&type=magiclink&token_hash=abc');

    expect(claimPendingFreeGrants).not.toHaveBeenCalled();
  });
});

describe('demo auth callback', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('declines code exchange in demo mode', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('SITE_URL', 'https://shop.example.com');
    vi.clearAllMocks();
    const response = await callback('code=abc');
    expect(response.headers.get('location')).toBe('https://shop.example.com/login?error=demo_mode');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });

  it.each(['magiclink', 'recovery', 'invite', 'email_change', 'signup'])('declines %s callbacks', async (type) => {
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('SITE_URL', 'https://shop.example.com');
    vi.clearAllMocks();
    const response = await callback(`type=${type}&token_hash=abc`);
    expect(response.headers.get('location')).toBe('https://shop.example.com/login?error=demo_mode');
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(claimPendingFreeGrants).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });
});
