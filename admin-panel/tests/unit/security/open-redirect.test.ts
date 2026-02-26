import { describe, it, expect } from 'vitest';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';

/**
 * ============================================================================
 * SECURITY TEST: Open Redirect Prevention
 * ============================================================================
 *
 * Tests the PRODUCTION isSafeRedirectUrl() from @/lib/validations/redirect.ts
 * which is used by:
 *   - src/app/payment/success/page.tsx (success_url param)
 *   - src/app/[locale]/auth/product-access/route.ts (return_url param)
 *
 * Created during security audit (2026-01-08)
 * Fixed to import from production code (2026-02-24)
 * ============================================================================
 */

describe('Open Redirect Prevention', () => {
  const SITE_URL = 'https://gateflow.com';

  describe('Relative Paths', () => {
    it('should allow simple relative paths', () => {
      expect(isSafeRedirectUrl('/dashboard', SITE_URL)).toBe(true);
      expect(isSafeRedirectUrl('/p/my-product', SITE_URL)).toBe(true);
      expect(isSafeRedirectUrl('/auth/callback', SITE_URL)).toBe(true);
    });

    it('should allow relative paths with query strings', () => {
      expect(isSafeRedirectUrl('/dashboard?tab=settings', SITE_URL)).toBe(true);
      expect(isSafeRedirectUrl('/p/product?ref=email', SITE_URL)).toBe(true);
    });

    it('should allow relative paths with hash fragments', () => {
      expect(isSafeRedirectUrl('/docs#section-1', SITE_URL)).toBe(true);
      expect(isSafeRedirectUrl('/p/product#reviews', SITE_URL)).toBe(true);
    });

    it('should BLOCK protocol-relative URLs (//evil.com)', () => {
      expect(isSafeRedirectUrl('//evil.com', SITE_URL)).toBe(false);
      expect(isSafeRedirectUrl('//evil.com/path', SITE_URL)).toBe(false);
      expect(isSafeRedirectUrl('///evil.com', SITE_URL)).toBe(false);
    });
  });

  describe('Absolute URLs - Same Origin', () => {
    it('should allow same-origin HTTPS URLs', () => {
      expect(isSafeRedirectUrl('https://gateflow.com/dashboard', SITE_URL)).toBe(true);
      expect(isSafeRedirectUrl('https://gateflow.com/p/product', SITE_URL)).toBe(true);
    });

    it('should allow same-origin with path and query', () => {
      expect(isSafeRedirectUrl('https://gateflow.com/dashboard?tab=1', SITE_URL)).toBe(true);
    });
  });

  describe('Absolute URLs - Different Origin (BLOCKED)', () => {
    it('should BLOCK external domains', () => {
      expect(isSafeRedirectUrl('https://evil.com', SITE_URL)).toBe(false);
      expect(isSafeRedirectUrl('https://attacker.com/phishing', SITE_URL)).toBe(false);
      expect(isSafeRedirectUrl('https://gateflow.com.evil.com', SITE_URL)).toBe(false);
    });

    it('should BLOCK different subdomains', () => {
      expect(isSafeRedirectUrl('https://admin.gateflow.com', SITE_URL)).toBe(false);
      expect(isSafeRedirectUrl('https://api.gateflow.com', SITE_URL)).toBe(false);
    });

    it('should BLOCK different protocols', () => {
      expect(isSafeRedirectUrl('http://gateflow.com/dashboard', SITE_URL)).toBe(false);
    });

    it('should BLOCK different ports', () => {
      expect(isSafeRedirectUrl('https://gateflow.com:8080/dashboard', SITE_URL)).toBe(false);
    });
  });

  describe('Attack Payloads', () => {
    it('should block common open redirect payloads', () => {
      const payloads = [
        'https://evil.com',
        '//evil.com',
        '///evil.com',
        'https://gateflow.com@evil.com',
        'https://evil.com?gateflow.com',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        '//evil.com/%2f..',
      ];

      for (const payload of payloads) {
        expect(isSafeRedirectUrl(payload, SITE_URL)).toBe(false);
      }
    });

    it('should BLOCK backslash bypass (/\\evil.com → //evil.com)', () => {
      expect(isSafeRedirectUrl('/\\evil.com', SITE_URL)).toBe(false);
      expect(isSafeRedirectUrl('/\\\\evil.com', SITE_URL)).toBe(false);
      expect(isSafeRedirectUrl('/\\evil.com/path', SITE_URL)).toBe(false);
    });

    it('should block URL-encoded bypass attempts', () => {
      const payloads = [
        '%2f%2fevil.com',
        '/%2fevil.com',
      ];

      for (const payload of payloads) {
        const decoded = decodeURIComponent(payload);
        expect(isSafeRedirectUrl(decoded, SITE_URL)).toBe(false);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty siteUrl (only allow relative)', () => {
      expect(isSafeRedirectUrl('/dashboard')).toBe(true);
      expect(isSafeRedirectUrl('https://any.com')).toBe(false);
    });

    it('should handle invalid URLs gracefully', () => {
      expect(isSafeRedirectUrl('not-a-url', SITE_URL)).toBe(false);
      expect(isSafeRedirectUrl('', SITE_URL)).toBe(false);
    });

    it('should handle SITE_URL with trailing slash', () => {
      const siteWithSlash = 'https://gateflow.com/';
      expect(isSafeRedirectUrl('https://gateflow.com/dashboard', siteWithSlash)).toBe(true);
    });

    it('should handle localhost in development', () => {
      const localSite = 'http://localhost:3000';
      expect(isSafeRedirectUrl('http://localhost:3000/dashboard', localSite)).toBe(true);
      expect(isSafeRedirectUrl('http://localhost:3001/dashboard', localSite)).toBe(false);
    });
  });

});
