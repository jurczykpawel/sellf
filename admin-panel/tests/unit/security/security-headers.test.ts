import { describe, it, expect } from 'vitest';
import {
  buildBaseSecurityHeaders,
  buildApiSecurityHeaders,
  buildEmbeddableResourceHeaders,
  buildPublicCacheHeaders,
  EMBEDDABLE_RESOURCE_PATHS,
  EMBEDDABLE_PUBLIC_CACHE_PATHS,
} from '@/lib/security/headers';
import nextConfig from '../../../next.config';

/**
 * Security headers regression coverage. Browser isolation defaults
 * (COOP=same-origin, CORP=same-site) apply globally; embeddable script /
 * SDK endpoints relax CORP to cross-origin.
 */
describe('Security headers', () => {
  describe('buildBaseSecurityHeaders', () => {
    const headers = buildBaseSecurityHeaders();
    const headerMap = new Map(headers.map((h) => [h.key, h.value]));

    it('sets Cross-Origin-Opener-Policy to same-origin', () => {
      expect(headerMap.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    });

    it('sets Cross-Origin-Resource-Policy to same-site', () => {
      expect(headerMap.get('Cross-Origin-Resource-Policy')).toBe('same-site');
    });

    it('keeps existing protections (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)', () => {
      expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headerMap.get('X-Frame-Options')).toBe('SAMEORIGIN');
      expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('disables the legacy XSS Auditor (X-XSS-Protection: 0) — CSP is the real control', () => {
      expect(headerMap.get('X-XSS-Protection')).toBe('0');
    });

    it('does NOT emit a Content-Security-Policy here — middleware sets it per-request with a nonce', () => {
      expect(headerMap.has('Content-Security-Policy')).toBe(false);
    });
  });

  describe('buildEmbeddableResourceHeaders', () => {
    const headers = buildEmbeddableResourceHeaders();
    const headerMap = new Map(headers.map((h) => [h.key, h.value]));

    it('sets Cross-Origin-Resource-Policy to cross-origin for embeddable endpoints', () => {
      // sellf.js + runtime config + checkout embed loader must remain loadable from external origins.
      expect(headerMap.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    });

    it('does not lock these endpoints behind COOP same-origin (would break popup-based embeds)', () => {
      // We intentionally OMIT COOP on cross-origin embed targets; admin app keeps it.
      expect(headerMap.has('Cross-Origin-Opener-Policy')).toBe(false);
    });
  });

  describe('buildPublicCacheHeaders', () => {
    it('allows short public caching for JWKS, revocation lists, and loginwall loader scripts', () => {
      expect(buildPublicCacheHeaders()).toEqual([
        { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=300' },
      ]);
    });
  });

  describe('EMBEDDABLE_RESOURCE_PATHS', () => {
    it('contains the public runtime config + checkout embed loader', () => {
      expect(EMBEDDABLE_RESOURCE_PATHS).toContain('/embed/v1/checkout.js');
      expect(EMBEDDABLE_RESOURCE_PATHS).toContain('/api/runtime-config');
    });

    it('contains the login-wall and gating loader scripts (loaded via <script src> from seller pages)', () => {
      expect(EMBEDDABLE_RESOURCE_PATHS).toContain('/api/loginwall/login.js');
      expect(EMBEDDABLE_RESOURCE_PATHS).toContain('/api/loginwall/gate.js');
    });

    it('does NOT contain admin/auth/payment endpoints (would defeat CORP)', () => {
      expect(EMBEDDABLE_RESOURCE_PATHS).not.toContain('/api/v1/products');
      expect(EMBEDDABLE_RESOURCE_PATHS).not.toContain('/api/auth');
      expect(EMBEDDABLE_RESOURCE_PATHS).not.toContain('/api/webhooks/stripe');
      expect(EMBEDDABLE_RESOURCE_PATHS).not.toContain('/api/subscriptions');
    });
  });

  describe('EMBEDDABLE_PUBLIC_CACHE_PATHS', () => {
    it('is a subset of EMBEDDABLE_RESOURCE_PATHS (only paths that also need their cache reasserted)', () => {
      for (const path of EMBEDDABLE_PUBLIC_CACHE_PATHS) {
        expect(EMBEDDABLE_RESOURCE_PATHS).toContain(path);
      }
    });
  });

  describe('next.config.ts headers() resolved for a seller-embedded script', () => {
    /**
     * Models Next.js's documented behavior for `headers()` in next.config.ts:
     * rules are applied in array order and, for a given path, a later
     * matching rule overrides an earlier one for the same header key. This
     * is the exact mechanism the CORP override already relies on (see the
     * "Listed AFTER /api/:path*" comment in next.config.ts) — this test
     * extends the same model to Cache-Control, which used to lose to the
     * generic API no-store rule.
     */
    function resolveHeaders(rules: Array<{ source: string; headers: { key: string; value: string }[] }>, path: string) {
      const result = new Map<string, string>();
      for (const rule of rules) {
        const base = rule.source.endsWith('/:path*') ? rule.source.slice(0, -'/:path*'.length) : rule.source;
        const matches = rule.source === path || (rule.source.endsWith('/:path*') && path.startsWith(`${base}/`));
        if (!matches) continue;
        for (const header of rule.headers) result.set(header.key, header.value);
      }
      return result;
    }

    it('gives /api/loginwall/login.js both cross-origin CORP and its own public Cache-Control', async () => {
      const rules = await nextConfig.headers!();
      const resolved = resolveHeaders(rules as never, '/api/loginwall/login.js');

      expect(resolved.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
      expect(resolved.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
    });

    it('gives /api/loginwall/gate.js both cross-origin CORP and its own public Cache-Control', async () => {
      const rules = await nextConfig.headers!();
      const resolved = resolveHeaders(rules as never, '/api/loginwall/gate.js');

      expect(resolved.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
      expect(resolved.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
    });

    it('leaves unrelated API routes on the strict no-store default and same-site CORP', async () => {
      const rules = await nextConfig.headers!();
      const resolved = resolveHeaders(rules as never, '/api/v1/products');

      expect(resolved.get('Cache-Control')).toBe(buildApiSecurityHeaders().find((h) => h.key === 'Cache-Control')!.value);
      expect(resolved.get('Cross-Origin-Resource-Policy')).toBe('same-site');
    });
  });
});
