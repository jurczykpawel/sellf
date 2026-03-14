/**
 * Unit Tests: Marketplace Feature Flag
 *
 * Tests isMarketplaceEnabled and checkMarketplaceAccess (async, domain-aware).
 *
 * next/headers is mocked — domain resolved via SELLF_DOMAIN env var fallback
 * when headers() throws (simulates background-job / non-request context).
 *
 * Run: bunx vitest run tests/unit/marketplace/feature-flag.test.ts
 *
 * @see src/lib/marketplace/feature-flag.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ===== MOCKS =====

// Must use vi.hoisted() because vi.mock() is hoisted to top of file before variable declarations.
const { mockHeaders } = vi.hoisted(() => {
  const mockHeaders = vi.fn();
  return { mockHeaders };
});

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

// ===== IMPORT AFTER MOCKS =====

import {
  isMarketplaceEnabled,
  checkMarketplaceAccess,
} from '@/lib/marketplace/feature-flag';

// Valid test license key — generated with the real private key for domain "test.example.com"
// Verified: verifyLicenseSignature returns true for this key.
const VALID_LICENSE = 'SF-test.example.com-UNLIMITED-MEUCIEHqYzD3xj-ro61wuTmeBnXI7atQ3d_NWX6QcZUk05zrAiEA53-g5nGLU3_hR2OZfCeUruyVU3lY_57ZQbmO4obico8';

// ===== HELPERS =====

/** Make headers() return a Host header for the given domain */
function mockHost(host: string) {
  mockHeaders.mockResolvedValue({
    get: (name: string) => (name === 'host' ? host : null),
  });
}

/** Make headers() throw (simulates background job / non-request context) */
function mockNoRequest() {
  mockHeaders.mockRejectedValue(new Error('headers() called outside request context'));
}

// ===== TESTS =====

describe('isMarketplaceEnabled()', () => {
  const originalEnv = process.env;

  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('returns true when MARKETPLACE_ENABLED=true', () => {
    process.env.MARKETPLACE_ENABLED = 'true';
    expect(isMarketplaceEnabled()).toBe(true);
  });

  it('returns false when MARKETPLACE_ENABLED is not set', () => {
    delete process.env.MARKETPLACE_ENABLED;
    expect(isMarketplaceEnabled()).toBe(false);
  });

  it('returns false when MARKETPLACE_ENABLED=false', () => {
    process.env.MARKETPLACE_ENABLED = 'false';
    expect(isMarketplaceEnabled()).toBe(false);
  });

  it('returns false when MARKETPLACE_ENABLED=TRUE (case sensitive)', () => {
    process.env.MARKETPLACE_ENABLED = 'TRUE';
    expect(isMarketplaceEnabled()).toBe(false);
  });
});

describe('checkMarketplaceAccess()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ===== env flag =====

  it('not accessible when MARKETPLACE_ENABLED not set', async () => {
    mockHost('test.example.com');
    delete process.env.MARKETPLACE_ENABLED;
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.reason).toContain('not enabled');
  });

  it('demo mode bypasses license but NOT env flag', async () => {
    mockHost('test.example.com');
    delete process.env.MARKETPLACE_ENABLED;
    process.env.DEMO_MODE = 'true';
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(false);
    expect(result.enabled).toBe(false);
  });

  // ===== license + domain =====

  it('not accessible when enabled but no license key', async () => {
    mockHost('test.example.com');
    process.env.MARKETPLACE_ENABLED = 'true';
    delete process.env.DEMO_MODE;
    delete process.env.SELLF_LICENSE_KEY;
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(false);
    expect(result.enabled).toBe(true);
    expect(result.licensed).toBe(false);
    expect(result.reason).toContain('license');
  });

  it('accessible when enabled + demo mode (no license needed)', async () => {
    mockHost('any-domain.com');
    process.env.MARKETPLACE_ENABLED = 'true';
    process.env.DEMO_MODE = 'true';
    delete process.env.SELLF_LICENSE_KEY;
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(true);
    expect(result.licensed).toBe(true);
  });

  it('accessible when enabled + valid license + matching domain (from Host header)', async () => {
    mockHost('test.example.com');
    process.env.MARKETPLACE_ENABLED = 'true';
    delete process.env.DEMO_MODE;
    process.env.SELLF_LICENSE_KEY = VALID_LICENSE;
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(true);
    expect(result.licensed).toBe(true);
  });

  it('accessible when enabled + valid license + matching domain (from SELLF_DOMAIN fallback)', async () => {
    mockNoRequest(); // headers() throws — no active request
    process.env.MARKETPLACE_ENABLED = 'true';
    delete process.env.DEMO_MODE;
    process.env.SELLF_LICENSE_KEY = VALID_LICENSE;
    process.env.SELLF_DOMAIN = 'test.example.com';
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(true);
    expect(result.licensed).toBe(true);
  });

  it('NOT accessible when domain does not match license', async () => {
    mockHost('wrong-domain.com');
    process.env.MARKETPLACE_ENABLED = 'true';
    delete process.env.DEMO_MODE;
    process.env.SELLF_LICENSE_KEY = VALID_LICENSE; // issued for test.example.com
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(false);
    expect(result.licensed).toBe(false);
  });

  it('NOT accessible when domain cannot be resolved (fail secure)', async () => {
    mockNoRequest(); // headers() throws
    process.env.MARKETPLACE_ENABLED = 'true';
    delete process.env.DEMO_MODE;
    delete process.env.SELLF_DOMAIN;
    process.env.SELLF_LICENSE_KEY = VALID_LICENSE;
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(false);
    expect(result.licensed).toBe(false);
  });

  it('strips port from Host header before matching domain', async () => {
    mockHost('test.example.com:3000'); // localhost-style with port
    process.env.MARKETPLACE_ENABLED = 'true';
    delete process.env.DEMO_MODE;
    process.env.SELLF_LICENSE_KEY = VALID_LICENSE; // issued for test.example.com
    const result = await checkMarketplaceAccess();
    expect(result.accessible).toBe(true);
  });
});
