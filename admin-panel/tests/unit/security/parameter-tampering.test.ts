import { describe, it, expect } from 'vitest';
import {
  validateCreateProduct,
  validateUpdateProduct,
  validateProductId,
  sanitizeProductData,
  escapeIlikePattern,
  validateProductSortColumn,
  PRODUCT_SORT_COLUMNS,
} from '@/lib/validations/product';
import {
  validateGrantAccess,
  validateUserAction,
  validateAccessCheck,
  sanitizeGrantAccessData,
  sanitizeUserActionData,
  sanitizeAccessCheckData,
} from '@/lib/validations/access';

/**
 * ============================================================================
 * SECURITY TEST: Parameter Tampering Prevention
 * ============================================================================
 *
 * Tests PRODUCTION validation functions from:
 * - @/lib/validations/product (product CRUD validation + SQL injection prevention)
 * - @/lib/validations/access (access control input validation)
 *
 * ATTACK VECTORS TESTED:
 * - SQL injection via ILIKE patterns (%, _, \)
 * - Sort column injection via unvalidated sortBy
 * - Scientific notation bypass (1e10)
 * - NaN/Infinity injection for price fields
 * - Negative price attacks
 * - UUID format bypass
 * - Slug injection attacks
 *
 * Created during security audit (2026-01-08)
 * Refactored to test production code (2026-02-26)
 * ============================================================================
 */

