import { describe, expect, it } from 'vitest';
import { canRenewExpiredLicenseWithActiveAccess, isLicenseExpired } from '@/lib/license-keys/renewal';

const NOW = new Date('2026-06-02T12:00:00Z');

describe('license renewal policy', () => {
  it('treats null license expiry as still valid', () => {
    expect(isLicenseExpired(null, NOW)).toBe(false);
  });

  it('treats future license expiry as still valid', () => {
    expect(isLicenseExpired('2026-06-03T12:00:00Z', NOW)).toBe(false);
  });

  it('treats past license expiry as expired', () => {
    expect(isLicenseExpired('2026-06-01T12:00:00Z', NOW)).toBe(true);
  });

  it('allows renewal only for an explicit renewal request on a product that issues licenses with an expired license', () => {
    expect(canRenewExpiredLicenseWithActiveAccess({
      renewLicense: true,
      productIssuesLicense: true,
      licenseExpiresAt: '2026-06-01T12:00:00Z',
      now: NOW,
    })).toBe(true);
  });

  it('blocks active-access checkout when renewal is not explicit', () => {
    expect(canRenewExpiredLicenseWithActiveAccess({
      renewLicense: false,
      productIssuesLicense: true,
      licenseExpiresAt: '2026-06-01T12:00:00Z',
      now: NOW,
    })).toBe(false);
  });

  it('blocks renewal when the license is still valid', () => {
    expect(canRenewExpiredLicenseWithActiveAccess({
      renewLicense: true,
      productIssuesLicense: true,
      licenseExpiresAt: '2026-06-03T12:00:00Z',
      now: NOW,
    })).toBe(false);
  });

  it('blocks renewal for products that do not issue licenses', () => {
    expect(canRenewExpiredLicenseWithActiveAccess({
      renewLicense: true,
      productIssuesLicense: false,
      licenseExpiresAt: '2026-06-01T12:00:00Z',
      now: NOW,
    })).toBe(false);
  });
});
