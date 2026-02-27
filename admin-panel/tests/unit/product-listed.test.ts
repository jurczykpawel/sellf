/**
 * Product is_listed flag tests
 *
 * Tests that is_listed is properly supported in:
 * 1. initialFormData (UI defaults)
 * 2. sanitizeProductData (validation/sanitization layer)
 */

import { describe, it, expect } from 'vitest';
import { sanitizeProductData } from '@/lib/validations/product';
import { initialFormData } from '@/components/ProductFormModal/types';

describe('Product is_listed flag', () => {
  describe('initialFormData', () => {
    it('should default is_listed to true', () => {
      expect(initialFormData.is_listed).toBe(true);
    });

    it('should have is_listed alongside is_active and is_featured', () => {
      expect(initialFormData).toHaveProperty('is_active', true);
      expect(initialFormData).toHaveProperty('is_featured', false);
      expect(initialFormData).toHaveProperty('is_listed', true);
    });
  });

  describe('sanitizeProductData', () => {
    it('should preserve is_listed=true through sanitization', () => {
      const data = {
        name: 'Test Product',
        slug: 'test-product',
        price: 10,
        is_active: true,
        is_listed: true,
        is_featured: false,
      };
      const result = sanitizeProductData(data);
      // is_listed must survive sanitization (not be deleted like id, created_at, etc.)
      expect(result).toHaveProperty('is_listed', true);
    });

    it('should preserve is_listed=false through sanitization', () => {
      const data = {
        name: 'Hidden Product',
        slug: 'hidden-product',
        price: 20,
        is_listed: false,
      };
      const result = sanitizeProductData(data);
      expect(result).toHaveProperty('is_listed', false);
    });

    it('should not inject is_listed when not provided (partial update)', () => {
      const data = { name: 'Updated Name' };
      const result = sanitizeProductData(data, false);
      expect(result).not.toHaveProperty('is_listed');
    });

    it('should strip dangerous fields but keep is_listed', () => {
      const data = {
        id: 'should-be-stripped',
        created_at: 'should-be-stripped',
        updated_at: 'should-be-stripped',
        sale_quantity_sold: 999,
        is_listed: false,
        name: 'Test',
      };
      const result = sanitizeProductData(data);
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('created_at');
      expect(result).not.toHaveProperty('updated_at');
      expect(result).not.toHaveProperty('sale_quantity_sold');
      expect(result).toHaveProperty('is_listed', false);
    });

    it('[GAP] setDefaults=true does NOT set a default for is_listed', () => {
      // When creating a product with setDefaults=true but no is_listed provided,
      // the sanitizer sets defaults for is_active, is_featured, currency, icon, etc.
      // but does NOT set a default for is_listed.
      // This means the database default (or lack thereof) determines the value.
      const data = { name: 'Minimal Product' };
      const result = sanitizeProductData(data, true);

      // Verify other defaults ARE applied
      expect(result).toHaveProperty('is_active', true);
      expect(result).toHaveProperty('is_featured', false);
      expect(result).toHaveProperty('currency', 'USD');
      expect(result).toHaveProperty('icon', expect.any(String));

      // Document that is_listed has NO default in sanitizeProductData
      expect(result).not.toHaveProperty('is_listed');
    });

    it('[GAP] setDefaults=true sets is_active but not is_listed (asymmetry)', () => {
      // Both are boolean flags, but only is_active gets a default.
      // This verifies the asymmetry behaviorally — no source-code scanning.
      const withDefaults = sanitizeProductData({ name: 'Test' }, true);
      const withoutDefaults = sanitizeProductData({ name: 'Test' }, false);

      // is_active IS set by setDefaults
      expect(withDefaults).toHaveProperty('is_active', true);
      expect(withoutDefaults).not.toHaveProperty('is_active');

      // is_listed is NOT set by setDefaults (same behavior as without defaults)
      expect(withDefaults).not.toHaveProperty('is_listed');
      expect(withoutDefaults).not.toHaveProperty('is_listed');
    });
  });
});