describe('Parameter Tampering Security', () => {
  describe('escapeIlikePattern - SQL Pattern Injection Prevention', () => {
    /**
     * Tests the PRODUCTION escapeIlikePattern() function that prevents
     * SQL ILIKE wildcard injection in product search.
     */

    it('should escape percent sign (% wildcard)', () => {
      expect(escapeIlikePattern('100%')).toBe('100\\%');
      expect(escapeIlikePattern('%drop%')).toBe('\\%drop\\%');
    });

    it('should escape underscore (_ wildcard)', () => {
      expect(escapeIlikePattern('test_value')).toBe('test\\_value');
      expect(escapeIlikePattern('_admin_')).toBe('\\_admin\\_');
    });

    it('should escape backslash (escape char)', () => {
      expect(escapeIlikePattern('path\\to')).toBe('path\\\\to');
    });

    it('should handle combined special characters', () => {
      expect(escapeIlikePattern('%_\\')).toBe('\\%\\_\\\\');
    });

    it('should return empty string for null/invalid input', () => {
      expect(escapeIlikePattern('')).toBe('');
      expect(escapeIlikePattern(null as unknown as string)).toBe('');
      expect(escapeIlikePattern(undefined as unknown as string)).toBe('');
    });

    it('should pass through safe strings unchanged', () => {
      expect(escapeIlikePattern('normal search')).toBe('normal search');
      expect(escapeIlikePattern('Product Name')).toBe('Product Name');
    });
  });

  describe('validateProductSortColumn - Sort Column Injection Prevention', () => {
    /**
     * Tests the PRODUCTION validateProductSortColumn() function that prevents
     * SQL injection via ORDER BY clause.
     */

    it('should accept whitelisted sort columns', () => {
      expect(validateProductSortColumn('name')).toBe('name');
      expect(validateProductSortColumn('price')).toBe('price');
      expect(validateProductSortColumn('created_at')).toBe('created_at');
      expect(validateProductSortColumn('is_active')).toBe('is_active');
    });

    it('should reject SQL injection attempts with default', () => {
      expect(validateProductSortColumn('name; DROP TABLE products--')).toBe('created_at');
      expect(validateProductSortColumn("name' OR '1'='1")).toBe('created_at');
      expect(validateProductSortColumn('1=1')).toBe('created_at');
    });

    it('should reject unknown columns', () => {
      expect(validateProductSortColumn('password')).toBe('created_at');
      expect(validateProductSortColumn('admin_secret')).toBe('created_at');
      expect(validateProductSortColumn('nonexistent')).toBe('created_at');
    });

    it('should handle null/empty with default', () => {
      expect(validateProductSortColumn(null)).toBe('created_at');
      expect(validateProductSortColumn('')).toBe('created_at');
    });
  });

  describe('validateCreateProduct - Product Input Validation', () => {
    /**
     * Tests PRODUCTION validateCreateProduct() against attack payloads.
     */

    const validProduct = {
      name: 'Test Product',
      slug: 'test-product',
      description: 'A valid test product description',
      price: 29.99,
    };

    it('should accept valid product data', () => {
      const result = validateCreateProduct(validProduct);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    describe('Price tampering attacks', () => {
      it('should reject NaN price', () => {
        const result = validateCreateProduct({ ...validProduct, price: NaN });
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.toLowerCase().includes('price'))).toBe(true);
      });

      it('should reject Infinity price', () => {
        const result = validateCreateProduct({ ...validProduct, price: Infinity });
        expect(result.isValid).toBe(false);
      });

      it('should reject negative price', () => {
        const result = validateCreateProduct({ ...validProduct, price: -10 });
        expect(result.isValid).toBe(false);
      });

      it('should reject excessively large price', () => {
        const result = validateCreateProduct({ ...validProduct, price: 10000000 });
        expect(result.isValid).toBe(false);
      });

      it('should accept zero price (free product)', () => {
        const result = validateCreateProduct({ ...validProduct, price: 0 });
        expect(result.isValid).toBe(true);
      });
    });

    describe('Slug injection attacks', () => {
      it('should reject SQL injection in slug', () => {
        const result = validateCreateProduct({
          ...validProduct,
          slug: "test'; DROP TABLE products;--",
        });
        expect(result.isValid).toBe(false);
      });

      it('should reject uppercase characters in slug', () => {
        const result = validateCreateProduct({ ...validProduct, slug: 'Test-Product' });
        expect(result.isValid).toBe(false);
      });

      it('should reject slug starting with hyphen', () => {
        const result = validateCreateProduct({ ...validProduct, slug: '-test-product' });
        expect(result.isValid).toBe(false);
      });

      it('should reject slug with consecutive hyphens', () => {
        const result = validateCreateProduct({ ...validProduct, slug: 'test--product' });
        expect(result.isValid).toBe(false);
      });

      it('should reject overly long slug', () => {
        const result = validateCreateProduct({
          ...validProduct,
          slug: 'a'.repeat(101),
        });
        expect(result.isValid).toBe(false);
      });
    });

    describe('Currency validation', () => {
      it('should reject non-3-letter currency codes', () => {
        const result = validateCreateProduct({ ...validProduct, currency: 'FAKE' });
        expect(result.isValid).toBe(false);
      });

      it('should reject lowercase currency codes', () => {
        const result = validateCreateProduct({ ...validProduct, currency: 'usd' });
        expect(result.isValid).toBe(false);
      });

      it('should accept valid 3-letter uppercase currency', () => {
        const result = validateCreateProduct({ ...validProduct, currency: 'USD' });
        expect(result.isValid).toBe(true);
      });
    });

    describe('Duration validation (auto_grant_duration_days)', () => {
      it('should reject non-integer duration', () => {
        const result = validateCreateProduct({ ...validProduct, auto_grant_duration_days: 10.5 });
        expect(result.isValid).toBe(false);
      });

      it('should reject zero duration', () => {
        const result = validateCreateProduct({ ...validProduct, auto_grant_duration_days: 0 });
        expect(result.isValid).toBe(false);
      });

      it('should reject duration exceeding 10 years', () => {
        const result = validateCreateProduct({ ...validProduct, auto_grant_duration_days: 3651 });
        expect(result.isValid).toBe(false);
      });

      it('should accept valid duration', () => {
        const result = validateCreateProduct({ ...validProduct, auto_grant_duration_days: 30 });
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('validateProductId - UUID Tampering Prevention', () => {
    it('should accept valid UUID', () => {
      const result = validateProductId('550e8400-e29b-41d4-a716-446655440000');
      expect(result.isValid).toBe(true);
    });

    it('should reject SQL injection in UUID', () => {
      const result = validateProductId("550e8400-e29b-41d4-a716-446655440000'; DROP TABLE products;--");
      expect(result.isValid).toBe(false);
    });

    it('should reject non-UUID strings', () => {
      expect(validateProductId('not-a-uuid').isValid).toBe(false);
      expect(validateProductId('123').isValid).toBe(false);
      expect(validateProductId('').isValid).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(validateProductId(null as unknown as string).isValid).toBe(false);
      expect(validateProductId(undefined as unknown as string).isValid).toBe(false);
    });
  });

  describe('sanitizeProductData - Dangerous Field Removal', () => {
    it('should remove id, created_at, updated_at', () => {
      const data = {
        id: 'injected-id',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
        name: 'Product',
      };
      const sanitized = sanitizeProductData(data);
      expect(sanitized.id).toBeUndefined();
      expect(sanitized.created_at).toBeUndefined();
      expect(sanitized.updated_at).toBeUndefined();
      expect(sanitized.name).toBe('Product');
    });

    it('should remove OTO fields that should be managed separately', () => {
      const data = {
        name: 'Product',
        oto_enabled: true,
        oto_product_id: 'injected',
        oto_discount_type: 'percentage',
        oto_discount_value: 100,
        oto_duration_minutes: 60,
      };
      const sanitized = sanitizeProductData(data);
      expect(sanitized.oto_enabled).toBeUndefined();
      expect(sanitized.oto_product_id).toBeUndefined();
    });

    it('should remove sale_quantity_sold (system counter)', () => {
      const data = {
        name: 'Product',
        sale_quantity_sold: 999999,
      };
      const sanitized = sanitizeProductData(data);
      expect(sanitized.sale_quantity_sold).toBeUndefined();
    });

    it('should trim and lowercase slug', () => {
      const data = { slug: '  My-Slug  ' };
      const sanitized = sanitizeProductData(data, false);
      expect(sanitized.slug).toBe('my-slug');
    });

    it('should uppercase currency', () => {
      const data = { currency: 'usd' };
      const sanitized = sanitizeProductData(data, false);
      expect(sanitized.currency).toBe('USD');
    });

    it('should convert empty date strings to null', () => {
      const data = { available_from: '', available_until: '' };
      const sanitized = sanitizeProductData(data, false);
      expect(sanitized.available_from).toBeNull();
      expect(sanitized.available_until).toBeNull();
    });
  });

  describe('validateGrantAccess - Access Control Input Validation', () => {
    it('should accept valid grant access input', () => {
      const result = validateGrantAccess({
        product_id: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid product_id', () => {
      const result = validateGrantAccess({ product_id: 'not-a-uuid' });
      expect(result.isValid).toBe(false);
    });

    it('should reject SQL injection in product_id', () => {
      const result = validateGrantAccess({
        product_id: "' OR 1=1; --",
      });
      expect(result.isValid).toBe(false);
    });

    it('should validate optional access_duration_days', () => {
      const result = validateGrantAccess({
        product_id: '550e8400-e29b-41d4-a716-446655440000',
        access_duration_days: 10.5,
      });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateUserAction - User Action Input Validation', () => {
    const validAction = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      productId: '6ba7b810-9dad-41d4-80b4-00c04fd430c8',
      action: 'grant',
    };

    it('should accept valid user action', () => {
      const result = validateUserAction(validAction);
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid action type', () => {
      const result = validateUserAction({ ...validAction, action: 'delete_all' });
      expect(result.isValid).toBe(false);
    });

    it('should reject SQL injection in userId', () => {
      const result = validateUserAction({
        ...validAction,
        userId: "'; DROP TABLE users; --",
      });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateAccessCheck - Access Check Input Validation', () => {
    it('should accept valid product slug', () => {
      const result = validateAccessCheck({ productSlug: 'my-product' });
      expect(result.isValid).toBe(true);
    });

    it('should reject slug with special characters', () => {
      const result = validateAccessCheck({ productSlug: "my-product'; DROP TABLE--" });
      expect(result.isValid).toBe(false);
    });

    it('should reject empty productSlugs array', () => {
      const result = validateAccessCheck({ productSlugs: [] });
      expect(result.isValid).toBe(false);
    });

    it('should reject oversized productSlugs array (DoS prevention)', () => {
      const slugs = Array.from({ length: 51 }, (_, i) => `slug-${i}`);
      const result = validateAccessCheck({ productSlugs: slugs });
      expect(result.isValid).toBe(false);
    });

    it('should require at least one of productSlug or productSlugs', () => {
      const result = validateAccessCheck({});
      expect(result.isValid).toBe(false);
    });
  });

  describe('sanitizeGrantAccessData - Dangerous Field Removal', () => {
    it('should remove id, user_id, created_at, updated_at', () => {
      const data = {
        id: 'injected',
        user_id: 'injected',
        created_at: 'injected',
        updated_at: 'injected',
        product_id: '550e8400-e29b-41d4-a716-446655440000',
      };
      const sanitized = sanitizeGrantAccessData(data);
      expect(sanitized.id).toBeUndefined();
      expect(sanitized.user_id).toBeUndefined();
      expect(sanitized.created_at).toBeUndefined();
      expect(sanitized.updated_at).toBeUndefined();
      expect(sanitized.product_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });
});

describe('Integration: Combined Parameter Attack Scenarios', () => {
  /**
   * Tests that production validation functions properly reject
   * multi-vector attack payloads that combine different attack types.
   */

  it('should reject product with SQL injection in multiple fields', () => {
    const attack = {
      name: "'; DROP TABLE products; --",
      slug: "'; DROP TABLE products; --",
      description: 'Valid description',
      price: 10,
    };
    const result = validateCreateProduct(attack);
    // Slug validation should catch the injection
    expect(result.isValid).toBe(false);
  });

  it('should reject product with NaN price and invalid slug together', () => {
    const attack = {
      name: 'Product',
      slug: 'UPPERCASE-SLUG',
      description: 'Description',
      price: NaN,
    };
    const result = validateCreateProduct(attack);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject access check with mixed injection attacks', () => {
    const attacks = [
      { productSlug: "'; DROP TABLE--" },
      { productSlug: '<script>alert(1)</script>' },
      { productSlugs: ["valid-slug", "'; DROP TABLE--"] },
    ];

    for (const attack of attacks) {
      const result = validateAccessCheck(attack);
      expect(result.isValid).toBe(false);
    }
  });

  it('should handle timing-based SQL injection payloads in product validation', () => {
    const timingAttacks = [
      { name: 'Product', slug: 'pg-sleep-10', description: 'Valid', price: 10 },
      { name: "BENCHMARK(10000000,MD5('test'))", slug: 'valid', description: 'Valid', price: 10 },
    ];

    // First attack: slug is valid format (lowercase alphanumeric + hyphens)
    // but harmless due to parameterized queries
    const result0 = validateCreateProduct(timingAttacks[0]);
    expect(result0.isValid).toBe(true);

    // Second attack: name allows arbitrary strings (just length check),
    // slug is valid format — parameterized queries prevent actual SQL execution
    const result1 = validateCreateProduct(timingAttacks[1]);
    expect(result1.isValid).toBe(true);
  });
});
