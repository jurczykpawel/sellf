/**
 * The proxy adds the configured analytics origins to the CSP so the cookieless
 * Umami beacon and the server-side GTM transport are not blocked:
 *   - Umami origin            → connect-src (the `/api/send` beacon)
 *   - sGTM (gtm_server_container_url) → connect-src (`/g/collect`) + frame-src
 *     (the sGTM service-worker iframe GTM injects)
 *
 * Regressions covered:
 *   - origins resolved with a service-role raw select returned nothing because
 *     SUPABASE_SERVICE_ROLE_KEY isn't in the proxy bundle → use the anon-key RPC.
 *   - reading NEXT_PUBLIC_SUPABASE_URL first pointed the fetch at the build-time
 *     placeholder (`https://placeholder.supabase.co`) → read SUPABASE_URL first.
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

function directive(csp: string | null, name: string): string {
  if (!csp) return '';
  return csp.split(';').find((d) => d.trim().startsWith(name)) ?? '';
}

describe('proxy CSP — analytics origins (Umami + sGTM)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('adds Umami to connect-src and sGTM to connect-src + frame-src via the anon-key RPC', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key');

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      expect(u).toContain('/rest/v1/rpc/get_public_integrations_config');
      const headers = new Headers(init?.headers);
      expect(headers.get('apikey')).toBe('anon-test-key');
      return new Response(
        JSON.stringify({
          umami_script_url: 'https://stats.example.com/script.js',
          gtm_server_container_url: 'https://sgtm.example.com',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { proxy } = await import('@/proxy');
    const res = await proxy(makeRequest('/checkout/test'));
    const csp = res.headers.get('Content-Security-Policy');

    const connect = directive(csp, 'connect-src');
    expect(connect).toContain('https://stats.example.com');
    expect(connect).toContain('https://sgtm.example.com');
    expect(connect).not.toContain('/script.js'); // origin only, not the path

    const frame = directive(csp, 'frame-src');
    expect(frame).toContain('https://sgtm.example.com');
    expect(frame).not.toContain('https://stats.example.com'); // Umami is not framed
    expect(fetchMock).toHaveBeenCalled();
  });

  it('prefers the runtime SUPABASE_URL over the build-inlined NEXT_PUBLIC placeholder', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://real-project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://placeholder.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key');

    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      expect(u).toContain('https://real-project.supabase.co');
      expect(u).not.toContain('placeholder.supabase.co');
      return new Response(
        JSON.stringify({ umami_script_url: 'https://stats.example.com/script.js' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { proxy } = await import('@/proxy');
    const res = await proxy(makeRequest('/checkout/test'));
    expect(directive(res.headers.get('Content-Security-Policy'), 'connect-src')).toContain(
      'https://stats.example.com',
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('omits analytics origins (no crash) when the RPC returns no urls', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ umami_script_url: null, gtm_server_container_url: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const { proxy } = await import('@/proxy');
    const res = await proxy(makeRequest('/checkout/test'));
    const csp = res.headers.get('Content-Security-Policy');
    expect(directive(csp, 'connect-src')).toContain("connect-src 'self'");
    expect(directive(csp, 'connect-src')).not.toContain('example.com');
    expect(directive(csp, 'frame-src')).not.toContain('example.com');
  });

  it('does not fetch when Supabase env is absent (no network, empty origins)', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { proxy } = await import('@/proxy');
    const res = await proxy(makeRequest('/checkout/test'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(directive(res.headers.get('Content-Security-Policy'), 'connect-src')).toContain(
      "connect-src 'self'",
    );
  });
});
