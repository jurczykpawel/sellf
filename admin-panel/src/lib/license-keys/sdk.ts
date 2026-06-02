import { parseLicenseClaims, verifyLicense, type LicenseVerifyResult } from '@/lib/license-keys/format';

/**
 * Reference verifier for sellers: verify a Sellf-issued license token OFFLINE
 * against the seller's published public keys (the array returned by
 * `GET /api/licenses/jwks?seller=<id>`). Selects the key by the token's `kid`,
 * then checks the ECDSA signature and expiry — no network call needed at verify
 * time. Sellers can copy this function (it depends only on `format.ts`, which is
 * plain Node `crypto`).
 */
export interface SellfPublicKey {
  kid: string;
  alg: string;
  pem: string;
}

export function verifySellfLicense(
  token: string,
  opts: { keys: SellfPublicKey[]; now?: Date },
): LicenseVerifyResult {
  const claims = parseLicenseClaims(token);
  if (!claims) return { valid: false, reason: 'malformed' };
  const key = opts.keys.find((k) => k.kid === claims.kid);
  if (!key) return { valid: false, reason: 'signature' };
  return verifyLicense(token, key.pem, { now: opts.now });
}
