import { createSign, createVerify } from 'node:crypto';

export { domainMatches, normalizeLicenseDomain } from '@/lib/license-keys/domain';

/**
 * Seller-issued product license token. Format: `payloadB64url.sigB64url`,
 * payload = base64url(JSON claims), signature = ECDSA P-256 / SHA-256 over the
 * payload string. Verifiable offline with the seller's public key.
 */
export interface LicenseClaims {
  v: 1;
  kid: string;
  product: string;
  email: string;
  order: string;
  tier: string | null;
  iat: number;
  exp: number | null;
  domain?: string;
  [claim: string]: unknown;
}

export type LicenseVerifyResult =
  | { valid: true; claims: LicenseClaims }
  | { valid: false; reason: 'malformed' | 'signature' | 'expired' };

function isLicenseClaims(value: unknown): value is LicenseClaims {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.kid === 'string' &&
    typeof v.product === 'string' &&
    typeof v.email === 'string' &&
    typeof v.order === 'string' &&
    (v.tier === null || typeof v.tier === 'string') &&
    typeof v.iat === 'number' &&
    (v.exp === null || typeof v.exp === 'number')
  );
}


export function signLicense(claims: LicenseClaims, privateKeyPem: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createSign('SHA256').update(payload).end().sign(privateKeyPem).toString('base64url');
  return `${payload}.${sig}`;
}

export function parseLicenseClaims(token: string): LicenseClaims | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  try {
    const claims = JSON.parse(Buffer.from(token.slice(0, dot), 'base64url').toString('utf-8'));
    return isLicenseClaims(claims) ? claims : null;
  } catch {
    return null;
  }
}

export function verifyLicense(token: string, publicKeyPem: string, opts: { now?: Date }): LicenseVerifyResult {
  if (!token || typeof token !== 'string') return { valid: false, reason: 'malformed' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { valid: false, reason: 'malformed' };
  const payload = token.slice(0, dot);

  let sig: Buffer;
  try {
    sig = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  let ok = false;
  try {
    ok = createVerify('SHA256').update(payload).end().verify(publicKeyPem, sig);
  } catch {
    return { valid: false, reason: 'signature' };
  }
  if (!ok) return { valid: false, reason: 'signature' };

  const claims = parseLicenseClaims(token);
  if (!claims) return { valid: false, reason: 'malformed' };

  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (claims.exp !== null && claims.exp < nowSec) return { valid: false, reason: 'expired' };

  return { valid: true, claims };
}
