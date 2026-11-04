/**
 * Buyer-side attribution collector.
 *
 * Two modes (owner decision 2026-11-03):
 * - no cookie consent: only the URL that opened the checkout (UTM, external referrer host,
 *   landing path) is sent; nothing is stored in the browser;
 * - analytics consent: first and last touch plus a session counter live in localStorage
 *   of the page's own domain; an ad click id is kept only with marketing consent.
 *
 * The functions are deliberately self-contained (no outer references) so the same code
 * runs in React checkout pages and is serialized into the embed / gate loaders
 * (`Function.prototype.toString`). Do not reference module-level helpers inside them.
 *
 * @see src/lib/attribution/normalize.ts — server validation of what this produces
 * @see src/lib/attribution/browser-script.ts — serialization into loaders
 */

export const ATTRIBUTION_HANDOFF_PARAM = 'sf_a';
export const ATTRIBUTION_STORAGE_KEY = 'sf_attr_v1';

export type AttributionConsent = 'none' | 'analytics' | 'marketing';

export interface AttributionTouch {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  id: string | null;
  referrer_host: string | null;
  landing_path: string | null;
  at: string | null;
}

export interface AttributionClick {
  type: string;
  value: string;
}

export interface AttributionPayload {
  v: 1;
  consent: AttributionConsent;
  mode: 'url' | 'stored';
  first: AttributionTouch | null;
  last: AttributionTouch | null;
  sessions_count: number | null;
  first_seen_at: string | null;
  click: AttributionClick | null;
}

export interface CollectInput {
  href: string;
  referrer: string;
  now: number;
  consent: AttributionConsent;
  stored: string | null;
}

export interface CollectResult {
  payload: AttributionPayload;
  /** New localStorage value; null means "remove the key". */
  store: string | null;
}

export function collectAttribution(input: CollectInput): CollectResult {
  const SESSION_GAP_MS = 30 * 60 * 1000;
  const CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'twclid', 'li_fat_id'];
  const clip = (value: string | null | undefined, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  const hostOf = (raw: string): string | null => {
    try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  };
  let url: URL;
  try { url = new URL(input.href); } catch { url = new URL('https://invalid.local/'); }
  const params = url.searchParams;
  const at = new Date(input.now).toISOString();
  const lower = (v: string | null) => (v ? v.toLowerCase() : v);
  const pageHost = url.hostname.toLowerCase().replace(/^www\./, '');
  const refHost = input.referrer ? hostOf(input.referrer) : null;
  const current: AttributionTouch = {
    source: lower(clip(params.get('utm_source'), 200)),
    medium: lower(clip(params.get('utm_medium'), 200)),
    campaign: clip(params.get('utm_campaign'), 200),
    content: clip(params.get('utm_content'), 200),
    term: clip(params.get('utm_term'), 200),
    id: clip(params.get('utm_id'), 200),
    referrer_host: refHost && refHost !== pageHost ? refHost : null,
    landing_path: clip(url.pathname, 300),
    at,
  };
  let click: AttributionClick | null = null;
  for (const name of CLICK_PARAMS) {
    const value = clip(params.get(name), 255);
    if (value) { click = { type: name, value }; break; }
  }
  const isCampaign = (t: AttributionTouch | null) => !!t && !!(t.source || t.medium || t.campaign || t.referrer_host);

  type Stored = { first?: AttributionTouch | null; last?: AttributionTouch | null; sessions?: number;
    first_seen?: string | null; seen_at?: number; click?: AttributionClick | null };
  const parse = (raw: string | null): Stored | null => {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Stored : null;
    } catch { return null; }
  };
  const decodeHandoff = (raw: string | null): { consent: AttributionConsent; state: Stored } | null => {
    if (!raw || raw.length > 4000) return null;
    try {
      const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(escape(atob(b64)));
      const p = JSON.parse(json);
      if (!p || p.v !== 1) return null;
      const consent: AttributionConsent = p.consent === 'marketing' || p.consent === 'analytics' ? p.consent : 'none';
      return { consent, state: { first: p.first ?? null, last: p.last ?? null,
        sessions: typeof p.sessions_count === 'number' ? p.sessions_count : 0,
        first_seen: p.first_seen_at ?? null, seen_at: input.now, click: p.click ?? null } };
    } catch { return null; }
  };
  const rank = { none: 0, analytics: 1, marketing: 2 } as const;

  // Cross-domain handoff from the seller's page: the visitor's consent and history travel
  // with the link, so the checkout domain does not need its own cookie banner decision.
  const handoff = decodeHandoff(params.get('sf_a'));
  const consent: AttributionConsent = handoff && rank[handoff.consent] > rank[input.consent] ? handoff.consent : input.consent;
  if (handoff && handoff.state.last) current.referrer_host = null;
  const currentIsCampaign = isCampaign(current) || !!click;

  if (consent === 'none') {
    return {
      payload: { v: 1, consent: 'none', mode: 'url', first: null, last: handoff?.state.last || current,
        sessions_count: null, first_seen_at: null, click: null },
      store: null,
    };
  }

  const stored = parse(input.stored);
  let base: Stored = stored || {};
  let newSession = !base.seen_at || input.now - base.seen_at > SESSION_GAP_MS || base.seen_at > input.now;
  if (handoff) {
    base = { first: stored?.first || handoff.state.first, last: handoff.state.last || stored?.last,
      sessions: Math.max(stored?.sessions || 0, handoff.state.sessions || 0),
      first_seen: stored?.first_seen || handoff.state.first_seen, click: handoff.state.last ? handoff.state.click : stored?.click };
    newSession = !(base.sessions && base.sessions > 0);
  }
  const sessions = Math.min(10000, (base.sessions && base.sessions > 0 ? base.sessions : 0) + (newSession ? 1 : 0));
  const last = currentIsCampaign ? current : (base.last || current);
  const first = base.first || current;
  // The click id belongs to the touch it arrived with; a newer campaign touch without one drops it,
  // so the last-touch channel is never classified from an older ad click (W147-6).
  const nextClick = consent === 'marketing' ? (currentIsCampaign ? click : (base.click || null)) : null;
  const firstSeen = base.first_seen || at;
  const next: Stored = { first, last, sessions, first_seen: firstSeen, seen_at: input.now, click: nextClick };
  return {
    payload: { v: 1, consent, mode: 'stored', first, last, sessions_count: sessions, first_seen_at: firstSeen, click: nextClick },
    store: input.consent === 'none' ? null : JSON.stringify(next),
  };
}

/** Appends the attribution payload to a link leading to the Sellf checkout on another domain. */
export function decorateCheckoutUrl(href: string, payload: AttributionPayload): string {
  try {
    const url = new URL(href);
    const json = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (b64.length > 4000) return href;
    url.searchParams.set('sf_a', b64);
    return url.toString();
  } catch {
    return href;
  }
}
