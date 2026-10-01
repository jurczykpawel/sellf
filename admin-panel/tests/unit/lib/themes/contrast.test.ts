/**
 * Unit tests for the pure WCAG contrast helper.
 * @see src/lib/themes/contrast.ts
 */
import { describe, it, expect } from 'vitest';
import {
  parseColor,
  relativeLuminance,
  compositeOver,
  contrastRatio,
  meetsWCAGAA,
} from '@/lib/themes/contrast';

describe('parseColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('parses 3-digit hex (shorthand)', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('parses 8-digit hex with alpha', () => {
    expect(parseColor('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: expect.closeTo(0.5019, 3) });
  });

  it('parses rgb()', () => {
    expect(parseColor('rgb(239, 68, 68)')).toEqual({ r: 239, g: 68, b: 68, a: 1 });
  });

  it('parses rgba() with fractional alpha', () => {
    const c = parseColor('rgba(0,136,204,0.10)');
    expect(c.r).toBe(0);
    expect(c.g).toBe(136);
    expect(c.b).toBe(204);
    expect(c.a).toBeCloseTo(0.1, 5);
  });

  it('throws on an unparseable color', () => {
    expect(() => parseColor('not-a-color')).toThrow();
  });
});

describe('relativeLuminance', () => {
  it('white is 1, black is 0', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });
});

describe('compositeOver', () => {
  it('fully opaque foreground returns itself', () => {
    expect(compositeOver({ r: 10, g: 20, b: 30, a: 1 }, { r: 255, g: 255, b: 255 })).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
  });

  it('50% black over white yields mid-grey', () => {
    const result = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255 });
    expect(result.r).toBeCloseTo(127.5, 1);
    expect(result.g).toBeCloseTo(127.5, 1);
    expect(result.b).toBeCloseTo(127.5, 1);
  });
});

describe('contrastRatio', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('same color on itself is 1:1', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const a = contrastRatio('#0078BB', '#06080D');
    const b = contrastRatio('#06080D', '#0078BB');
    expect(a).toBeCloseTo(b, 5);
  });

  it('composites a translucent foreground over the given background first', () => {
    // rgba(0,0,0,0.5) over white == #808080-ish; contrast vs white should be well under 21:1
    const ratio = contrastRatio('rgba(0,0,0,0.5)', '#FFFFFF');
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(21);
  });
});

describe('meetsWCAGAA', () => {
  it('passes at exactly 4.5:1 for normal text', () => {
    expect(meetsWCAGAA(4.5)).toBe(true);
    expect(meetsWCAGAA(4.49)).toBe(false);
  });

  it('passes at 3:1 for large text / UI components', () => {
    expect(meetsWCAGAA(3, true)).toBe(true);
    expect(meetsWCAGAA(2.99, true)).toBe(false);
  });
});
