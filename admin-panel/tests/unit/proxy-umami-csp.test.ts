/**
 * The proxy adds the configured Umami analytics origin to `connect-src` so the
 * cookieless tracker's `/api/send` beacon is not blocked by the CSP.
 *
 * Regression: the origin was resolved with a service-role raw select on
 * `integrations_config`, but SUPABASE_SERVICE_ROLE_KEY is not injected into the
 * proxy (edge) runtime on standalone deploys, so the select silently returned
 * nothing and the origin never reached the CSP. The resolver now calls the
 * PUBLIC `get_public_integrations_config` RPC with the anon key — the same
 * credential the auth gate already uses in this runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// next-intl ESM is heavy and irrelevant here; stub the matcher.
vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { status: 200 }),
}));

function makeRequest(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function getConnectSrc(csp: string | null): string {
  if (!csp) return '';
  return csp.split(';').find((d) => d.trim().startsWith('connect-src')) ?? '';
}

describe('proxy CSP — Umami connect-src', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('adds the Umami origin via the anon-key public RPC (not a service-role select)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key');

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      // Must call the PUBLIC RPC, authorised with the anon key — never the
      // service-role raw select that fails in the edge runtime.
      expect(u).toContain('/rest/v1/rpc/get_public_integrations_config');
      const headers = new Headers(init?.headers);
      expect(headers.get('apikey')).toBe('anon-test-key');
      return new Response(
        JSON.stringify({ umami_script_url: 'https://stats.example.com/script.js' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { proxy } = await import('@/proxy');
    const res = await proxy(makeRequest('/checkout/test'));

    const connectSrc = getConnectSrc(res.headers.get('Content-Security-Policy'));
    expect(connectSrc).toContain('https://stats.example.com');
    expect(connectSrc).not.toContain('/script.js'); // origin only, not the path
    expect(fetchMock).toHaveBeenCalled();
  });

  it('omits the Umami origin (no crash) when the RPC has no script url', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ umami_script_url: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const { proxy } = await import('@/proxy');
    const res = await proxy(makeRequest('/checkout/test'));

    const connectSrc = getConnectSrc(res.headers.get('Content-Security-Policy'));
    expect(connectSrc).toContain("connect-src 'self'");
    expect(connectSrc).not.toContain('stats.example.com');
  });

  it('does not fetch when Supabase env is absent (no network, empty origin)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { proxy } = await import('@/proxy');
    const res = await proxy(makeRequest('/checkout/test'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers.get('Content-Security-Policy')).toContain("connect-src 'self'");
  });
});
