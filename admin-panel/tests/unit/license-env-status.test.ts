import { describe, expect, it } from 'vitest';
import { getEnvLicenseStatus } from '@/lib/license/env-status';

const VALID_PRO_UNLIMITED = 'SF-test.example.com-PRO-UNLIMITED-MEQCIFJvfvcakzjXutavoqSX9d-NnKPfVit5lb2kSezgO0YZAiAyVYnHJOa9A5WSav0YYVB9LWFQJyR_cM2EL9NfJZAq5Q';
const VALID_BIZ_UNLIMITED = 'SF-test.example.com-BIZ-UNLIMITED-MEYCIQDVctECqyu3T94QuJML7fBTVGRJRR8h7VxibrHeKotiIgIhAKQ8WFOD5cCgc2aBchajxe2qH0YXjSrUzUHP8LufYwM-';
const EXPIRED_BIZ = 'SF-test.example.com-BIZ-20201231-MEYCIQCoWI1lxsqiLO0KTQk3pf7MtuRbpYkca4bYxuv_TcRqeQIhALPNuWYfln8hmL88Wlh8GQhU45N735GU5hBMpeyPD0D3';
const INVALID_SIGNATURE = 'SF-test.example.com-UNLIMITED-INVALID_SIGNATURE_HERE';
const GARBAGE = 'not-a-license-at-all';

describe('getEnvLicenseStatus', () => {
  it('returns not_configured when env key is missing', () => {
    const status = getEnvLicenseStatus(undefined, 'test.example.com');
    expect(status).toMatchObject({
      configured: false,
      valid: false,
      reason: 'not_configured',
      tier: null,
    });
  });

  it('returns no_platform_domain when SITE_URL/MAIN_DOMAIN is missing', () => {
    const status = getEnvLicenseStatus(VALID_PRO_UNLIMITED, null);
    expect(status.configured).toBe(true);
    expect(status.valid).toBe(false);
    expect(status.reason).toBe('no_platform_domain');
    expect(status.platformDomain).toBeNull();
  });

  it('marks a valid license for the correct domain as valid', () => {
    const status = getEnvLicenseStatus(VALID_PRO_UNLIMITED, 'test.example.com');
    expect(status).toMatchObject({
      configured: true,
      valid: true,
      reason: 'valid',
      tier: 'pro',
      domain: 'test.example.com',
      expiry: 'UNLIMITED',
      isExpired: false,
      domainMatch: true,
      platformDomain: 'test.example.com',
    });
  });

  it('surfaces tier for business licenses', () => {
    const status = getEnvLicenseStatus(VALID_BIZ_UNLIMITED, 'test.example.com');
    expect(status.valid).toBe(true);
    expect(status.tier).toBe('business');
  });

  it('reports domain_mismatch when license domain differs from platform', () => {
    const status = getEnvLicenseStatus(VALID_PRO_UNLIMITED, 'other.example.com');
    expect(status.valid).toBe(false);
    expect(status.reason).toBe('domain_mismatch');
    expect(status.domain).toBe('test.example.com');
    expect(status.platformDomain).toBe('other.example.com');
  });

  it('reports expired when license is past expiry', () => {
    const status = getEnvLicenseStatus(EXPIRED_BIZ, 'test.example.com');
    expect(status.valid).toBe(false);
    expect(status.reason).toBe('expired');
    expect(status.isExpired).toBe(true);
  });

  it('reports invalid_signature when signature does not verify', () => {
    const status = getEnvLicenseStatus(INVALID_SIGNATURE, 'test.example.com');
    expect(status.valid).toBe(false);
    expect(status.reason).toBe('invalid_signature');
  });

  it('reports invalid_format for garbage input', () => {
    const status = getEnvLicenseStatus(GARBAGE, 'test.example.com');
    expect(status.valid).toBe(false);
    expect(status.reason).toBe('invalid_format');
  });
});
