import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signLicense, type LicenseClaims } from '@/lib/license-keys/format';
import { generateSellerKeypair } from '@/lib/license-keys/keys';
import { resolveCurrentTier, verifyPlatformLicenseToken } from '@/lib/license/resolve';

const key = generateSellerKeypair();
const NOW = new Date('2026-06-14T12:00:00.000Z');
const nowSec = Math.floor(NOW.getTime() / 1000);
const keys = [{ kid: key.kid, alg: 'ES256', pem: key.publicKeyPem }];

function token(overrides: Partial<LicenseClaims> = {}): string {
  return signLicense({
    v: 1,
    kid: key.kid,
    product: 'sellf-pro',
    email: 'owner@example.com',
    order: 'order-1',
    tier: 'pro',
    iat: nowSec,
    exp: null,
    domain: 'example.com',
    ...overrides,
  }, key.privateKeyPem);
}

function dbWith(license: string | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve({ data: { sellf_license: license }, error: null }),
  };
  return { from: () => chain };
}

describe('product-token platform license resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, SITE_URL: 'https://app.example.com' };
    delete process.env.DEMO_MODE;
    delete process.env.E2E_MODE;
    delete process.env.SELLF_LICENSE_KEY;
    delete process.env.SELLF_LICENSE_PRODUCTS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves a signed allowed product for the bound domain', async () => {
    await expect(resolveCurrentTier({ dataClient: dbWith(token()), keys, now: NOW })).resolves.toBe('pro');
  });

  it.each([
    ['sellf-registered', 'registered', 'registered'],
    ['sellf-pro', 'pro', 'pro'],
    ['sellf-business', 'business', 'business'],
  ])('accepts the official %s tier product by default (no SELLF_LICENSE_PRODUCTS env)', async (product, tier, expected) => {
    const license = token({ product, tier });
    await expect(resolveCurrentTier({ dataClient: dbWith(license), keys, now: NOW })).resolves.toBe(expected);
  });

  it.each([
    ['wrong domain', token({ domain: 'other.example.com' })],
    ['missing domain', token({ domain: undefined })],
    ['expired', token({ exp: nowSec - 1 })],
    ['disallowed product', token({ product: 'replystack' })],
    ['unknown tier', token({ tier: 'enterprise' })],
  ])('fails closed for %s', async (_name, license) => {
    await expect(resolveCurrentTier({ dataClient: dbWith(license), keys, now: NOW })).resolves.toBe('free');
  });

  it('fails closed when the platform domain is unknown', async () => {
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.MAIN_DOMAIN;
    await expect(resolveCurrentTier({ dataClient: dbWith(token()), keys, now: NOW })).resolves.toBe('free');
  });

  it('rejects the retired activation-key shape', async () => {
    await expect(resolveCurrentTier({ dataClient: dbWith('legacy-activation-key'), keys, now: NOW })).resolves.toBe('free');
  });

  it('returns structured verification details for settings UI', async () => {
    await expect(verifyPlatformLicenseToken(token(), 'app.example.com', { keys, now: NOW })).resolves.toMatchObject({
      valid: true,
      tier: 'pro',
      domain: 'example.com',
      expiry: null,
    });
  });

  it('does not expose claims from a token with an invalid signature', async () => {
    const [payload] = token().split('.');
    await expect(verifyPlatformLicenseToken(`${payload}.invalid`, 'app.example.com', { keys, now: NOW })).resolves.toEqual({
      valid: false,
      reason: 'signature',
      tier: null,
      domain: null,
      expiry: null,
    });
  });

  it('keeps demo mode at business tier', async () => {
    process.env.DEMO_MODE = 'true';
    await expect(resolveCurrentTier({ dataClient: dbWith(null), keys, now: NOW })).resolves.toBe('business');
  });

  it('enables licensed features in explicit E2E mode', async () => {
    process.env.E2E_MODE = 'true';
    await expect(resolveCurrentTier({ dataClient: dbWith(null), keys, now: NOW })).resolves.toBe('business');
  });

  it('IGNORES DEMO_MODE / E2E_MODE in a production build (no free unlock for self-hosters)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = 'true';
    process.env.E2E_MODE = 'true';
    // No DB token and no env token: the flags must NOT grant business in production.
    await expect(resolveCurrentTier({ dataClient: dbWith(null), keys, now: NOW })).resolves.toBe('free');
  });
});
