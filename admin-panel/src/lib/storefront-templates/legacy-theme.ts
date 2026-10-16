/** Explicit conversion of the previous file theme. @see contracts/theme-tokens.md */
import { tokenOverridesSchema } from '@/lib/storefront-templates/schemas';
import type { StorefrontConfig } from '@/lib/storefront-templates/schemas';

const mappings: Record<string, Record<string, string>> = {
  colors: { accent: 'accent', 'bg-deep': 'background', 'text-heading': 'foreground', 'bg-raised': 'muted', 'text-muted': 'mutedForeground', border: 'border' },
  typography: { 'font-family': 'font', 'font-body-weight': 'bodyWeight', 'font-heading-weight': 'headingWeight', 'font-size-base': 'baseSizePx', 'letter-spacing-heading': 'headingLetterSpacingEm' },
  shapes: { 'radius-sm': 'radiusSmPx', 'radius-md': 'radiusMdPx', 'radius-lg': 'radiusLgPx' },
};
export function convertLegacyTheme(input: unknown): { tokens: StorefrontConfig['tokens']; unsupported: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { tokens: null, unsupported: [] };
  const tokens: Record<string, unknown> = { format: 1 }; const unsupported: string[] = [];
  for (const [group, raw] of Object.entries(input)) {
    if (['name', 'version', 'author'].includes(group)) continue;
    const mapping = mappings[group === 'colors-light' ? 'colors' : group];
    if (!mapping || !raw || typeof raw !== 'object' || Array.isArray(raw)) { unsupported.push(group); continue; }
    const target = group === 'colors' ? 'dark' : group === 'colors-light' ? 'light' : group;
    for (const [key, value] of Object.entries(raw)) {
      const leaf = Object.hasOwn(mapping, key) ? mapping[key] : undefined;
      let converted = value;
      const numericPattern = key === 'font-size-base' ? /^\d+px$/ : key === 'letter-spacing-heading' ? /^-?\d+(\.\d+)?em$/ : /^\d+$/;
      if (target === 'typography' && key !== 'font-family' && typeof value === 'string' && numericPattern.test(value)) converted = Number(value.replace(/(px|em)$/, ''));
      if (target === 'shapes' && typeof value === 'string' && /^\d+px$/.test(value)) converted = Number(value.slice(0, -2));
      if (!leaf || !tokenOverridesSchema.safeParse({ format: 1, [target]: { [leaf]: converted } }).success) { unsupported.push(`${group}.${key}`); continue; }
      tokens[target] = { ...(tokens[target] as object ?? {}), [leaf]: converted };
    }
  }
  const parsed = tokenOverridesSchema.safeParse(tokens);
  return { tokens: parsed.success ? parsed.data : null, unsupported: unsupported.sort() };
}
