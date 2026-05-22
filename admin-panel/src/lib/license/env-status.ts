import { validateLicense } from './verify';
import type { LicenseTier } from './verify';

export type EnvLicenseStatusReason =
  | 'not_configured'
  | 'no_platform_domain'
  | 'invalid_format'
  | 'invalid_signature'
  | 'expired'
  | 'domain_mismatch'
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

export function getEnvLicenseStatus(
  licenseKey: string | undefined,
  platformDomain: string | null,
): EnvLicenseStatus {
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
    const info = validateLicense(licenseKey).info;
    return {
      configured: true,
      valid: false,
      reason: 'no_platform_domain',
      tier: info.tier,
      domain: info.domain,
      expiry: info.expiry,
      isExpired: info.isExpired,
      domainMatch: false,
      platformDomain: null,
    };
  }

  const result = validateLicense(licenseKey, platformDomain);
  const { info, domainMatch } = result;

  let reason: EnvLicenseStatusReason;
  if (!info.domain || info.error === 'Invalid license format') {
    reason = 'invalid_format';
  } else if (info.error === 'Invalid license signature') {
    reason = 'invalid_signature';
  } else if (info.isExpired) {
    reason = 'expired';
  } else if (!domainMatch) {
    reason = 'domain_mismatch';
  } else {
    reason = 'valid';
  }

  return {
    configured: true,
    valid: result.valid && domainMatch,
    reason,
    tier: info.tier,
    domain: info.domain,
    expiry: info.expiry,
    isExpired: info.isExpired,
    domainMatch,
    platformDomain,
  };
}
