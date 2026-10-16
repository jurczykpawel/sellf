/** Local typography must retain the supported weights and Polish glyphs. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface FontMetadata {
  familyName: string;
  variationAxes: Record<string, { min: number; max: number }>;
  'OS/2': { usWeightClass: number };
  hasGlyphForCodePoint: (code: number) => boolean;
}

const require = createRequire(import.meta.url);
const parseFont = require('next/dist/compiled/@next/font/dist/fontkit').default as (data: Buffer) => FontMetadata;
const fonts = [
  ['geist-variable.woff2', 'Geist', 100, 900],
  ['geist-mono-variable.woff2', 'Geist Mono', 100, 900],
  ['dm-sans-variable.woff2', 'DM Sans', 300, 800],
  ['dm-mono-regular.woff2', 'DM Mono', 400, 400],
  ['dm-mono-medium.woff2', 'DM Mono', 500, 500],
] as const;

describe('local application fonts', () => {
  it.each(fonts)('%s retains its family, weights and Latin/Polish characters', (file, family, min, max) => {
    const font = parseFont(readFileSync(resolve('src/app/fonts', file)));
    expect(font.familyName).toContain(family);
    const weight = font.variationAxes.wght;
    if (weight) {
      expect(weight.min).toBeLessThanOrEqual(min);
      expect(weight.max).toBeGreaterThanOrEqual(max);
    } else {
      expect(font['OS/2'].usWeightClass).toBe(min);
      expect(min).toBe(max);
    }
    for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzĄĆĘŁŃÓŚŹŻąćęłńóśźż') {
      expect(font.hasGlyphForCodePoint(character.codePointAt(0)!), `${file}: ${character}`).toBe(true);
    }
  });

  it('loads every committed font through next/font/local with the existing CSS variables', () => {
    const layout = readFileSync(resolve('src/app/layout.tsx'), 'utf8');
    expect(layout).toContain('from "next/font/local"');
    expect(layout).not.toContain('next/font/google');
    for (const [file] of fonts) expect(layout).toContain(`./fonts/${file}`);
    for (const variable of ['--font-geist-sans', '--font-geist-mono', '--font-dm-sans', '--font-dm-mono']) {
      expect(layout).toContain(variable);
    }
  });
});
