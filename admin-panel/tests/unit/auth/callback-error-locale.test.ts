/**
 * /auth/callback sends a failed sign-in (used or expired link, upstream error) back to the login
 * page in the language the link was sent in (REG-2026-11-26-rc4-A-B1). The language comes only
 * from the validated return path or the `locale` marker, limited to the supported locales.
 *
 * @see src/app/[locale]/auth/callback/route.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const verifyOtp = vi.hoisted(() => vi.fn());
const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { verifyOtp, exchangeCodeForSession, signOut: vi.fn() }, rpc: vi.fn() }),
}));

import { GET } from '@/app/[locale]/auth/callback/route';

const ORIGIN = 'https://shop.example.com';
const PL_RETURN = '/pl/auth/product-access?product=widget';

function callback(query: string): Promise<Response> {
  return GET(new NextRequest(`${ORIGIN}/auth/callback?${query}`));
}

function location(response: Response): URL {
  return new URL(response.headers.get('location') ?? '');
}

describe('auth callback error keeps the link language', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('DEMO_MODE', 'false');
    vi.stubEnv('SITE_URL', ORIGIN);
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ data: { session: null }, error: { code: 'otp_expired', message: 'used' } });
  });

  it('returns a used PL product link to /pl/login with its return path', async () => {
    const url = location(await callback(`redirect_to=${encodeURIComponent(PL_RETURN)}&type=magiclink&token_hash=used`));

    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/pl/login');
    expect(url.searchParams.get('error')).toBe('magic_link_expired');
    expect(url.searchParams.get('redirect_to')).toBe(PL_RETURN);
  });

  it('returns an upstream otp_expired error for a PL link to /pl/login', async () => {
    const url = location(await callback(`redirect_to=${encodeURIComponent(PL_RETURN)}&error=access_denied&error_code=otp_expired`));

    expect(url.pathname).toBe('/pl/login');
    expect(url.searchParams.get('error')).toBe('magic_link_expired');
  });

  it('returns a used PL plain-login link to /pl/login', async () => {
    const url = location(await callback('flow=login&locale=pl&type=magiclink&token_hash=used'));

    expect(url.pathname).toBe('/pl/login');
    expect(url.searchParams.get('error')).toBe('magic_link_expired');
  });

  it('keeps English links on the unprefixed default-locale login', async () => {
    const product = location(await callback(`redirect_to=${encodeURIComponent('/en/auth/product-access?product=widget')}&type=magiclink&token_hash=used`));
    const plain = location(await callback('flow=login&locale=en&error=server_error'));

    expect(product.pathname).toBe('/login');
    expect(plain.pathname).toBe('/login');
    expect(plain.searchParams.get('error')).toBe('oauth_failed');
  });

  it.each([
    'flow=login&locale=de&type=magiclink&token_hash=used',
    'flow=login&locale=%2F%2Fevil.example&type=magiclink&token_hash=used',
    `redirect_to=${encodeURIComponent('//evil.example/pl/auth/product-access?product=widget')}&type=magiclink&token_hash=used`,
    `redirect_to=${encodeURIComponent('/de/auth/product-access?product=widget')}&locale=..&type=magiclink&token_hash=used`,
  ])('ignores an unsupported or foreign language source (%s)', async query => {
    const url = location(await callback(query));

    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/login');
  });
});
