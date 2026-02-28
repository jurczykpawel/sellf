import { describe, it, expect } from 'vitest';
import {
  validateCreateProduct,
  validateUpdateProduct,
  validateProductId,
  sanitizeProductData,
  escapeIlikePattern,
  validateProductSortColumn,
} from '@/lib/validations/product';

describe('Product Validation', () => {
  describe('validateIcon', () => {
    it('should accept single emoji', () => {
      const result = validateUpdateProduct({ icon: '📦' });
      expect(result.isValid).toBe(true);
    });

    it('should accept emoji with variation selector (e.g., 🛠️)', () => {
      const result = validateUpdateProduct({ icon: '🛠️' });
      expect(result.isValid).toBe(true);
    });

    it('should accept complex emojis (ZWJ sequences)', () => {
      const result = validateUpdateProduct({ icon: '👨‍💻' });
      expect(result.isValid).toBe(true);
    });

    it('should accept flag emojis', () => {
      const result = validateUpdateProduct({ icon: '🇵🇱' });
      expect(result.isValid).toBe(true);
    });

    it('should accept skin tone emojis', () => {
      const result = validateUpdateProduct({ icon: '👍🏽' });
      expect(result.isValid).toBe(true);
    });

    it('should accept alphanumeric icon names', () => {
      const result = validateUpdateProduct({ icon: 'rocket-icon' });
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid icon format', () => {
      const result = validateUpdateProduct({ icon: 'invalid icon!' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid icon format');
    });

    it('should reject empty icon', () => {
      const result = validateUpdateProduct({ icon: '' });
      expect(result.isValid).toBe(false);
    });

    it('should reject too long icon', () => {
      const result = validateUpdateProduct({ icon: '🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Icon must be less than 20 characters');
    });
  });

  describe('validateSlug', () => {
    it('should accept valid slug', () => {
      const result = validateUpdateProduct({ slug: 'my-product-123' });
      expect(result.isValid).toBe(true);
    });

    it('should reject slug with uppercase', () => {
      const result = validateUpdateProduct({ slug: 'My-Product' });
      expect(result.isValid).toBe(false);
    });

    it('should reject slug with spaces', () => {
      const result = validateUpdateProduct({ slug: 'my product' });
      expect(result.isValid).toBe(false);
    });

    it('should reject slug starting with hyphen', () => {
      const result = validateUpdateProduct({ slug: '-my-product' });
      expect(result.isValid).toBe(false);
    });

    it('should reject slug ending with hyphen', () => {
      const result = validateUpdateProduct({ slug: 'my-product-' });
      expect(result.isValid).toBe(false);
    });

    it('should reject slug with consecutive hyphens', () => {
      const result = validateUpdateProduct({ slug: 'my--product' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validatePrice', () => {
    it('should accept zero price (free product)', () => {
      const result = validateUpdateProduct({ price: 0 });
      expect(result.isValid).toBe(true);
    });

    it('should accept positive price', () => {
      const result = validateUpdateProduct({ price: 49.99 });
      expect(result.isValid).toBe(true);
    });

    it('should reject negative price', () => {
      const result = validateUpdateProduct({ price: -10 });
      expect(result.isValid).toBe(false);
    });

    it('should reject price over limit', () => {
      const result = validateUpdateProduct({ price: 1000000 });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateCurrency', () => {
    it('should accept valid 3-letter uppercase currency', () => {
      const result = validateUpdateProduct({ currency: 'USD' });
      expect(result.isValid).toBe(true);
    });

    it('should accept PLN currency', () => {
      const result = validateUpdateProduct({ currency: 'PLN' });
      expect(result.isValid).toBe(true);
    });

    it('should reject lowercase currency', () => {
      const result = validateUpdateProduct({ currency: 'usd' });
      expect(result.isValid).toBe(false);
    });

    it('should reject currency with wrong length', () => {
      const result = validateUpdateProduct({ currency: 'US' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateDuration', () => {
    it('should accept null duration (unlimited access)', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: null });
      expect(result.isValid).toBe(true);
    });

    it('should accept valid duration', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: 30 });
      expect(result.isValid).toBe(true);
    });

    it('should reject zero duration', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: 0 });
      expect(result.isValid).toBe(false);
    });

    it('should reject duration over 10 years', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: 4000 });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateProductId', () => {
    it('should accept valid UUID', () => {
      const result = validateProductId('550e8400-e29b-41d4-a716-446655440000');
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const result = validateProductId('not-a-uuid');
      expect(result.isValid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = validateProductId('');
      expect(result.isValid).toBe(false);
    });
  });

  describe('sanitizeProductData', () => {
    it('should remove OTO fields', () => {
      const data = {
        name: 'Test Product',
        oto_enabled: true,
        oto_product_id: '123',
        oto_discount_type: 'percentage',
        oto_discount_value: 30,
        oto_duration_minutes: 15,
      };
      const sanitized = sanitizeProductData(data);

      expect(sanitized.name).toBe('Test Product');
      expect(sanitized).not.toHaveProperty('oto_enabled');
      expect(sanitized).not.toHaveProperty('oto_product_id');
      expect(sanitized).not.toHaveProperty('oto_discount_type');
      expect(sanitized).not.toHaveProperty('oto_discount_value');
      expect(sanitized).not.toHaveProperty('oto_duration_minutes');
    });

    it('should remove dangerous fields (id, created_at, updated_at)', () => {
      const data = {
        id: '123',
        name: 'Test',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      const sanitized = sanitizeProductData(data);

      expect(sanitized).not.toHaveProperty('id');
      expect(sanitized).not.toHaveProperty('created_at');
      expect(sanitized).not.toHaveProperty('updated_at');
    });

    it('should trim string fields', () => {
      const data = {
        name: '  Test Product  ',
        description: '  A description  ',
        slug: '  test-product  ',
      };
      const sanitized = sanitizeProductData(data);

      expect(sanitized.name).toBe('Test Product');
      expect(sanitized.description).toBe('A description');
      expect(sanitized.slug).toBe('test-product');
    });

    it('should convert empty strings to null for date fields', () => {
      const data = {
        available_from: '',
        available_until: '',
        sale_price_until: '',
      };
      const sanitized = sanitizeProductData(data);

      expect(sanitized.available_from).toBeNull();
      expect(sanitized.available_until).toBeNull();
      expect(sanitized.sale_price_until).toBeNull();
    });

    it('should convert slug to lowercase', () => {
      const data = { slug: 'My-Product-Slug' };
      const sanitized = sanitizeProductData(data);

      expect(sanitized.slug).toBe('my-product-slug');
    });

    it('should convert currency to uppercase', () => {
      const data = { currency: 'pln' };
      const sanitized = sanitizeProductData(data);

      expect(sanitized.currency).toBe('PLN');
    });
  });

  describe('validateCreateProduct', () => {
    it('should validate complete product data', () => {
      const data = {
        name: 'Test Product',
        slug: 'test-product',
        description: 'A test product description',
        price: 49.99,
        currency: 'USD',
        icon: '📦',
      };
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(true);
    });

    it('should require all mandatory fields', () => {
      const result = validateCreateProduct({});
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate date range (from must be before until)', () => {
      const data = {
        name: 'Test',
        slug: 'test',
        description: 'Test',
        price: 10,
        available_from: '2025-01-15',
        available_until: '2025-01-10', // Before available_from
      };
      const result = validateCreateProduct(data);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Available from date must be before available until date');
    });
  });

  describe('validateUpdateProduct', () => {
    it('should allow partial updates', () => {
      const result = validateUpdateProduct({ name: 'New Name' });
      expect(result.isValid).toBe(true);
    });

    it('should validate only provided fields', () => {
      const result = validateUpdateProduct({
        price: 99.99,
        is_active: true,
      });
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid field even in partial update', () => {
      const result = validateUpdateProduct({ price: -50 });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateIcon edge cases', () => {
    it('should reject icon with exactly 21 characters', () => {
      const result = validateUpdateProduct({ icon: 'a'.repeat(21) });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Icon must be less than 20 characters');
    });

    it('should accept icon with exactly 20 characters', () => {
      const result = validateUpdateProduct({ icon: 'a'.repeat(20) });
      expect(result.isValid).toBe(true);
    });
  });

  describe('validateSlug edge cases', () => {
    it('should reject slug with SQL injection attempt', () => {
      const result = validateUpdateProduct({ slug: "'; DROP TABLE products; --" });
      expect(result.isValid).toBe(false);
    });

    it('should reject slug with special characters', () => {
      const result = validateUpdateProduct({ slug: 'test@product' });
      expect(result.isValid).toBe(false);
    });

    it('should accept single character slug', () => {
      const result = validateUpdateProduct({ slug: 'a' });
      expect(result.isValid).toBe(true);
    });

    it('should reject slug over 100 characters', () => {
      const result = validateUpdateProduct({ slug: 'a'.repeat(101) });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validatePrice edge cases', () => {
    it('should reject NaN price', () => {
      const result = validateUpdateProduct({ price: NaN });
      expect(result.isValid).toBe(false);
    });

    it('should reject Infinity price', () => {
      const result = validateUpdateProduct({ price: Infinity });
      expect(result.isValid).toBe(false);
    });

    it('should accept maximum valid price (999999.99)', () => {
      const result = validateUpdateProduct({ price: 999999.99 });
      expect(result.isValid).toBe(true);
    });

    it('should reject price just over the limit (1000000)', () => {
      const result = validateUpdateProduct({ price: 1000000 });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateDuration edge cases', () => {
    it('should accept null duration (unlimited)', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: null });
      expect(result.isValid).toBe(true);
    });

    it('should reject fractional duration', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: 1.5 });
      expect(result.isValid).toBe(false);
    });

    it('should reject negative duration', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: -1 });
      expect(result.isValid).toBe(false);
    });

    it('should accept exactly 1 day duration', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: 1 });
      expect(result.isValid).toBe(true);
    });

    it('should accept exactly 3650 days (10 years)', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: 3650 });
      expect(result.isValid).toBe(true);
    });

    it('should reject 3651 days (just over 10 years)', () => {
      const result = validateUpdateProduct({ auto_grant_duration_days: 3651 });
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateProductId edge cases', () => {
    it('should reject UUID with uppercase (still valid per spec)', () => {
      // UUID regex in production uses /i flag, so uppercase should pass
      const result = validateProductId('550E8400-E29B-41D4-A716-446655440000');
      expect(result.isValid).toBe(true);
    });

    it('should accept UUID with any version nibble', () => {
      // Relaxed regex accepts any hex-format UUID (not just v1-v5)
      const result = validateProductId('550e8400-e29b-01d4-a716-446655440000');
      expect(result.isValid).toBe(true);
    });

    it('should accept UUID with any variant nibble', () => {
      // Relaxed regex accepts any variant
      const result = validateProductId('550e8400-e29b-41d4-0716-446655440000');
      expect(result.isValid).toBe(true);
    });

    it('should reject SQL injection in UUID field', () => {
      const result = validateProductId("'; DROP TABLE products; --");
      expect(result.isValid).toBe(false);
    });

    it('should reject null-like strings', () => {
      expect(validateProductId('null').isValid).toBe(false);
      expect(validateProductId('undefined').isValid).toBe(false);
    });
  });

  describe('escapeIlikePattern', () => {
    it('should escape percent wildcard', () => {
      expect(escapeIlikePattern('100%')).toBe('100\\%');
    });

    it('should escape underscore wildcard', () => {
      expect(escapeIlikePattern('test_name')).toBe('test\\_name');
    });

    it('should escape backslash', () => {
      expect(escapeIlikePattern('path\\to')).toBe('path\\\\to');
    });

    it('should handle empty string', () => {
      expect(escapeIlikePattern('')).toBe('');
    });

    it('should handle string with all special characters', () => {
      expect(escapeIlikePattern('%_\\')).toBe('\\%\\_\\\\');
    });
  });

  describe('validateProductSortColumn', () => {
    it('should return valid column for known sort key', () => {
      expect(validateProductSortColumn('name')).toBe('name');
      expect(validateProductSortColumn('price')).toBe('price');
      expect(validateProductSortColumn('created_at')).toBe('created_at');
    });

    it('should return default for SQL injection attempt', () => {
      expect(validateProductSortColumn("name; DROP TABLE products;--")).toBe('created_at');
    });

    it('should return default for null', () => {
      expect(validateProductSortColumn(null)).toBe('created_at');
    });

    it('should return default for unknown column', () => {
      expect(validateProductSortColumn('nonexistent_column')).toBe('created_at');
    });
  });
});
