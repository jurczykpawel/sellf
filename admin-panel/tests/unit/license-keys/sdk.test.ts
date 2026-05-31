import { describe, it, expect } from 'vitest';

import { generateSellerKeypair } from '@/lib/license-keys/keys';
import { signLicense, type LicenseClaims } from '@/lib/license-keys/format';
import { verifySellfLicense } from '@/lib/license-keys/sdk';

const key = generateSellerKeypair();
const NOW = new Date(2000 * 1000);
const jwks = [{ kid: key.kid, alg: 'ES256', pem: key.publicKeyPem }];
const claims: LicenseClaims = { v: 1, kid: key.kid, product: 'pro-kit', email: 'a@b.co', order: 'o1', tier: 'pro', iat: 1000, exp: null };

describe('verifySellfLicense (SDK)', () => {
  it('verifies a token by selecting the matching kid from the key set', () => {
    const r = verifySellfLicense(signLicense(claims, key.privateKeyPem), { keys: jwks, now: NOW });
    expect(r).toMatchObject({ valid: true, claims: { product: 'pro-kit', tier: 'pro' } });
  });

  it('rejects when no key matches the token kid', () => {
    const other = generateSellerKeypair();
    const r = verifySellfLicense(signLicense({ ...claims, kid: other.kid }, other.privateKeyPem), { keys: jwks, now: NOW });
    expect(r.valid).toBe(false);
  });

  it('rejects a token whose signature does not match', () => {
    const tok = signLicense(claims, key.privateKeyPem);
    const evil = Buffer.from(JSON.stringify({ ...claims, tier: 'business' })).toString('base64url') + '.' + tok.split('.')[1];
    expect(verifySellfLicense(evil, { keys: jwks, now: NOW })).toEqual({ valid: false, reason: 'signature' });
  });

  it('rejects an expired token', () => {
    const r = verifySellfLicense(signLicense({ ...claims, exp: 1500 }, key.privateKeyPem), { keys: jwks, now: NOW });
    expect(r).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects malformed / empty key set', () => {
    expect(verifySellfLicense('garbage', { keys: jwks, now: NOW }).valid).toBe(false);
    expect(verifySellfLicense(signLicense(claims, key.privateKeyPem), { keys: [], now: NOW }).valid).toBe(false);
  });
});
