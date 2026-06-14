import type { SellfPublicKey } from '@/lib/license-keys/sdk';

import { verifyPlatformLicenseToken } from './resolve';
import type { LicenseTier } from './features';

export type EnvLicenseStatusReason =
  | 'not_configured'
  | 'no_platform_domain'
  | 'invalid_format'
  | 'invalid_signature'
  | 'expired'
  | 'domain_mismatch'
  | 'invalid_product'
  | 'invalid_tier'
  | 'keys_unavailable'
  | 'valid';

export interface EnvLicenseStatus {
  configured: boolean;
  valid: boolean;
  reason: EnvLicenseStatusReason;
  tier: LicenseTier | null;
  domain: string | null;
  expiry: string | null;
  isExpired: boolean;
  domainMatch: boolean;
  platformDomain: string | null;
}

interface EnvLicenseStatusOptions {
  keys?: SellfPublicKey[];
  now?: Date;
  allowedProducts?: ReadonlySet<string>;
}

export async function getEnvLicenseStatus(
  licenseKey: string | undefined,
  platformDomain: string | null,
  options: EnvLicenseStatusOptions = {},
): Promise<EnvLicenseStatus> {
  if (!licenseKey) {
    return {
      configured: false,
      valid: false,
      reason: 'not_configured',
      tier: null,
      domain: null,
      expiry: null,
      isExpired: false,
      domainMatch: false,
      platformDomain,
    };
  }
  if (!platformDomain) {
    return {
      configured: true,
      valid: false,
      reason: 'no_platform_domain',
      tier: null,
      domain: null,
      expiry: null,
      isExpired: false,
      domainMatch: false,
      platformDomain: null,
    };
  }

  const result = await verifyPlatformLicenseToken(licenseKey, platformDomain, options);
  const expiry = result.expiry === null ? null : new Date(result.expiry * 1000).toISOString();
  if (result.valid) {
    return {
      configured: true,
      valid: true,
      reason: 'valid',
      tier: result.tier,
      domain: result.domain,
      expiry,
      isExpired: false,
      domainMatch: true,
      platformDomain,
    };
  }

  const reasonMap = {
    malformed: 'invalid_format',
    signature: 'invalid_signature',
    expired: 'expired',
    domain: 'domain_mismatch',
    product: 'invalid_product',
    tier: 'invalid_tier',
    keys: 'keys_unavailable',
  } as const;
  return {
    configured: true,
    valid: false,
    reason: reasonMap[result.reason],
    tier: null,
    domain: result.domain,
    expiry,
    isExpired: result.reason === 'expired',
    domainMatch: false,
    platformDomain,
  };
}
