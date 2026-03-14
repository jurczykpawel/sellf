import { describe, it, expect } from 'vitest';
import { normalizeBumpIds } from '@/lib/validations/product';

const VALID_UUID_1 = '550e8400-e29b-41d4-a716-446655440001';
const VALID_UUID_2 = '550e8400-e29b-41d4-a716-446655440002';
const VALID_UUID_3 = '550e8400-e29b-41d4-a716-446655440003';
const INVALID_UUID = 'not-a-uuid';
const MALFORMED_UUID = '550e8400-e29b-41d4-a716';

describe('normalizeBumpIds', () => {
  describe('normalization (backward compatibility)', () => {
    it('returns empty array when neither bumpProductId nor bumpProductIds provided', () => {
      const result = normalizeBumpIds({});
      expect(result.validIds).toEqual([]);
      expect(result.invalidIds).toEqual([]);
    });

    it('returns empty array when both are undefined', () => {
      const result = normalizeBumpIds({ bumpProductId: undefined, bumpProductIds: undefined });
      expect(result.validIds).toEqual([]);
      expect(result.invalidIds).toEqual([]);
    });

    it('normalizes legacy single bumpProductId into array', () => {
      const result = normalizeBumpIds({ bumpProductId: VALID_UUID_1 });
      expect(result.validIds).toEqual([VALID_UUID_1]);
      expect(result.invalidIds).toEqual([]);
    });

    it('uses bumpProductIds array when provided (ignores legacy field)', () => {
      const result = normalizeBumpIds({
        bumpProductId: VALID_UUID_1,
        bumpProductIds: [VALID_UUID_2, VALID_UUID_3],
      });
      expect(result.validIds).toEqual([VALID_UUID_2, VALID_UUID_3]);
    });

    it('falls back to bumpProductId when bumpProductIds is empty array', () => {
      const result = normalizeBumpIds({
        bumpProductId: VALID_UUID_1,
        bumpProductIds: [],
      });
      expect(result.validIds).toEqual([VALID_UUID_1]);
    });
  });

  describe('UUID validation', () => {
    it('filters out invalid UUIDs and reports them', () => {
      const result = normalizeBumpIds({
        bumpProductIds: [VALID_UUID_1, INVALID_UUID, VALID_UUID_2],
      });
      expect(result.validIds).toEqual([VALID_UUID_1, VALID_UUID_2]);
      expect(result.invalidIds).toEqual([INVALID_UUID]);
    });

    it('filters out malformed UUIDs', () => {
      const result = normalizeBumpIds({
        bumpProductIds: [MALFORMED_UUID],
      });
      expect(result.validIds).toEqual([]);
      expect(result.invalidIds).toEqual([MALFORMED_UUID]);
    });

    it('reports invalid legacy bumpProductId', () => {
      const result = normalizeBumpIds({ bumpProductId: INVALID_UUID });
      expect(result.validIds).toEqual([]);
      expect(result.invalidIds).toEqual([INVALID_UUID]);
    });

    it('handles all invalid IDs', () => {
      const result = normalizeBumpIds({
        bumpProductIds: [INVALID_UUID, MALFORMED_UUID],
      });
      expect(result.validIds).toEqual([]);
      expect(result.invalidIds).toEqual([INVALID_UUID, MALFORMED_UUID]);
    });

    it('handles all valid IDs', () => {
      const result = normalizeBumpIds({
        bumpProductIds: [VALID_UUID_1, VALID_UUID_2, VALID_UUID_3],
      });
      expect(result.validIds).toEqual([VALID_UUID_1, VALID_UUID_2, VALID_UUID_3]);
      expect(result.invalidIds).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('deduplicates IDs', () => {
      const result = normalizeBumpIds({
        bumpProductIds: [VALID_UUID_1, VALID_UUID_1, VALID_UUID_2],
      });
      expect(result.validIds).toEqual([VALID_UUID_1, VALID_UUID_2]);
    });

    it('handles empty string in bumpProductId', () => {
      const result = normalizeBumpIds({ bumpProductId: '' });
      expect(result.validIds).toEqual([]);
    });

    it('handles empty strings in bumpProductIds array', () => {
      const result = normalizeBumpIds({
        bumpProductIds: ['', VALID_UUID_1, ''],
      });
      expect(result.validIds).toEqual([VALID_UUID_1]);
      expect(result.invalidIds).toEqual(['']); // deduplicated
    });
  });
});
