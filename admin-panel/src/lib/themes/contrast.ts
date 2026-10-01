/**
 * Pure WCAG 2.x color-contrast helpers for the theme system.
 *
 * No DOM, no I/O — safe to run in the browser (theme editor warnings), in
 * Node (unit tests, the themeToCSS mapping), and in Playwright page
 * evaluation. Supports the hex / rgb() / rgba() syntax accepted by
 * `themeColorsSchema` (see ./index.ts).
 *
 * @see ./index.ts for ThemeConfig and themeToCSS()
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number;
}

// ===== PARSING =====

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function clamp255(n: number): number {
  return Math.min(255, Math.max(0, n));
}

/** Parses a hex / rgb() / rgba() color string into 0-255 RGB + 0-1 alpha. */
export function parseColor(input: string): RGBA {
  const value = input.trim();

  const hexMatch = value.match(HEX_RE);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgbMatch = value.match(RGB_RE);
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch;
    return {
      r: clamp255(parseFloat(r)),
      g: clamp255(parseFloat(g)),
      b: clamp255(parseFloat(b)),
      a: a === undefined ? 1 : clamp01(parseFloat(a)),
    };
  }

  throw new Error(`[color-contrast] Unparseable color: "${input}"`);
}

// ===== COMPOSITING =====

/** Alpha-blends a (possibly translucent) foreground over an opaque background. */
export function compositeOver(fg: RGBA, bg: RGB): RGB {
  if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b };
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}

/** Parses `color` and, if translucent, composites it over `backdrop` (default white). */
export function resolveOpaque(color: string, backdrop: RGB = { r: 255, g: 255, b: 255 }): RGB {
  const parsed = parseColor(color);
  return compositeOver(parsed, backdrop);
}

// ===== WCAG CONTRAST =====

function srgbChannelToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(rgb: RGB): number {
  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio (1 to 21) between two colors. Either input may be a
 * CSS color string (hex/rgb/rgba) or an already-resolved opaque RGB. A
 * translucent string is composited over the *other* color before computing
 * luminance, matching how a translucent badge/text layer actually renders
 * over its backdrop.
 */
export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const bRgb: RGB = typeof b === 'string' ? resolveOpaque(b) : b;
  const aRgb: RGB = typeof a === 'string' ? resolveOpaque(a, bRgb) : a;

  const l1 = relativeLuminance(aRgb);
  const l2 = relativeLuminance(bRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.x AA thresholds: 4.5:1 for normal text, 3:1 for large text / UI components. */
export function meetsWCAGAA(ratio: number, isLargeText = false): boolean {
  return ratio >= (isLargeText ? 3 : 4.5);
}

// ===== OKLCH (for accent-text derivation) =====
// Standard sRGB <-> OKLab/OKLCH conversion (Björn Ottosson, public domain reference
// implementation: https://bottosson.github.io/posts/oklab/).

interface OKLCH {
  l: number;
  c: number;
  h: number; // radians
}

function srgbToLinearChannel(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgbChannel(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return clamp255(Math.round(v * 255));
}

function rgbToOklch(rgb: RGB): OKLCH {
  const r = srgbToLinearChannel(rgb.r);
  const g = srgbToLinearChannel(rgb.g);
  const b = srgbToLinearChannel(rgb.b);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  return { l: L, c: Math.sqrt(a * a + bb * bb), h: Math.atan2(bb, a) };
}

function oklchToRgb(oklch: OKLCH): RGB {
  const a = oklch.c * Math.cos(oklch.h);
  const bb = oklch.c * Math.sin(oklch.h);

  const l_ = oklch.l + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = oklch.l - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = oklch.l - 0.0894841775 * a - 1.2914855480 * bb;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return {
    r: linearToSrgbChannel(r),
    g: linearToSrgbChannel(g),
    b: linearToSrgbChannel(b),
  };
}

function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => Math.round(clamp255(n)).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();
}

/**
 * Derives a legible text variant of `accentColor` against every color in
 * `backgroundColors`, by adjusting lightness (and, if needed, chroma) in
 * OKLCH space while preserving hue — so a seller's brand color stays
 * recognizable as text instead of being replaced outright.
 *
 * Direction (lighten vs darken) is chosen from the average background
 * luminance: dark surfaces get a lighter text variant, light surfaces get a
 * darker one. If the accent already meets `targetRatio` against every
 * background, it is returned unchanged (smallest possible change).
 */
export function deriveAccentText(
  accentColor: string,
  backgroundColors: string[],
  targetRatio = 4.5
): string {
  const backgrounds = backgroundColors.map((c) => resolveOpaque(c));
  const accentRgb = resolveOpaque(accentColor);

  const passes = (rgb: RGB) => backgrounds.every((bg) => contrastRatio(rgb, bg) >= targetRatio);
  if (passes(accentRgb)) return accentColor;

  const avgLuminance =
    backgrounds.reduce((sum, bg) => sum + relativeLuminance(bg), 0) / backgrounds.length;
  const lighten = avgLuminance < 0.5;

  const { l: l0, c: c0, h } = rgbToOklch(accentRgb);
  const bound = lighten ? 1 : 0;
  const STEPS = 200;

  // Sweep lightness toward the bound at full chroma first (smallest possible
  // change that preserves saturation); if even the bound itself can't reach
  // the target ratio at that chroma, progressively desaturate and re-sweep.
  // At chroma 0 (pure grayscale) L=0/L=1 always reach 21:1, so this always
  // terminates with a passing result.
  for (const chromaFactor of [1, 0.75, 0.5, 0.25, 0]) {
    const c = c0 * chromaFactor;
    for (let step = 1; step <= STEPS; step++) {
      const l = l0 + ((bound - l0) * step) / STEPS;
      const candidate = oklchToRgb({ l, c, h });
      if (passes(candidate)) return rgbToHex(candidate);
    }
  }

  // Unreachable in practice (chromaFactor 0 at the bound is pure black/white),
  // but keep a safe fallback for completeness.
  return lighten ? '#FFFFFF' : '#000000';
}

// ===== FOREGROUND PICKING (text ON a solid background) =====

export interface ForegroundPick {
  color: string;
  ratio: number;
  meetsAA: boolean;
}

/**
 * Picks whichever of a light or dark candidate contrasts better against a
 * SOLID background — for text/icons that render on top of a background that
 * must stay exactly as-is (button labels, solid status badges), where
 * `deriveAccentText` (which adjusts the color itself) isn't an option.
 *
 * Defaults to pure white/black: picking the better of those two is
 * mathematically guaranteed to clear ~4.58:1 against ANY background (the
 * worst case sits exactly at the white/black crossover point), so with the
 * defaults `meetsAA` is in practice always true. Passing less extreme
 * candidates (e.g. a theme's own near-white/near-black heading colors) can
 * genuinely fail both — `meetsAA` reports that so callers (the theme editor
 * warning) can surface it instead of silently shipping a bad pair.
 */
export function pickReadableForeground(
  background: string,
  lightCandidate = '#FFFFFF',
  darkCandidate = '#000000'
): ForegroundPick {
  const lightRatio = contrastRatio(lightCandidate, background);
  const darkRatio = contrastRatio(darkCandidate, background);
  const best =
    lightRatio >= darkRatio
      ? { color: lightCandidate, ratio: lightRatio }
      : { color: darkCandidate, ratio: darkRatio };
  return { ...best, meetsAA: meetsWCAGAA(best.ratio) };
}

// ===== FIXED STATUS SOFT TINTS =====
// danger/warning/success "soft" badge backgrounds are NOT theme-configurable (see
// COLOR_MAP in ./index.ts — only accent-soft is) — they're the fixed design tokens
// from globals.css. Exported so ./index.ts can fold the actual composited badge
// background into the status-text derivation (and the editor warning stays accurate).
export const FIXED_STATUS_SOFT_TINTS = {
  dark: {
    danger: 'rgba(239,68,68,0.10)',
    warning: 'rgba(245,158,11,0.10)',
    success: 'rgba(16,185,129,0.10)',
  },
  light: {
    danger: 'rgba(153,27,27,0.12)',
    warning: 'rgba(146,64,14,0.12)',
    success: 'rgba(6,95,70,0.12)',
  },
} as const;

// ===== THEME-LEVEL CONTRAST WARNINGS (editor UI + preset validation) =====

export interface ContrastIssue {
  /** Stable identifier for the pair, e.g. "heading-on-base". */
  id: string;
  /** Human-readable label, e.g. "Heading text on base background". */
  label: string;
  ratio: number;
  required: number;
}

/**
 * Checks the color pairs that are NOT already self-corrected by themeToCSS()
 * (see ./index.ts — `accent`/`danger`/`warning`/`success` text variants are
 * auto-derived there, so they always pass and aren't re-checked here) against
 * the surfaces they actually render on, and returns the ones that fail WCAG
 * AA. Takes the resolved CSS variable map themeToCSS() produces (NOT a raw
 * ThemeConfig) so it reflects exactly what the browser will paint — pure/no
 * I/O, safe for both the theme editor (client) and preset validation (tests).
 */
export function evaluateCssVarsContrast(vars: Record<string, string>): ContrastIssue[] {
  const heading = vars['--color-sf-heading'];
  const body = vars['--color-sf-body'] || heading;
  const muted = vars['--color-sf-muted'] || body;
  const base = vars['--color-sf-base'] || vars['--color-sf-deep'];
  const raised = vars['--color-sf-raised'] || base;

  const pairs: { id: string; label: string; fg?: string; bg?: string; large?: boolean }[] = [
    { id: 'heading-on-base', label: 'Heading text on base background', fg: heading, bg: base },
    { id: 'body-on-base', label: 'Body text on base background', fg: body, bg: base },
    { id: 'muted-on-raised', label: 'Muted text on raised surface', fg: muted, bg: raised },
    // Solid button backgrounds intentionally stay the seller's exact brand/status
    // color (see ./index.ts) — pickReadableForeground() already picks whichever of
    // white/near-black reads better against it (--sf-*-fg), which mathematically
    // always clears AA for that choice of candidates. This still checks the actual
    // picked color (not a hardcoded white) so a future non-default candidate pair
    // that genuinely can't reach AA is still surfaced here, not silently shipped.
    { id: 'button-text-on-accent', label: 'Button text on accent background', fg: vars['--sf-accent-fg'] || '#FFFFFF', bg: vars['--sf-accent-bg'] },
    { id: 'button-text-on-danger', label: 'Button text on danger background', fg: vars['--sf-danger-fg'] || '#FFFFFF', bg: vars['--sf-danger-bg'] },
  ];

  const issues: ContrastIssue[] = [];
  for (const pair of pairs) {
    if (!pair.fg || !pair.bg) continue;
    const required = pair.large ? 3 : 4.5;
    const ratio = contrastRatio(pair.fg, pair.bg);
    if (!meetsWCAGAA(ratio, pair.large)) {
      issues.push({ id: pair.id, label: pair.label, ratio, required });
    }
  }
  return issues;
}
