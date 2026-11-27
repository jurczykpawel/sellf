/**
 * A failed sign-in link (used, expired, upstream error, demo) returns to the login page in the
 * language the link was sent in (REG-2026-11-26-rc4-A-B1, W342b). The language comes only from the
 * validated return path prefix or the `locale` marker the link generator adds, limited to en/pl.
 * The end-to-end cases follow the redirects through the real proxy (next-intl), so a browser's
 * Accept-Language or an older NEXT_LOCALE cookie cannot switch the final screen.
 *
 * @see src/app/[locale]/auth/callback/route.ts
 * @see src/lib/auth/magic-link-redirect.ts
 * @see src/proxy.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const verifyOtp = vi.hoisted(() => vi.fn());
const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { verifyOtp, exchangeCodeForSession, signOut: vi.fn(), getUser: async () => ({ data: { user: null }, error: null }) },
    rpc: vi.fn(),
  }),
}));

import { GET } from '@/app/[locale]/auth/callback/route';
import { proxy } from '@/proxy';
import { buildLoginMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';

const ORIGIN = 'https://shop.example.com';
const PL_RETURN = '/pl/auth/product-access?product=widget';
const LOGINWALL_RETURN = '/loginwall/protect?id=00000000-0000-4000-8000-000000000001&redirect=https%3A%2F%2Fseller.example%2Fpage';

function callback(query: string): Promise<Response> {
  return GET(new NextRequest(`${ORIGIN}/auth/callback?${query}`));
}

function location(response: Response): URL {
  return new URL(response.headers.get('location') ?? '');
}

/** Follows proxy redirects like a browser (keeping cookies); returns the rendered login locale and the final query. */
async function finalLoginScreen(start: URL, browser: { acceptLanguage?: string; cookie?: string }): Promise<{ locale: string; params: URLSearchParams }> {
  const jar = new Map<string, string>();
  for (const pair of browser.cookie?.split(';') ?? []) {
    const [name, value] = pair.trim().split('=');
    if (name) jar.set(name, value);
  }
  let url = start.toString();
  for (let hop = 0; hop < 5; hop++) {
    const headers: Record<string, string> = {};
    if (browser.acceptLanguage) headers['accept-language'] = browser.acceptLanguage;
    if (jar.size) headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await proxy(new NextRequest(url, { headers }));
    for (const line of response.headers.getSetCookie()) {
      const [name, value] = line.split(';')[0].split('=');
      jar.set(name, value);
    }
    if (response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get('location') ?? '', url).toString();
      continue;
    }
    const rendered = new URL(response.headers.get('x-middleware-rewrite') ?? url);
    const match = rendered.pathname.match(/^\/(en|pl)\/login$/);
    if (!match) throw new Error(`Not a localized login screen: ${rendered.pathname}`);
    return { locale: match[1], params: new URL(url).searchParams };
  }
  throw new Error('Too many redirects');
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

  it.each(['pl', 'en'])('returns a used lead confirmation link to the lead language login (%s)', async locale => {
    const lead = `/${locale}/auth/lead?token=${'a'.repeat(64)}`;
    const url = location(await callback(`redirect_to=${encodeURIComponent(lead)}&type=magiclink&token_hash=used`));

    expect(url.pathname).toBe(`/${locale}/login`);
    expect(url.searchParams.get('error')).toBe('magic_link_expired');
    expect(url.searchParams.get('redirect_to')).toBe(lead);
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

  it('pins English links to /en/login', async () => {
    const product = location(await callback(`redirect_to=${encodeURIComponent('/en/auth/product-access?product=widget')}&type=magiclink&token_hash=used`));
    const plain = location(await callback('flow=login&locale=en&error=server_error'));

    expect(product.pathname).toBe('/en/login');
    expect(plain.pathname).toBe('/en/login');
    expect(plain.searchParams.get('error')).toBe('oauth_failed');
  });

  it('keeps the demo-mode notice in the link language', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    const url = location(await callback('flow=login&locale=pl&type=magiclink&token_hash=used'));

    expect(url.pathname).toBe('/pl/login');
    expect(url.searchParams.get('error')).toBe('demo_mode');
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

  describe('final login screen through the proxy', () => {
    it.each([
      { acceptLanguage: 'pl' },
      { cookie: 'NEXT_LOCALE=pl' },
    ])('an English link stays English for a Polish browser (%o)', async browser => {
      const start = location(await callback('flow=login&locale=en&type=magiclink&token_hash=used'));

      expect((await finalLoginScreen(start, browser)).locale).toBe('en');
    });

    it('keeps the error and return path across the /en/login -> /login hop', async () => {
      const returnPath = '/en/auth/product-access?product=widget';
      const start = location(await callback(`redirect_to=${encodeURIComponent(returnPath)}&type=magiclink&token_hash=used`));
      expect(start.pathname).toBe('/en/login');

      const screen = await finalLoginScreen(start, { acceptLanguage: 'pl' });

      expect(screen.locale).toBe('en');
      expect(screen.params.get('error')).toBe('magic_link_expired');
      expect(screen.params.get('redirect_to')).toBe(returnPath);
    });

    it.each([
      { acceptLanguage: 'en' },
      { cookie: 'NEXT_LOCALE=en' },
    ])('a Polish link stays Polish for an English browser (%o)', async browser => {
      const start = location(await callback(`redirect_to=${encodeURIComponent(PL_RETURN)}&type=magiclink&token_hash=used`));

      expect((await finalLoginScreen(start, browser)).locale).toBe('pl');
    });

    it('a Polish LoginWall link (unprefixed return path) expires onto the Polish screen', async () => {
      const link = new URL(buildLoginMagicLinkRedirect(ORIGIN, LOGINWALL_RETURN, 'pl'));
      expect(link.searchParams.get('redirect_to')).toBe(LOGINWALL_RETURN);

      const start = location(await callback(`${link.search.slice(1)}&type=magiclink&token_hash=used`));

      expect(start.searchParams.get('redirect_to')).toBe(LOGINWALL_RETURN);
      expect((await finalLoginScreen(start, { acceptLanguage: 'en' })).locale).toBe('pl');
    });
  });
});
