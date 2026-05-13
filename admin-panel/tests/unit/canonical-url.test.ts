import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { getCanonicalOrigin } from '@/lib/utils/canonical-url';

function makeRequest(origin: string): NextRequest {
  return { nextUrl: new URL(origin) } as NextRequest;
}

const ENV_KEYS_TO_RESET = ['SITE_URL', 'NEXT_PUBLIC_SITE_URL', 'MAIN_DOMAIN'] as const;

describe('getCanonicalOrigin', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS_TO_RESET) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS_TO_RESET) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  describe('SITE_URL env priority', () => {
    it('prefers SITE_URL over request origin', () => {
      process.env.SITE_URL = 'https://sellf.tojest.dev';
      expect(getCanonicalOrigin(makeRequest('http://localhost:3777'))).toBe(
        'https://sellf.tojest.dev',
      );
    });

    it('strips trailing slash from SITE_URL', () => {
      process.env.SITE_URL = 'https://sellf.tojest.dev/';
      expect(getCanonicalOrigin(makeRequest('http://localhost:3777'))).toBe(
        'https://sellf.tojest.dev',
      );
    });

    it('falls through SITE_URL → NEXT_PUBLIC_SITE_URL', () => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';
      expect(getCanonicalOrigin(makeRequest('http://localhost:3777'))).toBe(
        'https://app.example.com',
      );
    });

    it('falls through to MAIN_DOMAIN with https scheme', () => {
      process.env.MAIN_DOMAIN = 'sellf.tojest.dev';
      expect(getCanonicalOrigin(makeRequest('http://localhost:3777'))).toBe(
        'https://sellf.tojest.dev',
      );
    });

    it('uses http for MAIN_DOMAIN=localhost', () => {
      process.env.MAIN_DOMAIN = 'localhost:3000';
      expect(getCanonicalOrigin(makeRequest('http://localhost:3000'))).toBe(
        'http://localhost:3000',
      );
    });
  });

  describe('rejects bind-address origins (the hanna `[::]:3333` regression)', () => {
    it.each([
      'http://[::]:3333',
      'http://0.0.0.0:3000',
      'http://127.0.0.1:3000',
    ])('skips request origin %s when no env is set', (badOrigin) => {
      // No SITE_URL/NEXT_PUBLIC_SITE_URL/MAIN_DOMAIN → must throw, never leak.
      expect(() => getCanonicalOrigin(makeRequest(badOrigin))).toThrow(
        /Cannot determine canonical origin/i,
      );
    });

    it.each([
      'http://[::]:3333',
      'http://0.0.0.0:3000',
    ])('overrides request origin %s with SITE_URL', (badOrigin) => {
      process.env.SITE_URL = 'https://sellf.tojest.dev';
      expect(getCanonicalOrigin(makeRequest(badOrigin))).toBe(
        'https://sellf.tojest.dev',
      );
    });
  });

  describe('falls back to request origin when env is missing AND origin is sane', () => {
    it('accepts a normal public origin', () => {
      expect(getCanonicalOrigin(makeRequest('https://shop.example.com'))).toBe(
        'https://shop.example.com',
      );
    });

    it('rejects malformed SITE_URL and walks down the chain', () => {
      process.env.SITE_URL = 'not-a-url';
      process.env.NEXT_PUBLIC_SITE_URL = 'https://fallback.example.com';
      expect(getCanonicalOrigin(makeRequest('http://[::]:3333'))).toBe(
        'https://fallback.example.com',
      );
    });

    it('rejects non-http(s) schemes in env', () => {
      process.env.SITE_URL = 'ftp://files.example.com';
      process.env.MAIN_DOMAIN = 'sellf.tojest.dev';
      expect(getCanonicalOrigin(makeRequest('http://[::]:3333'))).toBe(
        'https://sellf.tojest.dev',
      );
    });
  });
});
