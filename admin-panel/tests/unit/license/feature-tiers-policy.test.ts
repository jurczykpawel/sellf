import { describe, it, expect } from 'vitest';

import { getAllFeatures, getRequiredTier, hasFeature } from '@/lib/license/features';

/**
 * Pins the license tier POLICY (which feature needs which tier).
 *
 * The whole point of FEATURE_TIERS is that re-pinning a feature between tiers is
 * a one-string change — this test is the guard rail for that string so a slip is
 * caught immediately. Update it deliberately when the product decision changes.
 *
 * @see src/lib/license/features.ts
 */
describe('license feature-tier policy', () => {
  it('puts the automation layer behind the free Registered tier', () => {
    const all = getAllFeatures();
    expect(all['api-keys']).toBe('registered');
    expect(all['webhooks']).toBe('registered');
    expect(all['csv-export']).toBe('registered');
  });

  it('keeps advanced/white-label slices on Pro', () => {
    const all = getAllFeatures();
    expect(all['api-key-scopes']).toBe('pro');
    expect(all['webhook-product-scoping']).toBe('pro');
    expect(all['webhook-payload-customization']).toBe('pro');
    expect(all['watermark-removal']).toBe('pro');
    expect(all['theme-customization']).toBe('pro');
  });

  it.each(['api-keys', 'webhooks'] as const)('gates %s creation: free denied, registered+ allowed', (feature) => {
    expect(getRequiredTier(feature)).toBe('registered');
    expect(hasFeature('free', feature)).toBe(false);
    expect(hasFeature('registered', feature)).toBe(true);
    expect(hasFeature('pro', feature)).toBe(true);
    expect(hasFeature('business', feature)).toBe(true);
  });
});
