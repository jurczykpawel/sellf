/** Public appearance resolution and coverage. */
import { describe, expect, it } from 'vitest';
import { D_TOKENS } from '@/lib/storefront-templates/fixtures';
import { CORE_TOKENS, PUBLIC_THEME_ROUTES, publicThemeCSS, resolvePublicTheme, validateThemeContrast } from '@/lib/storefront-templates/public-theme';

describe('public theme resolution', () => {
  it('resolves every leaf and records its source', () => {
    const core = resolvePublicTheme(null, null, false);
    expect(core.tokens).toEqual(CORE_TOKENS);
    expect(core.effective).toHaveLength(22);
    expect(core.effective.every(t => t.origin === 'core')).toBe(true);
    const theme = resolvePublicTheme(D_TOKENS, { format: 1, light: { accent: '#075C43' } }, true);
    expect(theme.effective.find(t => t.path === 'tokens.light.accent')).toEqual({ path: 'tokens.light.accent', value: '#075C43', origin: 'seller' });
    expect(theme.effective.find(t => t.path === 'tokens.dark.accent')?.origin).toBe('template');
    expect(resolvePublicTheme(D_TOKENS, { format: 1 }, true).tokens).toEqual(D_TOKENS);
  });
  it('follows compatible new defaults after one leaf is removed without changing retained content', () => {
    const overrides = { format: 1, light: { accent: '#075C43' } };
    const later = structuredClone(D_TOKENS); later.light.accent = '#06533D';
    const saved = JSON.stringify(overrides);
    expect(resolvePublicTheme(later, overrides, true).tokens.light.accent).toBe('#075C43');
    expect(JSON.stringify(overrides)).toBe(saved);
    const reset = resolvePublicTheme(later, { format: 1 }, true);
    expect(reset.tokens.light.accent).toBe('#06533D');
    expect(reset.effective.find(t => t.path === 'tokens.light.accent')?.origin).toBe('template');
  });
  it('gates seller values independently from template defaults', () => {
    const result = resolvePublicTheme(D_TOKENS, { format: 1, typography: { font: 'dm-sans' } }, false);
    expect(result.tokens).toEqual(D_TOKENS);
    expect(result.diagnostics).toContain('ENTITLEMENT');
  });
  it.each([
    { format: 1, light: { accent: 'url(https://example.com)' } },
    { format: 1, typography: { font: 'Inter' } },
    { format: 1, typography: { bodyWeight: '400;display:none' } },
    { format: 1, shapes: { radiusSmPx: null } },
    { format: 1, light: { accent: '#fff' } },
    { format: 1, light: { background: '#FFFFFF', arbitrary: '#FFFFFF' } },
  ])('uses defaults for values outside the contract: %j', overrides => {
    const result = resolvePublicTheme(D_TOKENS, overrides, true);
    expect(result.tokens).toEqual(D_TOKENS); expect(result.diagnostics).toContain('SCHEMA');
    expect(publicThemeCSS(result.tokens)).not.toContain('https:');
  });
  it('validates resolved pairs in both modes and retains readable defaults on failure', () => {
    expect(validateThemeContrast(D_TOKENS)).toEqual([]);
    expect(validateThemeContrast(CORE_TOKENS)).toEqual([]);
    for (const mode of ['light', 'dark'] as const) {
      for (const leaf of ['foreground', 'mutedForeground', 'accent', 'border'] as const) {
        const result = resolvePublicTheme(D_TOKENS, { format: 1, [mode]: { [leaf]: D_TOKENS[mode].background } }, true);
        expect(result.tokens).toEqual(D_TOKENS); expect(result.diagnostics).toContain('CONTRAST');
      }
    }
  });
  it('falls back to core for invalid template defaults', () => {
    expect(resolvePublicTheme({ ...D_TOKENS, typography: {} }, null, true).tokens).toEqual(CORE_TOKENS);
    const low = structuredClone(D_TOKENS); low.dark.accentForeground = low.dark.accent;
    expect(resolvePublicTheme(low, null, true).tokens).toEqual(CORE_TOKENS);
  });
  it('clamps protected leaves last and reports protected origins', () => {
    const result = resolvePublicTheme(D_TOKENS, { format: 1, typography: { font: 'dm-sans', baseSizePx: 18, bodyWeight: 500 }, shapes: { radiusMdPx: 4 } }, true, 'protected');
    expect(result.tokens.typography).toEqual({ ...CORE_TOKENS.typography, font: 'dm-sans' });
    expect(result.tokens.shapes).toEqual(CORE_TOKENS.shapes);
    expect(result.tokens.light.muted).toBe(CORE_TOKENS.light.muted);
    expect(result.tokens.light.accent).toBe(D_TOKENS.light.accent);
    expect(result.effective.find(t => t.path === 'tokens.shapes.radiusMdPx')?.origin).toBe('protected');
    expect(result.effective.find(t => t.path === 'tokens.typography.font')?.origin).toBe('seller');
  });
  it.each(['geist', 'dm-sans'] as const)('maps %s to bundled variables and both alias families', font => {
    const { tokens } = resolvePublicTheme(D_TOKENS, { format: 1, typography: { font } }, true);
    const css = publicThemeCSS(tokens);
    expect(css).toContain(font === 'geist' ? 'var(--font-geist-sans)' : 'var(--font-dm-sans)');
    expect(css).toContain('--sf-font-heading-weight:600'); expect(css).toContain('--sf-radius-md:12px');
    expect(css).toContain('--sf-accent-foreground:'); expect(css).toContain('--color-sf-accent-bg:');
    expect(css).toContain('prefers-color-scheme:dark'); expect(css).toContain('.dark ');
    expect(css).not.toContain(':root{');
  });
  it('freezes route coverage with no prefix matching for excluded routes', () => {
    expect(PUBLIC_THEME_ROUTES).toEqual({ storefront: ['/', '/store'], protected: ['/p/[slug]', '/checkout/[slug]', '/login', '/terms', '/privacy'] });
  });
});
