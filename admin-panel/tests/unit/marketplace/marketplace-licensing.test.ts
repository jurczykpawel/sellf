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

// Valid license for domain "test.example.com" — real ECDSA P-256 signature
const VALID_LICENSE_UNLIMITED =
  'SF-test.example.com-UNLIMITED-MEUCIEHqYzD3xj-ro61wuTmeBnXI7atQ3d_NWX6QcZUk05zrAiEA53-g5nGLU3_hR2OZfCeUruyVU3lY_57ZQbmO4obico8';

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

  it('checkMarketplaceAccess uses domain license from SELLF_LICENSE_KEY env', () => {
    // Static analysis: feature-flag.ts reads SELLF_LICENSE_KEY and passes it to validateLicense
    expect(FEATURE_FLAG_SOURCE).toContain('process.env.SELLF_LICENSE_KEY');
    expect(FEATURE_FLAG_SOURCE).toContain('validateLicense(licenseKey, domain)');
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
  it('each seller has their OWN integrations_config with their own license key', () => {
    // Seller product page reads license from the seller's own schema via createSellerAdminClient
    expect(SELLER_PRODUCT_PAGE).toContain('createSellerAdminClient(seller.schema_name)');
    expect(SELLER_PRODUCT_PAGE).toMatch(
      /from\(['"]integrations_config['"]\).*select\(['"]sellf_license['"]\)/s
    );
  });

  it('seller_main license does NOT affect seller_X license status (separate schemas)', () => {
    // Both pages use createSellerAdminClient (schema-scoped), not the platform client.
    // This means seller_main.integrations_config is never read for seller pages.
    const sellerAdminCount = (SELLER_PRODUCT_PAGE.match(/createSellerAdminClient/g) || []).length;
    expect(sellerAdminCount).toBeGreaterThanOrEqual(1);

    // No call to createClient for license checks — only createSellerAdminClient
    // The only createClient call is for the preview mode admin check (auth)
    const createClientCalls = SELLER_PRODUCT_PAGE.match(/await createClient\(\)/g) || [];
    // createClient is used for auth check (preview mode), not for license
    const licenseSection = SELLER_PRODUCT_PAGE.slice(
      SELLER_PRODUCT_PAGE.indexOf('// License check')
    );
    expect(licenseSection).not.toContain('await createClient()');
    expect(licenseSection).toContain('createSellerAdminClient');
  });

  it('checkout page reads license from seller schema, not platform schema', () => {
    // Checkout fetches integrations_config.sellf_license in parallel with product data
    // using the seller-scoped admin client
    expect(SELLER_CHECKOUT_PAGE).toContain('createSellerAdminClient');
    expect(SELLER_CHECKOUT_PAGE).toMatch(/from\(['"]integrations_config['"]\).*sellf_license/s);
  });
});

// ============================================================================
// 4. Seller product page license check
// ============================================================================

describe('Seller product page license check', () => {
  it('validates license from seller schema integrations_config', () => {
    expect(SELLER_PRODUCT_PAGE).toContain("integrations?.sellf_license");
  });

  it('validates against seller.slug (not just domain)', () => {
    // Must call validateLicense with seller.slug
    expect(SELLER_PRODUCT_PAGE).toContain('validateLicense(integrations.sellf_license, seller.slug)');
  });

  it('accepts both slug match AND domain match (OR logic)', () => {
    // Product page uses OR: slugResult.valid || domainResult.valid
    expect(SELLER_PRODUCT_PAGE).toContain('slugResult.valid || domainResult.valid');
  });

  it('passes licenseValid to ProductView component', () => {
    expect(SELLER_PRODUCT_PAGE).toMatch(/licenseValid=\{licenseValid\}/);
  });
});

// ============================================================================
// 5. Seller checkout page license check
// ============================================================================

describe('Seller checkout page license check', () => {
  it('reads license from seller schema integrations_config', () => {
    expect(SELLER_CHECKOUT_PAGE).toMatch(
      /from\(['"]integrations_config['"]\).*select\(['"]sellf_license['"]\)/s
    );
  });

  it('validates against seller slug OR domain', () => {
    // Checkout page: slugResult = validateLicense(key, seller.slug), domainResult = validateLicense(key, domain)
    expect(SELLER_CHECKOUT_PAGE).toContain('validateLicense(licenseKey, data.seller.slug)');
    expect(SELLER_CHECKOUT_PAGE).toContain('validateLicense(licenseKey, currentDomain)');
    expect(SELLER_CHECKOUT_PAGE).toContain('slugResult.valid || domainResult.valid');
  });

  it('passes licenseValid to ProductPurchaseView component', () => {
    expect(SELLER_CHECKOUT_PAGE).toMatch(/licenseValid=\{licenseResult\.valid\}/);
  });
});
