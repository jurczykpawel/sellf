import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateCrossOriginRequest,
  getCrossOriginHeaders,
  getRestrictiveHeaders,
  createCrossOriginOptionsResponse,
  CROSS_ORIGIN_ALLOWED_PATHS
} from '@/lib/cors';

/**
 * Security Tests: CORS/CSRF Protection
 *
 * These tests verify that cross-origin request handling is secure
 * and prevents CSRF attacks.
 */
describe('CORS/CSRF Security', () => {
  // Helper to create mock Request
  function createMockRequest(options: {
    origin?: string | null;
    xRequestedWith?: string | null;
    method?: string;
  } = {}): Request {
    const headers = new Headers();
    if (options.origin !== undefined) {
      if (options.origin !== null) {
        headers.set('origin', options.origin);
      }
    }
    if (options.xRequestedWith !== undefined) {
      if (options.xRequestedWith !== null) {
        headers.set('X-Requested-With', options.xRequestedWith);
      }
    }
    return {
      headers,
      method: options.method || 'POST',
    } as Request;
  }

  describe('CROSS_ORIGIN_ALLOWED_PATHS', () => {
    it('should only contain read-only endpoints', () => {
      // These paths should ONLY be endpoints that:
      // 1. Do not modify data (read-only)
      // 2. Return non-sensitive information
      expect(CROSS_ORIGIN_ALLOWED_PATHS).toContain('/api/access');
      expect(CROSS_ORIGIN_ALLOWED_PATHS).toContain('/api/sellf');

      // Should NOT contain admin endpoints
      expect(CROSS_ORIGIN_ALLOWED_PATHS).not.toContain('/api/v1/products');
      expect(CROSS_ORIGIN_ALLOWED_PATHS).not.toContain('/api/users');
      expect(CROSS_ORIGIN_ALLOWED_PATHS).not.toContain('/api/webhooks');
    });

    it('should have a limited number of allowed paths', () => {
      // Principle of least privilege - minimize cross-origin access
      expect(CROSS_ORIGIN_ALLOWED_PATHS.length).toBeLessThanOrEqual(5);
    });
  });

  describe('validateCrossOriginRequest', () => {
    it('should reject requests without X-Requested-With header', () => {
      const request = createMockRequest({
        origin: 'https://evil.com',
        xRequestedWith: null,
      });

      const result = validateCrossOriginRequest(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it('should reject requests with wrong X-Requested-With value', () => {
      const request = createMockRequest({
        origin: 'https://evil.com',
        xRequestedWith: 'fetch', // Not XMLHttpRequest
      });

      const result = validateCrossOriginRequest(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it('should accept requests with valid X-Requested-With header', () => {
      const request = createMockRequest({
        origin: 'https://trusted.com',
        xRequestedWith: 'XMLHttpRequest',
      });

      const result = validateCrossOriginRequest(request);

      expect(result).toBeNull(); // null means valid
    });

    // CSRF Attack scenarios
    describe('CSRF Attack Prevention', () => {
      it('should block simple form POST (no X-Requested-With)', () => {
        // Simulates: <form action="/api/access" method="POST">
        const request = createMockRequest({
          origin: 'https://attacker.com',
          xRequestedWith: null,
        });

        const result = validateCrossOriginRequest(request);
        expect(result?.status).toBe(403);
      });

      it('should block image/script tag attacks (no custom headers)', () => {
        // Simulates: <img src="/api/access?..."> or <script src="/api/access">
        // These cannot set custom headers
        const request = createMockRequest({
          origin: null, // No origin for some simple requests
          xRequestedWith: null,
        });

        const result = validateCrossOriginRequest(request);
        expect(result?.status).toBe(403);
      });

      it('should allow legitimate AJAX requests', () => {
        // Simulates: $.ajax() or fetch with X-Requested-With
        const request = createMockRequest({
          origin: 'https://my-app.com',
          xRequestedWith: 'XMLHttpRequest',
        });

        const result = validateCrossOriginRequest(request);
        expect(result).toBeNull();
      });

      it('rejection response must not reflect an unverified Origin with credentials', async () => {
        const request = createMockRequest({
          origin: 'https://attacker.example',
          xRequestedWith: null,
        });

        const result = validateCrossOriginRequest(request);
        expect(result?.status).toBe(403);

        const allowOrigin = result?.headers.get('Access-Control-Allow-Origin');
        expect(allowOrigin).not.toBe('https://attacker.example');
      });
    });
  });

  describe('getCrossOriginHeaders', () => {
    it('should reflect whitelisted origin', () => {
      vi.stubEnv('ALLOWED_ORIGINS', 'https://my-app.com');
      const request = createMockRequest({
        origin: 'https://my-app.com',
      });

      const headers = getCrossOriginHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).toBe('https://my-app.com');
    });

    it('should reject unknown origin (secure by default)', () => {
      const request = createMockRequest({
        origin: 'https://evil.com',
      });

      const headers = getCrossOriginHeaders(request);

      // Falls back to SITE_URL, not the attacker's origin
      expect(headers['Access-Control-Allow-Origin']).not.toBe('https://evil.com');
    });

    it('should include credentials header', () => {
      const request = createMockRequest({
        origin: 'https://my-app.com',
      });

      const headers = getCrossOriginHeaders(request);

      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('should require X-Requested-With in allowed headers', () => {
      const request = createMockRequest({
        origin: 'https://my-app.com',
      });

      const headers = getCrossOriginHeaders(request);

      expect(headers['Access-Control-Allow-Headers']).toContain('X-Requested-With');
    });

    // Security concern: wildcard fallback
    describe('Wildcard Origin Handling', () => {
      it('should fall back to site URL when no origin provided', () => {
        // When no origin header is present, fall back to SITE_URL
        // instead of '*' (which is invalid with credentials anyway)
        const request = createMockRequest({
          origin: null,
        });

        const headers = getCrossOriginHeaders(request);

        // Should use NEXT_PUBLIC_SITE_URL or SITE_URL, not '*'
        expect(headers['Access-Control-Allow-Origin']).not.toBe('*');
        expect(typeof headers['Access-Control-Allow-Origin']).toBe('string');
        expect(headers['Access-Control-Allow-Origin'].length).toBeGreaterThan(0);
      });

      it('should not expose sensitive data via wildcard', () => {
        // Verify that endpoints using getCrossOriginHeaders
        // are read-only and non-sensitive
        // This is a documentation/awareness test
        const nonSensitiveEndpoints = ['/api/access', '/api/sellf'];

        expect(CROSS_ORIGIN_ALLOWED_PATHS.length).toBeGreaterThan(0);
        for (const endpoint of CROSS_ORIGIN_ALLOWED_PATHS) {
          expect(nonSensitiveEndpoints).toContain(endpoint);
        }
      });
    });
  });

  describe('getRestrictiveHeaders', () => {
    it('should NOT include credentials header', () => {
      const headers = getRestrictiveHeaders();

      // Critical: no credentials should be allowed for admin endpoints
      expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    });

    it('should use SITE_URL origin instead of wildcard', () => {
      const headers = getRestrictiveHeaders();

      // Should use SITE_URL, never wildcard — even without credentials
      expect(headers['Access-Control-Allow-Origin']).not.toBe('*');
      // Falls back to 'null' when SITE_URL is not set (blocks all cross-origin)
      expect(typeof headers['Access-Control-Allow-Origin']).toBe('string');
    });

    it('should allow necessary methods', () => {
      const headers = getRestrictiveHeaders();

      expect(headers['Access-Control-Allow-Methods']).toContain('GET');
      expect(headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(headers['Access-Control-Allow-Methods']).toContain('PUT');
      expect(headers['Access-Control-Allow-Methods']).toContain('DELETE');
    });
  });

  describe('createCrossOriginOptionsResponse', () => {
    it('should return 200 status', () => {
      const request = createMockRequest({
        origin: 'https://my-app.com',
      });

      const response = createCrossOriginOptionsResponse(request);

      expect(response.status).toBe(200);
    });

    it('should include CORS headers for whitelisted origin', () => {
      vi.stubEnv('ALLOWED_ORIGINS', 'https://my-app.com');
      const request = createMockRequest({
        origin: 'https://my-app.com',
      });

      const response = createCrossOriginOptionsResponse(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://my-app.com');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
  });

  describe('Integration: End-to-End CORS/CSRF Scenarios', () => {
    it('should protect against reflected origin CORS vulnerability', () => {
      // Attack: Attacker sets origin to arbitrary domain, hoping it's reflected
      const maliciousOrigins = [
        'https://evil.com',
        'https://attacker.example.com',
        'null', // Some browsers send this
        '', // Empty string
      ];

      for (const origin of maliciousOrigins) {
        const request = createMockRequest({
          origin: origin || null,
          xRequestedWith: null, // No custom header
        });

        // The X-Requested-With check should block this
        const result = validateCrossOriginRequest(request);
        expect(result?.status).toBe(403);
      }
    });

    it('should handle preflight + actual request flow', () => {
      const origin = 'https://legitimate-app.com';
      vi.stubEnv('ALLOWED_ORIGINS', origin);

      // 1. Preflight (OPTIONS)
      const preflightRequest = createMockRequest({
        origin,
        method: 'OPTIONS',
      });
      const preflightResponse = createCrossOriginOptionsResponse(preflightRequest);
      expect(preflightResponse.status).toBe(200);
      expect(preflightResponse.headers.get('Access-Control-Allow-Origin')).toBe(origin);

      // 2. Actual request (POST)
      const actualRequest = createMockRequest({
        origin,
        xRequestedWith: 'XMLHttpRequest',
        method: 'POST',
      });
      const validationResult = validateCrossOriginRequest(actualRequest);
      expect(validationResult).toBeNull(); // Should pass
    });

    it('should distinguish between admin and public endpoints', () => {
      // Public endpoints (cross-origin allowed)
      expect(CROSS_ORIGIN_ALLOWED_PATHS).toContain('/api/access');

      // Admin endpoints should NOT be in the allowed list
      const adminEndpoints = [
        '/api/admin',
        '/api/users',
        '/api/webhooks',
        '/api/stripe',
      ];

      for (const endpoint of adminEndpoints) {
        expect(CROSS_ORIGIN_ALLOWED_PATHS).not.toContain(endpoint);
      }
    });
  });

  describe('Security Headers Completeness', () => {
    it('getCrossOriginHeaders should include all necessary CORS headers with correct values', () => {
      vi.stubEnv('ALLOWED_ORIGINS', 'https://app.com');
      const request = createMockRequest({ origin: 'https://app.com' });
      const headers = getCrossOriginHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).toBe('https://app.com');
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
      expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
      expect(headers['Access-Control-Allow-Headers']).toContain('X-Requested-With');
      expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
      expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
    });

    it('should include caching header for preflight with numeric value', () => {
      const request = createMockRequest({ origin: 'https://app.com' });
      const headers = getCrossOriginHeaders(request);

      expect(headers['Access-Control-Max-Age']).toBe('86400');
    });

    it('should include Vary: Origin for correct caching', () => {
      const request = createMockRequest({ origin: 'https://app.com' });
      const headers = getCrossOriginHeaders(request);

      expect(headers['Vary']).toBe('Origin');
    });
  });

  describe('ALLOWED_ORIGINS strict mode', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should reflect origin when it is in the whitelist', () => {
      vi.stubEnv('ALLOWED_ORIGINS', 'https://app1.com, https://app2.com');
      const request = createMockRequest({ origin: 'https://app1.com' });
      const headers = getCrossOriginHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).toBe('https://app1.com');
    });

    it('should reject origin not in the whitelist', () => {
      vi.stubEnv('ALLOWED_ORIGINS', 'https://app1.com, https://app2.com');
      const request = createMockRequest({ origin: 'https://evil.com' });
      const headers = getCrossOriginHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).not.toBe('https://evil.com');
    });

    it('should fall back to siteUrl when origin not whitelisted', () => {
      vi.stubEnv('SITE_URL', 'https://mysite.com');
      vi.stubEnv('ALLOWED_ORIGINS', 'https://app1.com');
      const request = createMockRequest({ origin: 'https://evil.com' });
      const headers = getCrossOriginHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).toBe('https://mysite.com');
    });
  });
});
