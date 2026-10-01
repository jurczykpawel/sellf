/**
 * Unit tests for deriving a legible text variant of a seller's accent color.
 * @see src/lib/themes/contrast.ts
 */
import { describe, it, expect } from 'vitest';
import { deriveAccentText, contrastRatio } from '@/lib/themes/contrast';

// Tricky accents: pure yellow (very light, fails on light bg), light cyan (very
// light, fails on light bg), mid grey (borderline on both), dark navy (very
// dark, fails on dark bg).
const TRICKY_ACCENTS = ['#FFFF00', '#00FFFF', '#808080', '#000080'];

const DARK_BACKGROUNDS = ['#06080D', '#0B1120', '#111B2E'];
const LIGHT_BACKGROUNDS = ['#FFFFFF', '#F0F4F8', '#F1F5F9'];

describe('deriveAccentText', () => {
  for (const accent of TRICKY_ACCENTS) {
    it(`derives a dark-background-legible variant of ${accent}`, () => {
      const text = deriveAccentText(accent, DARK_BACKGROUNDS);
      for (const bg of DARK_BACKGROUNDS) {
        expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`derives a light-background-legible variant of ${accent}`, () => {
      const text = deriveAccentText(accent, LIGHT_BACKGROUNDS);
      for (const bg of LIGHT_BACKGROUNDS) {
        expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('returns the original color unchanged when it already passes', () => {
    // Near-black already reads fine on a white background.
    const accent = '#111111';
    const result = deriveAccentText(accent, ['#FFFFFF']);
    expect(result.toLowerCase()).toBe(accent.toLowerCase());
  });

  it('is deterministic', () => {
    const a = deriveAccentText('#FFFF00', LIGHT_BACKGROUNDS);
    const b = deriveAccentText('#FFFF00', LIGHT_BACKGROUNDS);
    expect(a).toBe(b);
  });
});
