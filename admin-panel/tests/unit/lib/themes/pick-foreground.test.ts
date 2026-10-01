/**
 * Unit tests for picking the more-readable foreground (light vs dark
 * candidate) for a solid background color — used for button labels and
 * solid status badges, where the background itself must stay the seller's
 * exact brand color (see src/lib/themes/index.ts).
 * @see src/lib/themes/contrast.ts
 */
import { describe, it, expect } from 'vitest';
import { pickReadableForeground, contrastRatio } from '@/lib/themes/contrast';

describe('pickReadableForeground', () => {
  it('picks white on a dark navy background', () => {
    const result = pickReadableForeground('#0B1120');
    expect(result.color).toBe('#FFFFFF');
    expect(result.meetsAA).toBe(true);
  });

  it('picks black on a near-white background', () => {
    const result = pickReadableForeground('#E4E4E7');
    expect(result.color).toBe('#000000');
    expect(result.meetsAA).toBe(true);
  });

  it('picks black on a mid-bright orange background', () => {
    // #FF6B35: white contrast ~2.84, black contrast ~7.41 — black is clearly better.
    const result = pickReadableForeground('#FF6B35');
    expect(result.color).toBe('#000000');
    expect(result.meetsAA).toBe(true);
  });

  it('reports the actual ratio and AA status for a mid-grey background', () => {
    // #808080 measured: white ~3.95, black ~5.32. Picking the better of pure
    // white/black is mathematically guaranteed to clear ~4.58:1 against ANY
    // background (the worst case is exactly at the white/black crossover
    // point), so this one happens to still pass AA via black — this test
    // locks in the measured numbers rather than assuming a failure.
    const result = pickReadableForeground('#808080');
    expect(result.color).toBe('#000000');
    expect(result.ratio).toBeCloseTo(contrastRatio('#000000', '#808080'), 5);
    expect(result.meetsAA).toBe(true);
  });

  it('falls back to the better (still non-AA) candidate when neither reaches 4.5:1', () => {
    // Pure black/white can never both fail (proven above), so to exercise the
    // "neither candidate reaches AA" fallback honestly, use two deliberately
    // non-extreme candidates against a background sitting between them.
    const result = pickReadableForeground('#999999', '#AAAAAA', '#777777');
    expect(result.meetsAA).toBe(false);
    expect(result.ratio).toBeGreaterThan(1);
    // Still returns whichever of the two candidates contrasts better, not a crash/NaN.
    expect(['#AAAAAA', '#777777']).toContain(result.color);
  });

  it('supports custom light/dark candidates (e.g. a theme´s own heading colors)', () => {
    const result = pickReadableForeground('#111111', '#F0F4FA', '#0B1120');
    expect(result.color).toBe('#F0F4FA');
    expect(result.meetsAA).toBe(true);
  });
});
