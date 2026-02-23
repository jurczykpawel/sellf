/**
 * Theme system — type definitions, Zod schema, and preset loader.
 * Themes are JSON configs that map to CSS custom properties (--wl-*).
 * @see globals.css for the --wl-* variable definitions
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

/** Maps theme JSON keys to CSS custom property names */
export function themeToCSS(theme: ThemeConfig, isDark: boolean): Record<string, string> {
  const vars: Record<string, string> = {};

  const colors = isDark ? theme.colors : { ...theme.colors, ...theme['colors-light'] };

  for (const [key, value] of Object.entries(colors)) {
    if (value) vars[`--wl-${key.startsWith('bg-') || key.startsWith('text-') ? key : key}`] = value;
  }

  // Map color keys to proper CSS variable names
  if (colors.accent) vars['--wl-accent'] = colors.accent;
  if (colors['accent-hover']) vars['--wl-accent-hover'] = colors['accent-hover'];
  if (colors['accent-soft']) vars['--wl-accent-soft'] = colors['accent-soft'];
  if (colors['accent-med']) vars['--wl-accent-med'] = colors['accent-med'];
  if (colors['accent-glow']) vars['--wl-accent-glow'] = colors['accent-glow'];
  if (colors['bg-deep']) vars['--wl-bg-deep'] = colors['bg-deep'];
  if (colors['bg-base']) vars['--wl-bg-base'] = colors['bg-base'];
  if (colors['bg-raised']) vars['--wl-bg-raised'] = colors['bg-raised'];
  if (colors['bg-float']) vars['--wl-bg-float'] = colors['bg-float'];
  if (colors['text-heading']) vars['--wl-text-heading'] = colors['text-heading'];
  if (colors['text-body']) vars['--wl-text-body'] = colors['text-body'];
  if (colors['text-muted']) vars['--wl-text-muted'] = colors['text-muted'];
  if (colors.border) vars['--wl-border'] = colors.border;
  if (colors['border-accent']) vars['--wl-border-accent'] = colors['border-accent'];
  if (colors.success) vars['--wl-success'] = colors.success;
  if (colors.warning) vars['--wl-warning'] = colors.warning;
  if (colors.danger) vars['--wl-danger'] = colors.danger;

  if (theme.typography) {
    const t = theme.typography;
    if (t['font-family']) vars['--wl-font-family'] = t['font-family'];
    if (t['font-heading-weight']) vars['--wl-font-heading-weight'] = t['font-heading-weight'];
    if (t['font-body-weight']) vars['--wl-font-body-weight'] = t['font-body-weight'];
    if (t['font-size-base']) vars['--wl-font-size-base'] = t['font-size-base'];
    if (t['letter-spacing-heading']) vars['--wl-letter-spacing-heading'] = t['letter-spacing-heading'];
  }

  if (theme.shapes) {
    const s = theme.shapes;
    if (s['radius-sm']) vars['--wl-radius-sm'] = s['radius-sm'];
    if (s['radius-md']) vars['--wl-radius-md'] = s['radius-md'];
    if (s['radius-lg']) vars['--wl-radius-lg'] = s['radius-lg'];
    if (s['radius-full']) vars['--wl-radius-full'] = s['radius-full'];
    if (s.shadow) vars['--wl-shadow'] = s.shadow;
    if (s['shadow-accent']) vars['--wl-shadow-accent'] = s['shadow-accent'];
  }

  return vars;
}
