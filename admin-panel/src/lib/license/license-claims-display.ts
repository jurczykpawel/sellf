/**
 * Decode a product-license token's claims for DISPLAY ONLY (no signature check).
 * Validity is decided server-side by verifyPlatformLicenseToken / getEnvLicenseStatus;
 * this just surfaces the human-readable claims (product, tier, domain, dates) in the UI.
 * Isomorphic (browser `atob` or Node `Buffer`).
 */
export interface DisplayLicenseClaims {
  product: string | null;
  email: string | null;
  tier: string | null;
  domain: string | null;
  issuedAt: number | null;
  expiresAt: number | null;
}

export function parseLicenseClaimsForDisplay(token: string): DisplayLicenseClaims | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  let b64 = token.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';

  try {
    const json =
      typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const c = JSON.parse(json) as Record<string, unknown>;
    if (!c || typeof c !== 'object') return null;
    return {
      product: typeof c.product === 'string' ? c.product : null,
      email: typeof c.email === 'string' ? c.email : null,
      tier: typeof c.tier === 'string' ? c.tier : null,
      domain: typeof c.domain === 'string' ? c.domain : null,
      issuedAt: typeof c.iat === 'number' ? c.iat : null,
      expiresAt: typeof c.exp === 'number' ? c.exp : null,
    };
  } catch {
    return null;
  }
}
