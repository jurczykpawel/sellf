// Embed badge style presets. Each preset is a function that returns the
// inline-style string used in the generated <a> snippet. Snippets must be
// safe to paste anywhere — no external CSS, no JS, no event handlers.

export interface BadgePresetContext {
  accentColor?: string | null;
}

export interface BadgePreset {
  slug: 'classic-yellow' | 'dark' | 'light' | 'branded';
  label: string;
  getStyle: (ctx?: BadgePresetContext) => string;
}

// Shared formatting helpers — kept ASCII so the output stays clean across
// editors and mail clients.
const BASE = [
  'display:inline-flex',
  'align-items:center',
  'gap:8px',
  'padding:10px 18px',
  'border-radius:9999px',
  'font:600 14px system-ui,Arial,sans-serif',
  'text-decoration:none',
  'transition:transform 120ms',
].join(';');

export const BADGE_PRESETS: BadgePreset[] = [
  {
    slug: 'classic-yellow',
    label: 'Classic yellow',
    getStyle: () =>
      `${BASE};background:#FFDD00;color:#0A0A0A;border:1px solid #0A0A0A`,
  },
  {
    slug: 'dark',
    label: 'Dark',
    getStyle: () =>
      `${BASE};background:#0A0A0A;color:#FFFFFF;border:1px solid #0A0A0A`,
  },
  {
    slug: 'light',
    label: 'Light',
    getStyle: () =>
      `${BASE};background:#FFFFFF;color:#0A0A0A;border:1px solid #0A0A0A`,
  },
  {
    slug: 'branded',
    label: 'Branded',
    getStyle: (ctx) => {
      const accent = ctx?.accentColor || '#5B8DEF';
      return `${BASE};background:${accent};color:#FFFFFF;border:1px solid ${accent}`;
    },
  },
];

export function getBadgePreset(slug: BadgePreset['slug']): BadgePreset {
  return BADGE_PRESETS.find((p) => p.slug === slug) ?? BADGE_PRESETS[0];
}
