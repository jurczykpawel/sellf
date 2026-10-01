/**
 * Integration-ish unit tests: every shipped theme preset must produce
 * AA-legible accent/status text colors (--color-sf-accent/danger/warning/
 * success) in both its dark and light variants, via the real themeToCSS()
 * mapping — not a hand-tuned value that can silently drift from the preset
 * JSON. Also covers evaluateCssVarsContrast(), the shared helper behind the
 * non-blocking theme-editor warning.
 * @see src/lib/themes/index.ts
 * @see src/lib/themes/contrast.ts
 */
import { describe, it, expect } from 'vitest';
import { THEME_PRESETS, themeToCSS } from '@/lib/themes';
import { contrastRatio, evaluateCssVarsContrast } from '@/lib/themes/contrast';

describe('themeToCSS — accent/status text legibility', () => {
  for (const { id, theme } of THEME_PRESETS) {
    for (const isDark of [true, false]) {
      const mode = isDark ? 'dark' : 'light';

      it(`${id} (${mode}) — accent/danger/warning/success text passes AA on raised + base`, () => {
        const vars = themeToCSS(theme, isDark);
        const raised = vars['--sf-bg-raised'] || vars['--sf-bg-base'] || vars['--sf-bg-deep'];
        const base = vars['--sf-bg-base'] || vars['--sf-bg-deep'];

        for (const token of ['--color-sf-accent', '--color-sf-danger', '--color-sf-warning', '--color-sf-success']) {
          const text = vars[token];
          if (!text) continue; // preset doesn't define this status color
          expect(contrastRatio(text, raised), `${token} vs raised`).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(text, base), `${token} vs base`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it(`${id} (${mode}) — derived fg text passes AA on its own solid accent/danger background`, () => {
        // Solid button backgrounds stay the seller's exact brand color (no derivation) —
        // pickReadableForeground() instead derives WHICH text color (white vs near-black)
        // to use on top of it, so this checks --sf-*-fg against --sf-*-bg, not a hardcoded white.
        const vars = themeToCSS(theme, isDark);
        expect(contrastRatio(vars['--sf-accent-fg'], vars['--sf-accent-bg'])).toBeGreaterThanOrEqual(4.5);
        if (vars['--sf-danger-fg'] && vars['--sf-danger-bg']) {
          expect(contrastRatio(vars['--sf-danger-fg'], vars['--sf-danger-bg'])).toBeGreaterThanOrEqual(4.5);
        }
      });

      it(`${id} (${mode}) — evaluateCssVarsContrast reports no issues`, () => {
        const vars = themeToCSS(theme, isDark);
        expect(evaluateCssVarsContrast(vars)).toEqual([]);
      });
    }
  }
});

describe('evaluateCssVarsContrast', () => {
  it('flags heading text that is nearly invisible on its own base surface', () => {
    const issues = evaluateCssVarsContrast({
      '--color-sf-heading': '#101114',
      '--color-sf-base': '#0C0D10',
      '--sf-accent-bg': '#000000',
      '--sf-danger-bg': '#000000',
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.find((i) => i.id === 'heading-on-base')).toBeDefined();
    expect(issues.every((i) => i.ratio < 4.5)).toBe(true);
  });

  it('flags button text when even the picked fg cannot reach AA on the accent background', () => {
    // In practice themeToCSS() always derives a passing --sf-accent-fg (picking white vs.
    // near-black against ANY background mathematically clears ~4.58:1), so this feeds a
    // deliberately bad fg/bg pair directly to test the warning path on its own merits.
    const issues = evaluateCssVarsContrast({
      '--color-sf-heading': '#000000',
      '--color-sf-base': '#FFFFFF',
      '--sf-accent-bg': '#F0F0F0',
      '--sf-accent-fg': '#F5F5F5',
    });
    expect(issues.find((i) => i.id === 'button-text-on-accent')).toBeDefined();
  });

  it('returns no issues for a theme that already passes AA everywhere checked', () => {
    const issues = evaluateCssVarsContrast({
      '--color-sf-heading': '#000000',
      '--color-sf-body': '#000000',
      '--color-sf-muted': '#000000',
      '--color-sf-base': '#FFFFFF',
      '--color-sf-raised': '#FFFFFF',
      '--sf-accent-bg': '#000000',
      '--sf-danger-bg': '#000000',
    });
    expect(issues).toEqual([]);
  });
});
