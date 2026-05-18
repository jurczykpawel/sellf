import { getBadgePreset, type BadgePreset } from './badge-presets';

export interface BadgeUtm {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export interface GenerateBadgeHtmlInput {
  presetSlug: BadgePreset['slug'];
  siteUrl: string;
  productSlug: string;
  productName: string;
  productIcon?: string | null;
  utm?: BadgeUtm;
  accentColor?: string | null;
}

// Defense-in-depth: escape user-controlled bits even though admin is the
// author. Avoids accidental "><script>... inside product name from leaking
// into HTML context.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHref(input: GenerateBadgeHtmlInput): string {
  const base = input.siteUrl.replace(/\/$/, '');
  const url = new URL(`${base}/p/${input.productSlug}`);
  const u = input.utm ?? {};
  if (u.source) url.searchParams.set('utm_source', u.source);
  if (u.medium) url.searchParams.set('utm_medium', u.medium);
  if (u.campaign) url.searchParams.set('utm_campaign', u.campaign);
  if (u.content) url.searchParams.set('utm_content', u.content);
  return url.toString();
}

// Pure HTML output: <a> + optional <span> for icon. No <script>, <style>,
// inline event handlers, javascript: / data: hrefs — verified by unit test.
export function generateBadgeHtml(input: GenerateBadgeHtmlInput): string {
  if (!/^https?:\/\//i.test(input.siteUrl)) {
    throw new Error('generateBadgeHtml: siteUrl must be http(s)://');
  }
  const preset = getBadgePreset(input.presetSlug);
  const style = preset.getStyle({ accentColor: input.accentColor ?? null });
  const href = escapeHtml(buildHref(input));
  const name = escapeHtml(input.productName);
  const icon = input.productIcon ? escapeHtml(input.productIcon) : '';

  const iconHtml = icon ? `<span aria-hidden="true">${icon}</span>` : '';
  return `<a href="${href}" target="_blank" rel="noopener" style="${style}">${iconHtml}${name}</a>`;
}
