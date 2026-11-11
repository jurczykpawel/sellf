/**
 * Server-side validation of the attribution payload sent by the checkout collector.
 *
 * The payload is untrusted marketing labels (anyone can type a UTM), so it never fails a
 * checkout: every field is validated on its own and dropped when invalid. A click id is kept
 * only with marketing consent. Device class and country are derived on the server
 * (User-Agent, CDN country header) — never from the client.
 *
 * @see src/lib/attribution/collect.ts
 * @see supabase/migrations/20261110235906_release_2026_11_0_fulfillment_orders.sql
 */

import { z } from 'zod';
import type { AttributionClick, AttributionConsent, AttributionTouch } from '@/lib/attribution/collect';

export type DeviceClass = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';

export interface NormalizedAttribution {
  v: 1;
  consent: AttributionConsent;
  mode: 'url' | 'stored' | 'none';
  first: AttributionTouch | null;
  last: AttributionTouch | null;
  sessions_count: number | null;
  first_seen_at: string | null;
  click: AttributionClick | null;
  device_class: DeviceClass;
  country: string | null;
}

export interface AttributionRequestContext {
  userAgent: string | null;
  country: string | null;
}

export const CLICK_ID_TYPES = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid', 'twclid', 'li_fat_id'] as const;
const MAX_AGE_MS = 400 * 24 * 3600 * 1000;

/** Request body field accepted by checkout endpoints. Kept permissive; normalizeAttribution does the real work. */
export const attributionInputSchema = z.unknown().optional();

function text(value: unknown, max: number, lowercase = false): string | null {
  if (typeof value !== 'string') return null;
  // Strip control characters (log/CSV injection) and collapse whitespace.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  if (!cleaned) return null;
  return lowercase ? cleaned.toLowerCase() : cleaned;
}

function host(value: unknown): string | null {
  const v = text(value, 253, true);
  return v && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v) ? v : null;
}

function path(value: unknown): string | null {
  const v = text(value, 300);
  return v && v.startsWith('/') && !v.startsWith('//') && !/[?#\s]/.test(v) ? v : null;
}

function timestamp(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t) || t > now + 24 * 3600 * 1000 || t < now - MAX_AGE_MS) return null;
  return new Date(t).toISOString();
}

function touch(value: unknown, now: number): AttributionTouch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const t = value as Record<string, unknown>;
  const out: AttributionTouch = {
    source: text(t.source, 200, true),
    medium: text(t.medium, 200, true),
    campaign: text(t.campaign, 200),
    content: text(t.content, 200),
    term: text(t.term, 200),
    id: text(t.id, 200),
    referrer_host: host(t.referrer_host),
    landing_path: path(t.landing_path),
    at: timestamp(t.at, now),
  };
  return Object.values(out).some(v => v !== null) ? out : null;
}

export function deviceClassFromUserAgent(ua: string | null): DeviceClass {
  if (!ua) return 'unknown';
  if (/bot|crawl|spider|slurp|headless|facebookexternalhit|preview/i.test(ua)) return 'bot';
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (/mobi|iphone|ipod|android|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function countryFromHeader(value: string | null): string | null {
  const v = value?.trim().toUpperCase();
  // Cloudflare uses XX (unknown) and T1 (Tor) — neither is a country.
  return v && /^[A-Z]{2}$/.test(v) && v !== 'XX' ? v : null;
}

export function normalizeAttribution(raw: unknown, ctx: AttributionRequestContext, now = Date.now()): NormalizedAttribution {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const consent: AttributionConsent = p.consent === 'analytics' || p.consent === 'marketing' ? p.consent : 'none';
  const last = touch(p.last, now);
  const stored = consent !== 'none' && p.mode === 'stored';
  const first = stored ? touch(p.first, now) : null;
  const sessions = stored && typeof p.sessions_count === 'number' && Number.isInteger(p.sessions_count)
    && p.sessions_count >= 1 && p.sessions_count <= 10000 ? p.sessions_count : null;
  const c = p.click && typeof p.click === 'object' && !Array.isArray(p.click) ? p.click as Record<string, unknown> : null;
  const clickType = c && typeof c.type === 'string' && (CLICK_ID_TYPES as readonly string[]).includes(c.type) ? c.type : null;
  const clickValue = c ? text(c.value, 255) : null;
  return {
    v: 1,
    consent,
    mode: last || first ? (stored ? 'stored' : 'url') : 'none',
    first,
    last,
    sessions_count: sessions,
    first_seen_at: stored ? timestamp(p.first_seen_at, now) : null,
    click: consent === 'marketing' && clickType && clickValue ? { type: clickType, value: clickValue } : null,
    device_class: deviceClassFromUserAgent(ctx.userAgent),
    country: countryFromHeader(ctx.country),
  };
}
