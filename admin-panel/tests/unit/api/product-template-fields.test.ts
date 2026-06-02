import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PRODUCT_API_FIELDS } from '@/lib/validations/product';
import { ProductUpdateDTO } from '@/lib/api/dto/product';

describe('product API template fields', () => {
  it('returns checkout template fields after create/update', () => {
    expect(PRODUCT_API_FIELDS).toContain('checkout_template');
    expect(PRODUCT_API_FIELDS).toContain('custom_checkout_fields');
  });

  it('accepts checkout template fields in API input DTO', () => {
    const parsed = ProductUpdateDTO.safeParse({
      checkout_template: 'tip-jar',
      custom_checkout_fields: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('public product GET includes checkout_template for edit hydration', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/products/[id]/route.ts'), 'utf8');
    expect(src).toMatch(/checkout_template/);
    expect(src).toMatch(/custom_checkout_fields/);
  });
});
