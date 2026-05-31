import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

import { signLicense, verifyLicense, parseLicenseClaims, type LicenseClaims } from '@/lib/license-keys/format';

function pair() {
  return generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

const { publicKey, privateKey } = pair();
const NOW = new Date(2000 * 1000);
const base: LicenseClaims = { v: 1, kid: 'k1', product: 'pro-kit', email: 'a@b.co', order: 'ord_1', tier: 'pro', iat: 1000, exp: null };

describe('license format', () => {
  it('round-trips sign -> verify', () => {
    const r = verifyLicense(signLicense(base, privateKey), publicKey, { now: NOW });
    expect(r).toMatchObject({ valid: true, claims: { product: 'pro-kit', tier: 'pro', order: 'ord_1' } });
  });

  it('parseLicenseClaims reads payload without a key', () => {
    expect(parseLicenseClaims(signLicense(base, privateKey))).toMatchObject({ v: 1, product: 'pro-kit' });
  });

  it('rejects a payload that does not match the signature', () => {
    const tok = signLicense(base, privateKey);
    const evil = Buffer.from(JSON.stringify({ ...base, tier: 'business' })).toString('base64url') + '.' + tok.split('.')[1];
    expect(verifyLicense(evil, publicKey, { now: NOW })).toEqual({ valid: false, reason: 'signature' });
  });

  it('rejects verification under a different key', () => {
    const other = pair();
    expect(verifyLicense(signLicense(base, privateKey), other.publicKey, { now: NOW }).valid).toBe(false);
  });

  it('rejects an expired license (exp in the past)', () => {
    const tok = signLicense({ ...base, exp: 1500 }, privateKey);
    expect(verifyLicense(tok, publicKey, { now: NOW })).toEqual({ valid: false, reason: 'expired' });
  });

  it('treats exp:null as perpetual', () => {
    expect(verifyLicense(signLicense(base, privateKey), publicKey, { now: new Date(9e12) }).valid).toBe(true);
  });

  it('rejects malformed tokens', () => {
    expect(verifyLicense('garbage', publicKey, {}).valid).toBe(false);
    expect(verifyLicense('', publicKey, {}).valid).toBe(false);
    expect(parseLicenseClaims('garbage')).toBeNull();
  });
});
