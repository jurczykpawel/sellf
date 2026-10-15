/** Typed public appearance and leaf provenance. @see spec/contracts/theme-tokens.md */
import { tokenOverridesSchema, tokensSchema } from '@/lib/storefront-templates/schemas';
import { contrastRatio } from '@/lib/themes/contrast';
import type { PublicThemeTokens } from '@/lib/storefront-templates/schemas';

export const CORE_TOKENS: PublicThemeTokens = {
  format: 1,
  light: { background: '#F0F4F8', foreground: '#0B1120', accent: '#006AAB', accentForeground: '#FFFFFF', muted: '#FFFFFF', mutedForeground: '#5B6578', border: '#767676' },
  dark: { background: '#0B1120', foreground: '#F0F4FA', accent: '#38BDF8', accentForeground: '#0B1120', muted: '#111C30', mutedForeground: '#94A3B8', border: '#7A8DA3' },
  typography: { font: 'geist', bodyWeight: 400, headingWeight: 700, baseSizePx: 16, headingLetterSpacingEm: 0 },
  shapes: { radiusSmPx: 4, radiusMdPx: 12, radiusLgPx: 16 },
};
export const PUBLIC_THEME_ROUTES = { storefront: ['/', '/store'], protected: ['/p/[slug]', '/checkout/[slug]', '/login', '/terms', '/privacy'] } as const;
export type TokenOrigin = 'core' | 'template' | 'seller' | 'protected';
export interface EffectiveToken { path: string; value: string | number; origin: TokenOrigin }
export interface ResolvedPublicTheme {
  tokens: PublicThemeTokens;
  effective: EffectiveToken[];
  diagnostics: ('SCHEMA' | 'CONTRAST' | 'ENTITLEMENT')[];
}
export type PublicThemeSurface = keyof typeof PUBLIC_THEME_ROUTES;
const groups = ['light', 'dark', 'typography', 'shapes'] as const;

/** Validate text, solid action labels, focus and control boundaries on both surfaces. */
export function validateThemeContrast(tokens: PublicThemeTokens): string[] {
  const failures: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const colors = tokens[mode];
    for (const bg of ['background', 'muted'] as const) {
      for (const fg of ['foreground', 'mutedForeground', 'accent', 'border'] as const) {
        if (contrastRatio(colors[fg], colors[bg]) < (fg === 'border' ? 3 : 4.5)) failures.push(`tokens.${mode}.${fg}`);
      }
    }
    if (contrastRatio(colors.accentForeground, colors.accent) < 4.5) failures.push(`tokens.${mode}.accentForeground`);
  }
  return [...new Set(failures)];
}

export function resolvePublicTheme(template: unknown, overrides: unknown, canCustomize: boolean, surface: PublicThemeSurface = 'storefront'): ResolvedPublicTheme {
  const diagnostics: ResolvedPublicTheme['diagnostics'] = [];
  const parsedTemplate = tokensSchema.safeParse(template);
  const validTemplate = parsedTemplate.success && !validateThemeContrast(parsedTemplate.data).length;
  if (template !== null && !validTemplate) diagnostics.push(parsedTemplate.success ? 'CONTRAST' : 'SCHEMA');
  const base = structuredClone(validTemplate ? parsedTemplate.data : CORE_TOKENS);
  const tokens = structuredClone(base);
  const origins = new Map<string, TokenOrigin>();
  const parsed = tokenOverridesSchema.safeParse(overrides);
  if (overrides !== null) {
    if (!parsed.success) diagnostics.push('SCHEMA');
    else if (!canCustomize && groups.some(group => Object.keys(parsed.data[group] ?? {}).length)) diagnostics.push('ENTITLEMENT');
    else if (canCustomize) {
      for (const group of groups) Object.assign(tokens[group], parsed.data[group]);
      if (validateThemeContrast(tokens).length) {
        diagnostics.push('CONTRAST');
        for (const group of groups) Object.assign(tokens[group], base[group]);
      } else for (const group of groups) for (const leaf of Object.keys(parsed.data[group] ?? {})) origins.set(`${group}.${leaf}`, 'seller');
    }
  }
  if (surface === 'protected') {
    for (const group of groups) for (const [leaf, value] of Object.entries(CORE_TOKENS[group])) {
      const allowed = group === 'typography' ? leaf === 'font' : (group === 'light' || group === 'dark') && ['background', 'foreground', 'accent', 'accentForeground'].includes(leaf);
      if (!allowed) {
        Object.assign(tokens[group], { [leaf]: value }); origins.set(`${group}.${leaf}`, 'protected');
      }
    }
    for (const mode of ['light', 'dark'] as const) {
      if (validateThemeContrast(tokens).some(path => path.startsWith(`tokens.${mode}.`))) {
        Object.assign(tokens[mode], CORE_TOKENS[mode]);
        for (const leaf of Object.keys(tokens[mode])) origins.set(`${mode}.${leaf}`, 'protected');
      }
    }
  }
  return { tokens, diagnostics, effective: groups.flatMap(group => Object.entries(tokens[group]).map(([leaf, value]) => ({
    path: `tokens.${group}.${leaf}`, value, origin: origins.get(`${group}.${leaf}`) ?? (validTemplate ? 'template' : 'core'),
  }))) };
}

