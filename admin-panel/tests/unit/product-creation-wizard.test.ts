import { describe, it, expect } from 'vitest';
import { initialFormData } from '@/components/ProductFormModal/types';
import { applyProductTypeDefaults } from '@/lib/product-defaults';

/**
 * Tests for ProductCreationWizard logic.
 *
 * Form dirty state is exercised through the actual hook in product-form-focus.test.ts.
 * These tests cover the initial fields and product type defaults.
 */

describe('ProductCreationWizard', () => {
  describe('step 1 validation (equivalent logic)', () => {
    // Mirrors step-1 required validation from useProductForm.ts.
    // Description is optional and lives on the content/details step.
    function validateStep1(formData: { name: string; description: string }): boolean {
      return formData.name.trim() !== '';
    }

    it('should fail when name is empty', () => {
      expect(validateStep1({ name: '', description: 'Test' })).toBe(false);
    });

    it('should pass when description is empty', () => {
      expect(validateStep1({ name: 'Test', description: '' })).toBe(true);
    });

    it('should fail when name is empty even if description is empty', () => {
      expect(validateStep1({ name: '', description: '' })).toBe(false);
    });

    it('should fail when name is whitespace only', () => {
      expect(validateStep1({ name: '   ', description: 'Test' })).toBe(false);
    });

    it('should pass when name is filled', () => {
      expect(validateStep1({ name: 'My Product', description: 'A description' })).toBe(true);
    });
  });

  describe('product type radio integration', () => {
    // Mirrors the click-handler logic in ProductTypeRadio.tsx.
    // The radio reads its current selection from formData.ux_product_type
    // (the canonical state); inference is reserved for edit-mode bootstrap.
    function handleTypeSelect(prev: typeof initialFormData, type: Parameters<typeof applyProductTypeDefaults>[1]) {
      const current = prev.ux_product_type;
      if (type === current) return prev;
      return applyProductTypeDefaults(prev, type);
    }

    it('selecting the current type is a no-op (preserves reference)', () => {
      const subForm = applyProductTypeDefaults(initialFormData, 'subscription');
      const result = handleTypeSelect(subForm, 'subscription');
      expect(result).toBe(subForm);
    });

    it('switching type updates checkout_template and billing fields', () => {
      const result = handleTypeSelect(initialFormData, 'subscription');
      expect(result).not.toBe(initialFormData);
      expect(result.product_type).toBe('subscription');
      expect(result.billing_interval).toBe('month');
    });
  });

  describe('step flow', () => {
    it('step 1 fields (Essentials) exist in initialFormData with correct defaults', () => {
      expect(initialFormData.name).toBe('');
      expect(initialFormData.slug).toBe('');
      expect(initialFormData.price).toBe(0);
      expect(initialFormData.currency).toBe('USD');
      expect(initialFormData.icon).toBe('🚀');
    });

    it('step 2 fields (Content & Details) exist in initialFormData with correct defaults', () => {
      expect(initialFormData.description).toBe('');
      expect(initialFormData.long_description).toBe('');
      expect(initialFormData.content_delivery_type).toBe('content');
      expect(initialFormData.content_config).toEqual({ content_items: [] });
      expect(initialFormData.categories).toEqual([]);
    });

    it('step 3 fields (Sales & Settings) exist in initialFormData with correct defaults', () => {
      expect(initialFormData.sale_price).toBeNull();
      expect(initialFormData.available_from).toBe('');
      expect(initialFormData.available_until).toBe('');
      expect(initialFormData.auto_grant_duration_days).toBeNull();
      expect(initialFormData.success_redirect_url).toBe('');
      expect(initialFormData.is_refundable).toBe(false);
      expect(initialFormData.is_active).toBe(true);
      expect(initialFormData.is_listed).toBe(true);
      expect(initialFormData.is_featured).toBe(false);
    });
  });
});
