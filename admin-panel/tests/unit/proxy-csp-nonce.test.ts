/**
 * End-to-end check that the middleware path attaches a per-request CSP
 * nonce. Calls the proxy function directly with a fabricated NextRequest
 * and asserts:
 *   - the response carries Content-Security-Policy with a `'nonce-...'`
 *     entry in script-src and no `'unsafe-inline'`
 *   - successive calls return different nonces (per-request, not a
 *     module-level constant)
 *   - HSTS still rides along on the same response
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

// next-intl ESM is heavy and not relevant to this test; stub the matcher.
vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { status: 200 }),
}));

function makeRequest(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function getScriptSrc(csp: string | null): string {
  if (!csp) return '';
  return csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
}

describe('proxy CSP nonce', () => {
  it('emits a Content-Security-Policy with a nonce token in script-src', async () => {
    const res = await proxy(makeRequest('/checkout/test'));
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    const scriptSrc = getScriptSrc(csp);
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9_-]+'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it('does not include unsafe-inline in script-src', async () => {
    const res = await proxy(makeRequest('/checkout/test'));
    const scriptSrc = getScriptSrc(res.headers.get('Content-Security-Policy'));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('generates a fresh nonce per request', async () => {
    const r1 = await proxy(makeRequest('/checkout/a'));
    const r2 = await proxy(makeRequest('/checkout/b'));
    const n1 = getScriptSrc(r1.headers.get('Content-Security-Policy')).match(/'nonce-([^']+)'/)?.[1];
    const n2 = getScriptSrc(r2.headers.get('Content-Security-Policy')).match(/'nonce-([^']+)'/)?.[1];
    expect(n1).toBeTruthy();
    expect(n2).toBeTruthy();
    expect(n1).not.toBe(n2);
  });

  it('also covers /api routes (CSP harmless on JSON, keeps coverage uniform)', async () => {
    const res = await proxy(makeRequest('/api/runtime-config'));
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(getScriptSrc(csp)).toMatch(/'nonce-[A-Za-z0-9_-]+'/);
  });

  it('keeps HSTS unless explicitly disabled', async () => {
    const res = await proxy(makeRequest('/checkout/test'));
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
  });
});