const colorVars = {
  background: ['bg-deep', 'bg-base', 'bg-float', 'bg-input', 'bg-hover', 'bg-row-alt'],
  foreground: ['text-heading', 'text-body'], accent: ['accent', 'accent-bg', 'accent-hover'],
  accentForeground: ['accent-foreground', 'accent-fg'], muted: ['bg-raised', 'accent-soft', 'accent-med', 'accent-glow'],
  mutedForeground: ['text-muted'], border: ['border', 'border-accent', 'border-subtle', 'border-medium', 'border-strong'],
};
const aliases: Record<string, string> = { 'bg-deep': 'deep', 'bg-base': 'base', 'bg-raised': 'raised', 'bg-float': 'float', 'bg-input': 'input', 'bg-hover': 'hover', 'bg-row-alt': 'row-alt', 'text-heading': 'heading', 'text-body': 'body', 'text-muted': 'muted' };
function declarations(tokens: PublicThemeTokens, mode: 'light' | 'dark'): string {
  const vars: Record<string, string> = {};
  for (const [leaf, names] of Object.entries(colorVars)) for (const name of names) {
    const value = tokens[mode][leaf as keyof PublicThemeTokens['light']];
    vars[`--sf-${name}`] = value; vars[`--color-sf-${aliases[name] ?? name}`] = value;
  }
  const t = tokens.typography;
  Object.assign(vars, {
    '--sf-font-family': t.font === 'geist' ? 'var(--font-geist-sans)' : 'var(--font-dm-sans)',
    '--sf-font-body-weight': String(t.bodyWeight), '--sf-font-heading-weight': String(t.headingWeight),
    '--sf-font-size-base': `${t.baseSizePx}px`, '--sf-letter-spacing-heading': `${t.headingLetterSpacingEm}em`, '--sf-heading-letter-spacing': `${t.headingLetterSpacingEm}em`,
    '--sf-radius-sm': `${tokens.shapes.radiusSmPx}px`, '--sf-radius-md': `${tokens.shapes.radiusMdPx}px`, '--sf-radius-lg': `${tokens.shapes.radiusLgPx}px`,
  });
  return Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';');
}

/** Only validated, enumerated declarations enter the fixed shell selectors. */
export function publicThemeCSS(input: PublicThemeTokens, surface: PublicThemeSurface = 'storefront'): string {
  const tokens = tokensSchema.parse(input);
  const scope = `.sf-public-theme[data-sf-surface="${surface}"]`;
  return `${scope}{${declarations(tokens, 'light')}}${scope}[data-sf-mode="dark"],.dark ${scope}[data-sf-mode="system"]{${declarations(tokens, 'dark')}}@media(prefers-color-scheme:dark){html:not([data-sf-theme-resolved]) ${scope}[data-sf-mode="system"]{${declarations(tokens, 'dark')}}}`;
}
