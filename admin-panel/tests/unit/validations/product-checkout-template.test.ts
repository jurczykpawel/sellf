import { describe, it, expect } from 'vitest';
import {
  validateCreateProduct,
  validateUpdateProduct,
} from '@/lib/validations/product';

const baseCreateInput = {
  name: 'Test',
  slug: 'test-product',
  description: 'desc',
  price: 10,
  currency: 'USD',
};

describe('product validator — checkout_template', () => {
  it('accepts known slug "default"', () => {
    const r = validateUpdateProduct({ checkout_template: 'default' });
    expect(r.isValid).toBe(true);
  });

  it('accepts known slug "tip-jar"', () => {
    const r = validateUpdateProduct({ checkout_template: 'tip-jar' });
    expect(r.isValid).toBe(true);
  });

  it('rejects unknown slug', () => {
    const r = validateUpdateProduct({ checkout_template: 'evil-template' });
    expect(r.isValid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/checkout_template/);
  });

  it('rejects non-string value', () => {
    const r = validateUpdateProduct({ checkout_template: 123 as unknown as string });
    expect(r.isValid).toBe(false);
  });

  it('accepts payload without the field (preserves existing value)', () => {
    const r = validateUpdateProduct({ name: 'Renamed' });
    expect(r.isValid).toBe(true);
  });
});

describe('product validator — custom_checkout_fields', () => {
  const okField = {
    id: 'message',
    type: 'textarea',
    label: 'Wiadomość',
    required: false,
    max_length: 200,
  };

  it('accepts empty array', () => {
    expect(validateUpdateProduct({ custom_checkout_fields: [] }).isValid).toBe(true);
  });

  it('accepts a single valid field', () => {
    expect(validateUpdateProduct({ custom_checkout_fields: [okField] }).isValid).toBe(true);
  });

  it('rejects unknown field type', () => {
    const r = validateUpdateProduct({
      custom_checkout_fields: [{ ...okField, type: 'wrong' }],
    });
    expect(r.isValid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/custom_checkout_fields/);
  });

  it('rejects duplicate field ids', () => {
    const r = validateUpdateProduct({
      custom_checkout_fields: [okField, { ...okField, label: 'inna' }],
    });
    expect(r.isValid).toBe(false);
  });

  it('rejects more than 10 fields (DoS hard cap)', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ ...okField, id: `f${i}` }));
    expect(validateUpdateProduct({ custom_checkout_fields: tooMany }).isValid).toBe(false);
  });
});

describe('product validator — create flow', () => {
  it('validates checkout_template and custom_checkout_fields on create', () => {
    const good = validateCreateProduct({
      ...baseCreateInput,
      checkout_template: 'tip-jar',
      custom_checkout_fields: [
        { id: 'message', type: 'textarea', label: 'Msg', required: false, max_length: 100 },
      ],
    });
    expect(good.isValid).toBe(true);

    const bad = validateCreateProduct({
      ...baseCreateInput,
      checkout_template: 'evil',
    });
    expect(bad.isValid).toBe(false);
  });
});
