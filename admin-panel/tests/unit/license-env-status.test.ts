import { describe, expect, it } from 'vitest';

import { signLicense, type LicenseClaims } from '@/lib/license-keys/format';
import { generateSellerKeypair } from '@/lib/license-keys/keys';
import { getEnvLicenseStatus } from '@/lib/license/env-status';

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

describe('getEnvLicenseStatus', () => {
  const options = { keys, now: NOW };

  it('returns not_configured when env key is missing', async () => {
    await expect(getEnvLicenseStatus(undefined, 'example.com', options)).resolves.toMatchObject({
      configured: false,
      valid: false,
      reason: 'not_configured',
      tier: null,
    });
  });

  it('returns no_platform_domain when the platform host is missing', async () => {
    await expect(getEnvLicenseStatus(token(), null, options)).resolves.toMatchObject({
      configured: true,
      valid: false,
      reason: 'no_platform_domain',
    });
  });

  it('marks a valid product token for a subdomain as valid', async () => {
    await expect(getEnvLicenseStatus(token(), 'app.example.com', options)).resolves.toMatchObject({
      configured: true,
      valid: true,
      reason: 'valid',
      tier: 'pro',
      domain: 'example.com',
      expiry: null,
      domainMatch: true,
    });
  });

  it('reports domain mismatch', async () => {
    await expect(getEnvLicenseStatus(token(), 'other.test', options)).resolves.toMatchObject({
      valid: false,
      reason: 'domain_mismatch',
      domain: 'example.com',
    });
  });

  it('reports expiration', async () => {
    await expect(getEnvLicenseStatus(token({ exp: nowSec - 1 }), 'example.com', options)).resolves.toMatchObject({
      valid: false,
      reason: 'expired',
      isExpired: true,
    });
  });

  it('rejects the retired activation-key shape as invalid format', async () => {
    await expect(getEnvLicenseStatus('legacy-activation-key', 'example.com', options)).resolves.toMatchObject({
      valid: false,
      reason: 'invalid_format',
    });
  });
});
