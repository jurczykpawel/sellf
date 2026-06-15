import { describe, it, expect } from 'vitest';
import { hasFeature, getRequiredTier } from '@/lib/license/features';

describe('license-key-issuance feature gate', () => {
  it('is listed as a pro-tier feature', () => {
    expect(getRequiredTier('license-key-issuance')).toBe('pro');
  });

  it('is denied for free tier', () => {
    expect(hasFeature('free', 'license-key-issuance')).toBe(false);
  });

  it('is denied for registered tier', () => {
    expect(hasFeature('registered', 'license-key-issuance')).toBe(false);
  });

  it('is available for pro tier', () => {
    expect(hasFeature('pro', 'license-key-issuance')).toBe(true);
  });

  it('is available for business tier', () => {
    expect(hasFeature('business', 'license-key-issuance')).toBe(true);
  });
});

describe('webhook payload customization feature gate', () => {
  it('keeps custom fields and headers unavailable on the free tier', () => {
    expect(hasFeature('free', 'webhook-payload-customization')).toBe(false);
    expect(hasFeature('pro', 'webhook-payload-customization')).toBe(true);
    expect(hasFeature('business', 'webhook-payload-customization')).toBe(true);
  });
});
