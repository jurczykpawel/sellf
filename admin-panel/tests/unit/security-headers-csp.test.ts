/**
 * CSP builder contract.
 *
 * The middleware (`src/proxy.ts`) attaches a per-request CSP header so each
 * inline <Script> can be authorized via a fresh nonce instead of a blanket
 * `'unsafe-inline'`. These tests pin the builder shape so a future edit
 * cannot silently re-introduce `'unsafe-inline'` for `script-src` in
 * production.
 */
import { describe, it, expect } from 'vitest';
import {
  buildContentSecurityPolicyWithNonce,
  buildBaseSecurityHeaders,
} from '@/lib/security/headers';

describe('CSP with nonce — production posture', () => {
  const nonce = 'NONCE_VALUE_FOR_TEST';
  const csp = buildContentSecurityPolicyWithNonce(nonce, { isDev: false });

  it('contains the supplied nonce token in script-src', () => {
    expect(csp).toMatch(new RegExp(`script-src[^;]*'nonce-${nonce}'`));
  });

  it('uses strict-dynamic so nonced scripts can transitively load loaders (gtm, klaro)', () => {
    expect(csp).toMatch(/script-src[^;]*'strict-dynamic'/);
  });

  it("locks frame-ancestors to 'self' so other origins cannot iframe the app", () => {
    expect(csp).toMatch(/frame-ancestors 'self'/);
  });

  it('does NOT contain unsafe-inline in script-src', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('does NOT contain unsafe-eval in script-src in production', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('preserves the third-party script allow-list (stripe, cloudflare, youtube)', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain('js.stripe.com');
    expect(scriptSrc).toContain('challenges.cloudflare.com');
    expect(scriptSrc).toContain('www.youtube.com');
  });

  it('does NOT allow third-party script CDNs that would expand the supply-chain surface', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain('cdn.jsdelivr.net');
    expect(scriptSrc).not.toContain('unpkg.com');
  });

  it('allows Playerstack media sources and Bunny streams without an https: wildcard', () => {
    const mediaSrc = csp.split(';').find((d) => d.trim().startsWith('media-src')) ?? '';
    expect(mediaSrc).toContain("'self'");
    expect(mediaSrc).toContain('blob:');
    expect(mediaSrc).toContain('*.b-cdn.net');
    expect(mediaSrc).not.toMatch(/\bhttps:\B|\bhttps:\s/);
    expect(csp).toMatch(/object-src 'none'/);
  });

  it('keeps style-src unsafe-inline (Tailwind v4 critical CSS)', () => {
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
  });
});

describe('CSP with nonce — development posture', () => {
  const csp = buildContentSecurityPolicyWithNonce('DEV_NONCE', { isDev: true });

  it('keeps unsafe-eval in script-src for dev tooling (Next.js HMR, Turbopack)', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain("'unsafe-eval'");
  });

  it('still drops unsafe-inline even in dev — nonce is enough', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('localhost connect-src entries appear', () => {
    expect(csp).toMatch(/connect-src[^;]*127\.0\.0\.1/);
  });
});

describe('Static base headers no longer carry CSP', () => {
  // CSP is per-request; setting it statically in next.config.ts would
  // race with the middleware-set value and could win in some Next.js
  // versions, silently re-introducing 'unsafe-inline'.
  const headers = buildBaseSecurityHeaders();
  const keys = headers.map((h) => h.key.toLowerCase());

  it('keeps the COOP / CORP / nosniff / frame headers', () => {
    expect(keys).toContain('cross-origin-opener-policy');
    expect(keys).toContain('cross-origin-resource-policy');
    expect(keys).toContain('x-content-type-options');
    expect(keys).toContain('x-frame-options');
  });

  it('does NOT include Content-Security-Policy (middleware owns it)', () => {
    expect(keys).not.toContain('content-security-policy');
  });
});
