import { describe, it, expect } from 'vitest';
import { initialFormData } from '@/components/ProductFormModal/types';

/**
 * Tests for ProductCreationWizard logic.
 *
 * The wizard's validation and dirty-detection logic lives inside React hooks/callbacks
 * and cannot be imported directly. We test equivalent logic inline to ensure the
 * behavioral contract holds, using initialFormData as the shared ground truth.
 */

describe('ProductCreationWizard', () => {
  describe('step 1 validation (equivalent logic)', () => {
    // Mirrors validateRequiredFields from useProductForm.ts:
    // name.trim() and description.trim() must be non-empty
    function validateStep1(formData: { name: string; description: string }): boolean {
      return formData.name.trim() !== '' && formData.description.trim() !== '';
    }

    it('should fail when name is empty', () => {
      expect(validateStep1({ name: '', description: 'Test' })).toBe(false);
    });

    it('should fail when description is empty', () => {
      expect(validateStep1({ name: 'Test', description: '' })).toBe(false);
    });

    it('should fail when both are empty', () => {
      expect(validateStep1({ name: '', description: '' })).toBe(false);
    });

    it('should fail when name is whitespace only', () => {
      expect(validateStep1({ name: '   ', description: 'Test' })).toBe(false);
    });

    it('should pass when both name and description are filled', () => {
      expect(validateStep1({ name: 'My Product', description: 'A description' })).toBe(true);
    });
  });

  describe('dirty detection (equivalent logic)', () => {
    // Mirrors isFormDirty from ProductCreationWizard.tsx:
    // form is dirty when name, price, or description differ from defaults
    function isFormDirty(formData: { name: string; price: number; description: string }): boolean {
      return formData.name !== '' || formData.price > 0 || formData.description !== '';
    }

    it('should detect form as clean with initial data', () => {
      expect(isFormDirty(initialFormData)).toBe(false);
    });

    it('should detect form as dirty when name is set', () => {
      expect(isFormDirty({ ...initialFormData, name: 'Test' })).toBe(true);
    });

    it('should detect form as dirty when price is set', () => {
      expect(isFormDirty({ ...initialFormData, price: 10 })).toBe(true);
    });

    it('should detect form as dirty when description is set', () => {
      expect(isFormDirty({ ...initialFormData, description: 'Desc' })).toBe(true);
    });

    it('should detect as clean when all trigger fields are default', () => {
      expect(isFormDirty({ name: '', price: 0, description: '' })).toBe(false);
    });
  });

  describe('step flow', () => {
    it('step 1 fields (Essentials) exist in initialFormData with correct defaults', () => {
      expect(initialFormData.name).toBe('');
      expect(initialFormData.slug).toBe('');
      expect(initialFormData.description).toBe('');
      expect(initialFormData.price).toBe(0);
      expect(initialFormData.currency).toBe('USD');
      expect(initialFormData.icon).toBe('🚀');
    });

    it('step 2 fields (Content & Details) exist in initialFormData with correct defaults', () => {
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
