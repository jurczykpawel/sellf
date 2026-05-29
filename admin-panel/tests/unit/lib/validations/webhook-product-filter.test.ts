/**
 * Unit tests for webhook product-scoping validation.
 */

import { describe, it, expect } from 'vitest';
import {
  isValidProductFilterMode,
  validateProductFilter,
  WEBHOOK_PRODUCT_FILTER_MODES,
} from '@/lib/validations/webhook';

const UUID_A = '11111111-1111-4111-a111-111111111111';
const UUID_B = '22222222-2222-4222-a222-222222222222';

describe('isValidProductFilterMode', () => {
  it('accepts the known modes', () => {
    expect(isValidProductFilterMode('all')).toBe(true);
    expect(isValidProductFilterMode('selected')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidProductFilterMode('everything')).toBe(false);
    expect(isValidProductFilterMode('')).toBe(false);
  });

  it('exposes the canonical mode list', () => {
    expect(WEBHOOK_PRODUCT_FILTER_MODES).toEqual(['all', 'selected']);
  });
});

describe('validateProductFilter', () => {
  it('treats an undefined mode as valid (defaults to all)', () => {
    expect(validateProductFilter(undefined, undefined).valid).toBe(true);
  });

  it('accepts mode=all regardless of product ids', () => {
    expect(validateProductFilter('all', undefined).valid).toBe(true);
    expect(validateProductFilter('all', []).valid).toBe(true);
  });

  it('rejects an unknown mode', () => {
    const result = validateProductFilter('bogus', undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/mode/i);
  });

  it('accepts mode=selected with a non-empty list of valid uuids', () => {
    expect(validateProductFilter('selected', [UUID_A, UUID_B]).valid).toBe(true);
  });

  it('rejects mode=selected with an empty product list', () => {
    const result = validateProductFilter('selected', []);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least one product/i);
  });

  it('rejects mode=selected when product ids are missing', () => {
    expect(validateProductFilter('selected', undefined).valid).toBe(false);
  });

  it('rejects mode=selected when product ids are not an array', () => {
    expect(validateProductFilter('selected', 'not-an-array').valid).toBe(false);
  });

  it('rejects mode=selected with a malformed uuid', () => {
    const result = validateProductFilter('selected', [UUID_A, 'not-a-uuid']);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/product/i);
  });
});
