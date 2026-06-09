import { describe, it, expect } from 'vitest';
import { isAdminTrackingPath } from '@/lib/tracking/should-track';

describe('isAdminTrackingPath', () => {
  it('is true for the localized admin dashboard (where Umami must not fire)', () => {
    expect(isAdminTrackingPath('/pl/dashboard/products')).toBe(true);
    expect(isAdminTrackingPath('/en/dashboard')).toBe(true);
    expect(isAdminTrackingPath('/dashboard/settings')).toBe(true);
  });

  it('is false for public storefront / product / checkout paths', () => {
    expect(isAdminTrackingPath('/pl')).toBe(false);
    expect(isAdminTrackingPath('/pl/p/some-course')).toBe(false);
    expect(isAdminTrackingPath('/checkout/x')).toBe(false);
    expect(isAdminTrackingPath('/')).toBe(false);
  });

  it('is false (no crash) for null/undefined pathnames', () => {
    expect(isAdminTrackingPath(null)).toBe(false);
    expect(isAdminTrackingPath(undefined)).toBe(false);
  });
});
