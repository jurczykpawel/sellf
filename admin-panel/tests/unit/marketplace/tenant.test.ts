/**
 * Unit Tests: Marketplace Tenant Resolution
 *
 * Tests extractSellerSlug, isSellerRoute, normalizeSchemaName, and related
 * tenant resolution utilities.
 *
 * Run: bunx vitest run tests/unit/marketplace/tenant.test.ts
 *
 * @see src/lib/marketplace/tenant.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isSellerRoute,
  extractSellerSlug,
  normalizeSchemaName,
  isValidSellerSchema,
  extractSellerSubpath,
  buildSellerPath,
} from '@/lib/marketplace/tenant';

// =====================================================
// isSellerRoute()
// =====================================================

describe('isSellerRoute()', () => {
  it('should match /s/{slug}', () => {
    expect(isSellerRoute('/s/nick')).toBe(true);
  });

  it('should match /s/{slug}/', () => {
    expect(isSellerRoute('/s/nick/')).toBe(true);
  });

  it('should match /s/{slug}/product', () => {
    expect(isSellerRoute('/s/nick/my-product')).toBe(true);
  });

  it('should match /en/s/{slug}', () => {
    expect(isSellerRoute('/en/s/nick')).toBe(true);
  });

  it('should match /pl/s/{slug}/product', () => {
    expect(isSellerRoute('/pl/s/nick/my-product')).toBe(true);
  });

  it('should not match /p/{slug} (product route)', () => {
    expect(isSellerRoute('/p/my-product')).toBe(false);
  });

  it('should not match /api/...', () => {
    expect(isSellerRoute('/api/sellf')).toBe(false);
  });

  it('should not match /admin/...', () => {
    expect(isSellerRoute('/admin/payments')).toBe(false);
  });

  it('should not match root /', () => {
    expect(isSellerRoute('/')).toBe(false);
  });

  it('should not match /s/ without slug', () => {
    expect(isSellerRoute('/s/')).toBe(false);
  });

  it('should not match /s with no trailing slash or slug', () => {
    expect(isSellerRoute('/s')).toBe(false);
  });

  it('should match slugs with hyphens and numbers', () => {
    expect(isSellerRoute('/s/my-shop-123')).toBe(true);
  });

  it('should match slugs with underscores', () => {
    expect(isSellerRoute('/s/my_shop')).toBe(true);
  });

  it('should not match slugs starting with hyphen', () => {
    expect(isSellerRoute('/s/-invalid')).toBe(false);
  });
});

// =====================================================
// extractSellerSlug()
// =====================================================

describe('extractSellerSlug()', () => {
  it('should extract slug from /s/{slug}', () => {
    expect(extractSellerSlug('/s/nick')).toBe('nick');
  });

  it('should extract slug from /s/{slug}/product', () => {
    expect(extractSellerSlug('/s/nick/my-product')).toBe('nick');
  });

  it('should extract slug from /en/s/{slug}', () => {
    expect(extractSellerSlug('/en/s/nick')).toBe('nick');
  });

  it('should extract slug from /pl/s/{slug}/product', () => {
    expect(extractSellerSlug('/pl/s/my-shop/product')).toBe('my-shop');
  });

  it('should return null for reserved slug: admin', () => {
    expect(extractSellerSlug('/s/admin')).toBeNull();
  });

  it('should return null for reserved slug: api', () => {
    expect(extractSellerSlug('/s/api')).toBeNull();
  });

  it('should return null for reserved slug: main', () => {
    expect(extractSellerSlug('/s/main')).toBeNull();
  });

  it('should return null for reserved slug: sellers', () => {
    expect(extractSellerSlug('/s/sellers')).toBeNull();
  });

  it('should return null for non-seller routes', () => {
    expect(extractSellerSlug('/p/product')).toBeNull();
    expect(extractSellerSlug('/admin/payments')).toBeNull();
    expect(extractSellerSlug('/')).toBeNull();
  });

  it('should return null for /s/ without slug', () => {
    expect(extractSellerSlug('/s/')).toBeNull();
  });
});

// =====================================================
// normalizeSchemaName()
// =====================================================

describe('normalizeSchemaName()', () => {
  it('should prefix with seller_ and lowercase', () => {
    expect(normalizeSchemaName('nick')).toBe('seller_nick');
  });

  it('should replace hyphens with underscores', () => {
    expect(normalizeSchemaName('my-shop')).toBe('seller_my_shop');
  });

  it('should replace special chars with underscores', () => {
    expect(normalizeSchemaName('my.shop!')).toBe('seller_my_shop');
  });

  it('should collapse multiple underscores', () => {
    expect(normalizeSchemaName('my--shop')).toBe('seller_my_shop');
  });

  it('should trim leading/trailing underscores', () => {
    expect(normalizeSchemaName('-shop-')).toBe('seller_shop');
  });

  it('should return null for empty slug', () => {
    expect(normalizeSchemaName('')).toBeNull();
  });

  it('should return null for slug that sanitizes to less than 2 chars', () => {
    expect(normalizeSchemaName('a')).toBeNull();
  });

  it('should return null for reserved slug', () => {
    expect(normalizeSchemaName('admin')).toBeNull();
  });

  it('should handle slug with all special chars', () => {
    expect(normalizeSchemaName('!!!')).toBeNull(); // sanitizes to empty
  });
});

// =====================================================
// isValidSellerSchema()
// =====================================================

describe('isValidSellerSchema()', () => {
  it('should accept valid seller schema names', () => {
    expect(isValidSellerSchema('seller_nick')).toBe(true);
    expect(isValidSellerSchema('seller_my_shop_123')).toBe(true);
  });

  it('should reject seller_main (owner schema)', () => {
    expect(isValidSellerSchema('seller_main')).toBe(false);
  });

  it('should reject schemas without seller_ prefix', () => {
    expect(isValidSellerSchema('public')).toBe(false);
    expect(isValidSellerSchema('nick')).toBe(false);
  });

  it('should reject schemas with uppercase', () => {
    expect(isValidSellerSchema('seller_Nick')).toBe(false);
  });

  it('should reject schemas that are too short', () => {
    expect(isValidSellerSchema('seller_a')).toBe(false);
  });
});

// =====================================================
// extractSellerSubpath()
// =====================================================

describe('extractSellerSubpath()', () => {
  it('should return empty string for /s/{slug}', () => {
    expect(extractSellerSubpath('/s/nick')).toBe('');
  });

  it('should extract product slug from /s/{slug}/{product}', () => {
    expect(extractSellerSubpath('/s/nick/my-product')).toBe('my-product');
  });

  it('should extract subpath from /en/s/{slug}/{subpath}', () => {
    expect(extractSellerSubpath('/en/s/nick/checkout')).toBe('checkout');
  });

  it('should extract nested subpath', () => {
    expect(extractSellerSubpath('/s/nick/connect/return')).toBe('connect/return');
  });
});

// =====================================================
// buildSellerPath()
// =====================================================

describe('buildSellerPath()', () => {
  it('should build /s/{slug}', () => {
    expect(buildSellerPath('nick')).toBe('/s/nick');
  });

  it('should build /s/{slug}/{subpath}', () => {
    expect(buildSellerPath('nick', 'my-product')).toBe('/s/nick/my-product');
  });

  it('should build /{locale}/s/{slug}', () => {
    expect(buildSellerPath('nick', undefined, 'en')).toBe('/en/s/nick');
  });

  it('should build /{locale}/s/{slug}/{subpath}', () => {
    expect(buildSellerPath('nick', 'checkout', 'pl')).toBe('/pl/s/nick/checkout');
  });
});
