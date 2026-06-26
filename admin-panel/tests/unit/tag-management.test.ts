import { describe, it, expect } from 'vitest';
import { initialFormData } from '@/components/ProductFormModal/types';

/**
 * Tests for Tag management UI logic.
 *
 * Mirrors the Categories tests: the toggle/slug logic lives inside React
 * components and cannot be imported directly, so we test the equivalent logic
 * inline against the shared contract (initialFormData as ground truth).
 *
 * @see tests/unit/product-creation-wizard.test.ts (categories equivalent)
 */

describe('Tag management', () => {
  describe('initialFormData.tags', () => {
    it('seeds an empty tag array (mirrors categories)', () => {
      expect(initialFormData.tags).toEqual([]);
    });
  });

  describe('tag toggle (equivalent logic from TagsSection)', () => {
    // Mirrors handleTagToggle in TagsSection.tsx.
    function toggleTag(tags: string[], tagId: string, checked: boolean): string[] {
      return checked ? [...tags, tagId] : tags.filter((id) => id !== tagId);
    }

    it('adds a tag when checked', () => {
      expect(toggleTag([], 'a', true)).toEqual(['a']);
    });

    it('removes a tag when unchecked', () => {
      expect(toggleTag(['a', 'b'], 'a', false)).toEqual(['b']);
    });

    it('does not duplicate-remove unrelated tags', () => {
      expect(toggleTag(['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c']);
    });
  });

  describe('tag slug generation (equivalent logic from TagFormModal)', () => {
    // Mirrors generateSlug in TagFormModal.tsx — produces a slug valid under the
    // DB CHECK regex ^[a-zA-Z0-9_-]+$.
    function generateSlug(value: string): string {
      return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
    }

    const TAG_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

    it('produces a slug that satisfies the tag DB regex', () => {
      expect(generateSlug('React & Vue!')).toBe('react-vue');
      expect(TAG_SLUG_RE.test(generateSlug('React & Vue!'))).toBe(true);
    });

    it('handles already-clean values', () => {
      expect(generateSlug('javascript')).toBe('javascript');
    });
  });
});
