import { describe, it, expect } from 'vitest';
import { validateCreateProduct, validateUpdateProduct } from '@/lib/validations/product';

/**
 * Tests for features field validation in product create/update.
 *
 * Features must be {title: string, items: string[]}[].
 * Plain string arrays must be rejected to prevent frontend crashes.
 *
 * @see src/lib/validations/product.ts — validateFeatures()
 * @see src/app/[locale]/checkout/[slug]/components/ProductShowcase.tsx
 */

const VALID_BASE = {
  name: 'Test Product',
  slug: 'test-product',
  description: 'A test product',
  price: 10,
};

describe('features validation', () => {
  describe('validateCreateProduct', () => {
    it('accepts valid features with title and items', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: [{ title: 'What you get', items: ['Feature 1', 'Feature 2'] }],
      });
      expect(result.isValid).toBe(true);
    });

    it('accepts empty features array', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: [],
      });
      expect(result.isValid).toBe(true);
    });

    it('accepts null features', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: null,
      });
      expect(result.isValid).toBe(true);
    });

    it('accepts undefined features (not provided)', () => {
      const result = validateCreateProduct(VALID_BASE);
      expect(result.isValid).toBe(true);
    });

    it('rejects plain string array (the crash scenario)', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: ['tekst1', 'tekst2'],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('plain string'))).toBe(true);
    });

    it('rejects mixed array with strings and objects', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: [
          { title: 'Valid', items: ['ok'] },
          'plain string',
        ],
      });
      expect(result.isValid).toBe(false);
    });

    it('rejects object missing title', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: [{ items: ['Feature 1'] }],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('title'))).toBe(true);
    });

    it('rejects object missing items', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: [{ title: 'Section' }],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('items'))).toBe(true);
    });

    it('rejects object with non-string items', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: [{ title: 'Section', items: [123, true] }],
      });
      expect(result.isValid).toBe(false);
    });

    it('rejects non-array features (object)', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: { title: 'Not an array' },
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('must be an array'))).toBe(true);
    });

    it('rejects title longer than 200 chars', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: [{ title: 'x'.repeat(201), items: ['ok'] }],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('200 characters'))).toBe(true);
    });

    it('rejects item longer than 500 chars', () => {
      const result = validateCreateProduct({
        ...VALID_BASE,
        features: [{ title: 'Section', items: ['x'.repeat(501)] }],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('500 characters'))).toBe(true);
    });
  });

  describe('validateUpdateProduct', () => {
    it('accepts valid features in partial update', () => {
      const result = validateUpdateProduct({
        features: [{ title: 'Updated', items: ['New item'] }],
      });
      expect(result.isValid).toBe(true);
    });

    it('rejects plain string array in partial update', () => {
      const result = validateUpdateProduct({
        features: ['tekst1', 'tekst2'],
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('plain string'))).toBe(true);
    });

    it('skips validation when features not provided', () => {
      const result = validateUpdateProduct({ name: 'New name' });
      expect(result.isValid).toBe(true);
    });
  });
});

describe('vat_exempt validation', () => {
  it('accepts vat_exempt true/false on create', () => {
    expect(validateCreateProduct({ ...VALID_BASE, vat_exempt: true }).isValid).toBe(true);
    expect(validateCreateProduct({ ...VALID_BASE, vat_exempt: false }).isValid).toBe(true);
  });

  it('accepts a vat_exempt_note within 500 chars', () => {
    const result = validateCreateProduct({ ...VALID_BASE, vat_exempt: true, vat_exempt_note: 'zw. z VAT — art. 113 ust. 1' });
    expect(result.isValid).toBe(true);
  });

  it('rejects a vat_exempt_note longer than 500 chars (create)', () => {
    const result = validateCreateProduct({ ...VALID_BASE, vat_exempt_note: 'x'.repeat(501) });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('vat_exempt_note'))).toBe(true);
  });

  it('rejects a vat_exempt_note longer than 500 chars (update)', () => {
    const result = validateUpdateProduct({ vat_exempt_note: 'y'.repeat(501) });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('vat_exempt_note'))).toBe(true);
  });
});
