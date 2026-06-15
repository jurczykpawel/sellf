import { describe, it, expect } from 'vitest';
import {
  buildBaseSecurityHeaders,
  buildEmbeddableResourceHeaders,
  buildPublicLicenseCacheHeaders,
  EMBEDDABLE_RESOURCE_PATHS,
} from '@/lib/security/headers';

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

  describe('buildPublicLicenseCacheHeaders', () => {
    it('allows short public caching for JWKS and revocation lists', () => {
      expect(buildPublicLicenseCacheHeaders()).toEqual([
        { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=300' },
      ]);
    });
  });

  describe('EMBEDDABLE_RESOURCE_PATHS', () => {
    it('contains the public runtime config + checkout embed loader', () => {
      expect(EMBEDDABLE_RESOURCE_PATHS).toContain('/embed/v1/checkout.js');
      expect(EMBEDDABLE_RESOURCE_PATHS).toContain('/api/runtime-config');
    });

    it('does NOT contain admin/auth/payment endpoints (would defeat CORP)', () => {
      expect(EMBEDDABLE_RESOURCE_PATHS).not.toContain('/api/v1/products');
      expect(EMBEDDABLE_RESOURCE_PATHS).not.toContain('/api/auth');
      expect(EMBEDDABLE_RESOURCE_PATHS).not.toContain('/api/webhooks/stripe');
      expect(EMBEDDABLE_RESOURCE_PATHS).not.toContain('/api/subscriptions');
    });
  });
});
