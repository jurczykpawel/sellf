/**
 * Unit Tests: Marketplace Licensing Model
 *
 * Tests the two-tier licensing model:
 *   1. Domain license (SF-{domain}-{expiry}-{sig}) — stored in SELLF_LICENSE_KEY env var,
 *      checked by checkMarketplaceAccess(). Enables marketplace features on the platform.
 *   2. Shop license (SF-{seller-slug}-{expiry}-{sig}) — stored per-seller in
 *      integrations_config.sellf_license. Removes "Powered by Sellf" watermark for that
 *      seller's store.
 *
 * We cannot generate new ECDSA signatures in tests (no private key). We use the existing
 * fixture for test.example.com and verify code paths via static source analysis.
 *
 * Run: bunx vitest run tests/unit/marketplace/marketplace-licensing.test.ts
 *
 * @see src/lib/license/verify.ts
 * @see src/lib/marketplace/feature-flag.ts
 * @see src/app/[locale]/s/[seller]/[product]/page.tsx
 * @see src/app/[locale]/s/[seller]/checkout/[slug]/page.tsx
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

import {
  validateLicense,
  doesDomainMatch,
} from '../../../src/lib/license/verify';

// ===== FIXTURES =====

// Valid MKT license for domain "test.example.com" — marketplace requires MKT tier
const VALID_LICENSE_UNLIMITED =
  'SF-test.example.com-MKT-UNLIMITED-MEYCIQDWhIm4U1DKdgtpaxX1hRQR5ebOgUxn9EoAXPs16wotsQIhAJYLsXqnn8nAbM-C0QVlSqT_sfbgK6o6woZzwE5ZyYAA';

// ===== SOURCE FILES FOR STATIC ANALYSIS =====

const SELLER_PRODUCT_PAGE = readFileSync(
  join(__dirname, '../../../src/app/[locale]/s/[seller]/[product]/page.tsx'),
  'utf-8'
);

const SELLER_CHECKOUT_PAGE = readFileSync(
  join(__dirname, '../../../src/app/[locale]/s/[seller]/checkout/[slug]/page.tsx'),
  'utf-8'
);

const FEATURE_FLAG_SOURCE = readFileSync(
  join(__dirname, '../../../src/lib/marketplace/feature-flag.ts'),
  'utf-8'
);

// ============================================================================
// 1. Domain license (marketplace access)
// ============================================================================

describe('Domain license (marketplace access)', () => {
  it('validateLicense with matching domain returns valid', () => {
    const result = validateLicense(VALID_LICENSE_UNLIMITED, 'test.example.com');
    expect(result.valid).toBe(true);
    expect(result.domainMatch).toBe(true);
  });

  it('validateLicense with wrong domain returns invalid', () => {
    const result = validateLicense(VALID_LICENSE_UNLIMITED, 'other-domain.com');
    expect(result.valid).toBe(false);
    expect(result.domainMatch).toBe(false);
    expect(result.error).toContain('not "other-domain.com"');
  });

  it('checkMarketplaceAccess uses checkFeature from license resolve', () => {
    // Static analysis: feature-flag.ts delegates to checkFeature('marketplace') from resolve.ts
    expect(FEATURE_FLAG_SOURCE).toContain("checkFeature('marketplace')");
    expect(FEATURE_FLAG_SOURCE).toContain("from '@/lib/license/resolve'");
  });
});

// ============================================================================
// 2. Shop license (watermark removal)
// ============================================================================

describe('Shop license (watermark removal)', () => {
  it('validateLicense with seller slug as identifier does exact match', () => {
    // The license is signed for "test.example.com", not a slug.
    // When used as a shop license with slug = "test.example.com", doesDomainMatch does exact match.
    const result = validateLicense(VALID_LICENSE_UNLIMITED, 'test.example.com');
    expect(result.valid).toBe(true);
  });

  it('validateLicense with wrong slug returns invalid', () => {
    // License is for "test.example.com", slug "kowalski-digital" does not match
    const result = validateLicense(VALID_LICENSE_UNLIMITED, 'kowalski-digital');
    expect(result.valid).toBe(false);
    expect(result.domainMatch).toBe(false);
  });

  it('validateLicense called without identifier (no domain check) returns valid for valid signature', () => {
    const result = validateLicense(VALID_LICENSE_UNLIMITED);
    expect(result.valid).toBe(true);
    expect(result.domainMatch).toBe(true); // assumed match when no domain to check
  });

  it('shop license for slug "kowalski-digital" does NOT match domain "kowalski-digital.com"', () => {
    // Slug-based matching is exact — no .com suffix stripping
    expect(doesDomainMatch('kowalski-digital', 'kowalski-digital.com')).toBe(false);
  });
});

// ============================================================================
// 3. License isolation between sellers
// ============================================================================

describe('License isolation between sellers', () => {
  it('each seller has their OWN schema client for license checks', () => {
    // Seller product page uses createSellerAdminClient for schema-scoped license resolution
    expect(SELLER_PRODUCT_PAGE).toContain('createSellerAdminClient(seller.schema_name)');
    // License check delegates to checkFeature with seller-scoped dataClient
    expect(SELLER_PRODUCT_PAGE).toContain("checkFeature('watermark-removal'");
  });

  it('seller_main license does NOT affect seller_X license status (separate schemas)', () => {
    // Both pages use createSellerAdminClient (schema-scoped), not the platform client.
    const sellerAdminCount = (SELLER_PRODUCT_PAGE.match(/createSellerAdminClient/g) || []).length;
    expect(sellerAdminCount).toBeGreaterThanOrEqual(1);

    // License section uses sellerClient passed to checkFeature, not createClient()
    const licenseSection = SELLER_PRODUCT_PAGE.slice(
      SELLER_PRODUCT_PAGE.indexOf('// License check')
    );
    expect(licenseSection).not.toContain('await createClient()');
    expect(licenseSection).toContain('createSellerAdminClient');
  });

  it('checkout page reads license from seller schema via checkFeature', () => {
    // Checkout uses seller-scoped admin client for license resolution
    expect(SELLER_CHECKOUT_PAGE).toContain('createSellerAdminClient');
    expect(SELLER_CHECKOUT_PAGE).toContain("checkFeature('watermark-removal'");
  });
});

// ============================================================================
// 4. Seller product page license check
// ============================================================================

describe('Seller product page license check', () => {
  it('uses checkFeature with seller-scoped client and slug', () => {
    // Product page calls checkFeature('watermark-removal', { dataClient, sellerSlug })
    expect(SELLER_PRODUCT_PAGE).toContain("checkFeature('watermark-removal'");
    expect(SELLER_PRODUCT_PAGE).toContain('sellerSlug: seller.slug');
  });

  it('passes seller-scoped dataClient to checkFeature', () => {
    // The sellerClient is created via createSellerAdminClient and passed as dataClient
    expect(SELLER_PRODUCT_PAGE).toContain('dataClient: sellerClient');
  });

  it('passes licenseValid to ProductView component', () => {
    expect(SELLER_PRODUCT_PAGE).toMatch(/licenseValid=\{licenseValid\}/);
  });
});

// ============================================================================
// 5. Seller checkout page license check
// ============================================================================

describe('Seller checkout page license check', () => {
  it('uses checkFeature with seller-scoped client', () => {
    // Checkout page delegates to checkFeature('watermark-removal', { dataClient, sellerSlug })
    expect(SELLER_CHECKOUT_PAGE).toContain("checkFeature('watermark-removal'");
    expect(SELLER_CHECKOUT_PAGE).toContain('sellerSlug: data.seller.slug');
  });

  it('uses seller admin client as dataClient', () => {
    expect(SELLER_CHECKOUT_PAGE).toContain('dataClient: data.client');
  });

  it('passes licenseValid to ProductPurchaseView component', () => {
    expect(SELLER_CHECKOUT_PAGE).toMatch(/licenseValid=\{licenseValid\}/);
  });
});
