/**
 * Unit Tests: Marketplace Seller Routing
 *
 * Tests the seller storefront and product page routing logic.
 * These are unit tests for the routing utilities — not E2E page rendering.
 *
 * Run: bunx vitest run tests/unit/marketplace/seller-routing.test.ts
 *
 * @see src/app/[locale]/s/[seller]/page.tsx — storefront
 * @see src/app/[locale]/s/[seller]/[product]/page.tsx — product page
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isSellerRoute,
  extractSellerSlug,
  extractSellerSubpath,
  buildSellerPath,
} from '@/lib/marketplace/tenant';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';

// =====================================================
// Seller Routing Integration (tenant + feature flag)
// =====================================================

describe('Seller Routing — Gate + Resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should gate seller routes when marketplace is disabled', () => {
    delete process.env.MARKETPLACE_ENABLED;
    const path = '/s/nick';
    const isSeller = isSellerRoute(path);
    const access = checkMarketplaceAccess();

    expect(isSeller).toBe(true);
    expect(access.accessible).toBe(false);
  });

  it('should allow seller routes when marketplace is enabled + demo mode', () => {
    process.env.MARKETPLACE_ENABLED = 'true';
    process.env.DEMO_MODE = 'true';
    const path = '/s/nick/my-product';
    const isSeller = isSellerRoute(path);
    const slug = extractSellerSlug(path);
    const subpath = extractSellerSubpath(path);
    const access = checkMarketplaceAccess();

    expect(isSeller).toBe(true);
    expect(slug).toBe('nick');
    expect(subpath).toBe('my-product');
    expect(access.accessible).toBe(true);
  });

  it('should resolve full seller product URL flow', () => {
    process.env.MARKETPLACE_ENABLED = 'true';
    process.env.DEMO_MODE = 'true';

    const url = '/en/s/my-shop-123/advanced-course';

    expect(isSellerRoute(url)).toBe(true);
    expect(extractSellerSlug(url)).toBe('my-shop-123');
    expect(extractSellerSubpath(url)).toBe('advanced-course');

    // Build the reverse
    expect(buildSellerPath('my-shop-123', 'advanced-course', 'en')).toBe('/en/s/my-shop-123/advanced-course');
  });

  it('should block reserved slugs even when marketplace is enabled', () => {
    process.env.MARKETPLACE_ENABLED = 'true';
    process.env.DEMO_MODE = 'true';

    expect(extractSellerSlug('/s/admin')).toBeNull();
    expect(extractSellerSlug('/s/api')).toBeNull();
    expect(extractSellerSlug('/s/system')).toBeNull();
  });

  it('should handle seller storefront vs product differentiation', () => {
    const storefront = '/s/nick';
    const product = '/s/nick/my-course';

    expect(extractSellerSubpath(storefront)).toBe('');
    expect(extractSellerSubpath(product)).toBe('my-course');
  });
});
