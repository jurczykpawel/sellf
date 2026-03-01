/**
 * Theme system — type definitions, Zod schema, and preset loader.
 * Themes are JSON configs that map to CSS custom properties (--sf-*).
 * @see globals.css for the --sf-* variable definitions
 * @see components/providers/whitelabel-provider.tsx for CSS injection
 */

import { z } from 'zod';

// ===== SCHEMA =====

const cssColorPattern = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)$/;

const colorSchema = z.string().regex(cssColorPattern, 'Invalid CSS color value');
const cssValueSchema = z.string().min(1).max(200);

export const themeColorsSchema = z.object({
  accent: colorSchema,
  'accent-hover': colorSchema,
  'accent-soft': colorSchema,
  'accent-med': colorSchema.optional(),
  'accent-glow': colorSchema.optional(),
  'bg-deep': colorSchema,
  'bg-base': colorSchema.optional(),
  'bg-raised': colorSchema.optional(),
  'bg-float': colorSchema.optional(),
  'text-heading': colorSchema,
  'text-body': colorSchema.optional(),
  'text-muted': colorSchema.optional(),
  border: colorSchema.optional(),
  'border-accent': colorSchema.optional(),
  success: colorSchema.optional(),
  warning: colorSchema.optional(),
  danger: colorSchema.optional(),
});

export const themeTypographySchema = z.object({
  'font-family': cssValueSchema.optional(),
  'font-heading-weight': cssValueSchema.optional(),
  'font-body-weight': cssValueSchema.optional(),
  'font-size-base': cssValueSchema.optional(),
  'letter-spacing-heading': cssValueSchema.optional(),
});

export const themeShapesSchema = z.object({
  'radius-sm': cssValueSchema.optional(),
  'radius-md': cssValueSchema.optional(),
  'radius-lg': cssValueSchema.optional(),
  'radius-full': cssValueSchema.optional(),
  shadow: cssValueSchema.optional(),
  'shadow-accent': cssValueSchema.optional(),
});

export const themeConfigSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().optional().default('1.0'),
  author: z.string().max(100).optional(),
  colors: themeColorsSchema,
  'colors-light': themeColorsSchema.partial().optional(),
  typography: themeTypographySchema.optional(),
  shapes: themeShapesSchema.optional(),
});

// ===== TYPES =====

export type ThemeConfig = z.infer<typeof themeConfigSchema>;
export type ThemeColors = z.infer<typeof themeColorsSchema>;
export type ThemeTypography = z.infer<typeof themeTypographySchema>;
export type ThemeShapes = z.infer<typeof themeShapesSchema>;

// ===== PRESET LOADER =====

import defaultTheme from './default.json';
import sunsetTheme from './sunset.json';
import oceanTheme from './ocean.json';
import forestTheme from './forest.json';
import minimalLightTheme from './minimal-light.json';

export interface ThemePreset {
  id: string;
  theme: ThemeConfig;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'default', theme: defaultTheme as ThemeConfig },
  { id: 'sunset', theme: sunsetTheme as ThemeConfig },
  { id: 'ocean', theme: oceanTheme as ThemeConfig },
  { id: 'forest', theme: forestTheme as ThemeConfig },
  { id: 'minimal-light', theme: minimalLightTheme as ThemeConfig },
];

export function getPresetById(id: string): ThemeConfig | null {
  return THEME_PRESETS.find(p => p.id === id)?.theme ?? null;
}

// ===== CSS VARIABLE MAPPING =====

/**
 * Maps theme JSON color key to --sf-* and --color-sf-* CSS variable pairs.
 * The --sf-* variable is used by direct var() references in CSS.
 * The --color-sf-* variable is used by Tailwind v4 utility classes (bg-sf-*, text-sf-*, etc.).
 * Both must be set as inline styles to override :root and :root:not(.dark) declarations.
 */
const COLOR_MAP: Record<string, { sf: string; color?: string; alsoSet?: { sf: string; color?: string }[] }> = {
  accent:          { sf: '--sf-accent',        color: '--color-sf-accent',        alsoSet: [{ sf: '--sf-accent-bg', color: '--color-sf-accent-bg' }] },
  'accent-hover':  { sf: '--sf-accent-hover',  color: '--color-sf-accent-hover'  },
  'accent-soft':   { sf: '--sf-accent-soft',   color: '--color-sf-accent-soft'   },
  'accent-med':    { sf: '--sf-accent-med',    color: '--color-sf-accent-med'    },
  'accent-glow':   { sf: '--sf-accent-glow',   color: '--color-sf-accent-glow'   },
  'bg-deep':       { sf: '--sf-bg-deep',       color: '--color-sf-deep'          },
  'bg-base':       { sf: '--sf-bg-base',       color: '--color-sf-base'          },
  'bg-raised':     { sf: '--sf-bg-raised',     color: '--color-sf-raised'        },
  'bg-float':      { sf: '--sf-bg-float',      color: '--color-sf-float'         },
  'text-heading':  { sf: '--sf-text-heading',  color: '--color-sf-heading'       },
  'text-body':     { sf: '--sf-text-body',     color: '--color-sf-body'          },
  'text-muted':    { sf: '--sf-text-muted',    color: '--color-sf-muted'         },
  border:          { sf: '--sf-border',         color: '--color-sf-border'        },
  'border-accent': { sf: '--sf-border-accent', color: '--color-sf-border-accent' },
  success:         { sf: '--sf-success',        color: '--color-sf-success'       },
  warning:         { sf: '--sf-warning',        color: '--color-sf-warning'       },
  danger:          { sf: '--sf-danger',         color: '--color-sf-danger',       alsoSet: [{ sf: '--sf-danger-bg', color: '--color-sf-danger-bg' }] },
};

/** Maps theme JSON keys to --sf-* CSS custom properties (+ --color-sf-* for Tailwind v4) */
export function themeToCSS(theme: ThemeConfig, isDark: boolean): Record<string, string> {
  const vars: Record<string, string> = {};

  const colors = isDark ? theme.colors : { ...theme.colors, ...theme['colors-light'] };

  for (const [key, value] of Object.entries(colors)) {
    if (!value) continue;
    const mapping = COLOR_MAP[key];
    if (!mapping) continue;

    vars[mapping.sf] = value;
    if (mapping.color) vars[mapping.color] = value;
    if (mapping.alsoSet) {
      for (const alias of mapping.alsoSet) {
        vars[alias.sf] = value;
        if (alias.color) vars[alias.color] = value;
      }
    }
  }

  if (theme.typography) {
    const t = theme.typography;
    if (t['font-family']) vars['--sf-font-family'] = t['font-family'];
    if (t['font-heading-weight']) vars['--sf-font-heading-weight'] = t['font-heading-weight'];
    if (t['font-body-weight']) vars['--sf-font-body-weight'] = t['font-body-weight'];
    if (t['font-size-base']) vars['--sf-font-size-base'] = t['font-size-base'];
    if (t['letter-spacing-heading']) vars['--sf-letter-spacing-heading'] = t['letter-spacing-heading'];
  }

  if (theme.shapes) {
    const s = theme.shapes;
    if (s['radius-sm']) vars['--sf-radius-sm'] = s['radius-sm'];
    if (s['radius-md']) vars['--sf-radius-md'] = s['radius-md'];
    if (s['radius-lg']) vars['--sf-radius-lg'] = s['radius-lg'];
    if (s['radius-full']) vars['--sf-radius-full'] = s['radius-full'];
    if (s.shadow) vars['--sf-shadow'] = s.shadow;
    if (s['shadow-accent']) vars['--sf-shadow-accent'] = s['shadow-accent'];
  }

  return vars;
}
