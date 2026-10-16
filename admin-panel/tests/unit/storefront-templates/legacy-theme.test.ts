/** Legacy appearance conversion. @see contracts/theme-tokens.md */
import { describe, expect, it } from 'vitest';
import { convertLegacyTheme } from '@/lib/storefront-templates/legacy-theme';
import { tokenOverridesSchema } from '@/lib/storefront-templates/schemas';

describe('legacy theme conversion', () => {
  it('converts only declared values and reports every unsupported field', () => {
    const converted = convertLegacyTheme({ name: 'Old', colors: { accent: '#123456', 'bg-deep': '#112233', border: 'rgba(0,0,0,.1)' }, 'colors-light': { accent: '#abcdef' }, typography: { 'font-family': 'dm-sans', 'font-body-weight': '500', 'font-size-base': '17px' }, shapes: { 'radius-md': '12px', 'radius-sm': '6px', shadow: 'none' } });
    expect(converted.tokens).toEqual({ format: 1, dark: { accent: '#123456', background: '#112233' }, light: { accent: '#abcdef' }, typography: { font: 'dm-sans', bodyWeight: 500, baseSizePx: 17 }, shapes: { radiusMdPx: 12 } });
    expect(converted.unsupported).toEqual(['colors.border', 'shapes.radius-sm', 'shapes.shadow']);
    expect(tokenOverridesSchema.safeParse(converted.tokens).success).toBe(true);
  });
  it('does not accept arbitrary values or inherited fields', () => {
    const converted = convertLegacyTheme({ colors: { accent: 'url(https://example.com)', custom: '#ffffff' }, typography: { 'font-family': 'Remote', 'font-body-weight': '450' }, shapes: { 'radius-md': 'calc(2px)' } });
    expect(converted.tokens).toEqual({ format: 1 });
    expect(converted.unsupported).toHaveLength(5);
    expect(convertLegacyTheme(null).tokens).toBeNull();
  });
});
