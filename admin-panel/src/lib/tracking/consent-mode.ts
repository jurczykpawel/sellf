/**
 * Conversion tracking mode — single source of truth for "should we send this event?"
 *
 * Used by both client-proxy (api/tracking/fb-capi) and Stripe webhook
 * (trackServerSideConversion). Returns a decision; callers translate it
 * into payload flags (LDU for CAPI, consent_state for GTM SS).
 */

import type { FBEventName } from './types';

export type ConversionTrackingMode = 'strict' | 'limited' | 'permissive';

export const CONVERSION_TRACKING_MODES: readonly ConversionTrackingMode[] = [
  'strict',
  'limited',
  'permissive',
] as const;

export const DEFAULT_CONVERSION_TRACKING_MODE: ConversionTrackingMode = 'strict';

/** Events that carry an actual conversion — eligible for legitimate-interest path. */
const CONVERSION_EVENTS: readonly FBEventName[] = ['Purchase', 'Lead'] as const;

function isConversionEvent(eventName: FBEventName): boolean {
  return CONVERSION_EVENTS.includes(eventName);
}

export type TrackingDecision =
  | { action: 'send_full' }
  | { action: 'send_ldu' }
  | { action: 'skip'; reason: 'no_consent_strict_mode' | 'browsing_event_requires_consent' };

export interface ResolveTrackingDecisionInput {
  mode: ConversionTrackingMode;
  hasConsent: boolean;
  eventName: FBEventName;
}

/**
 * Decide what to do with an event given the configured tracking mode and
 * the user's consent state.
 *
 * - Consent granted → always send full payload.
 * - No consent + strict → drop everything.
 * - No consent + limited → conversions go out under Limited Data Use; browsing dropped.
 * - No consent + permissive → conversions go out fully (legitimate-interest claim);
 *   browsing always requires consent.
 *
 * Unknown mode falls through to strict (fail-closed).
 */
export function resolveTrackingDecision(input: ResolveTrackingDecisionInput): TrackingDecision {
  const { mode, hasConsent, eventName } = input;

  if (hasConsent) return { action: 'send_full' };

  if (!isConversionEvent(eventName)) {
    return { action: 'skip', reason: 'browsing_event_requires_consent' };
  }

  switch (mode) {
    case 'limited':
      return { action: 'send_ldu' };
    case 'permissive':
      return { action: 'send_full' };
    case 'strict':
    default:
      return { action: 'skip', reason: 'no_consent_strict_mode' };
  }
}

interface ConsentCookieShape {
  services?: Record<string, string[]>;
}

/**
 * Server-side echo of the cookieconsent v3 marketing decision.
 *
 * Returns:
 *   true  — cookie present, services.marketing contains 'pixel'
 *   false — cookie present but pixel not accepted (explicit reject)
 *   null  — cookie absent or unparseable (caller should fall back to body)
 *
 * Closes the audit gap where a client could send `has_consent: true` while
 * the consent cookie says otherwise: the cookie is the trusted source for
 * same-origin storefront calls, the body is only a fallback for callers
 * that never had a cookie (e.g. SSR pages, tests without a browser).
 */
export function readMarketingConsentFromCookieValue(
  raw: string | undefined
): boolean | null {
  if (!raw) return null;

  // cookieconsent v3 URL-encodes the JSON before storing; Next surfaces the
  // raw cookie value, so we try decoded form first and fall back to raw.
  const candidates = [tryDecode(raw), raw];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = tryParseJson(candidate);
    if (!parsed) continue;
    const services = parsed.services;
    if (!services || typeof services !== 'object') return null;
    const marketing = services.marketing;
    if (!Array.isArray(marketing)) return false;
    return marketing.includes('pixel');
  }

  return null;
}

function tryDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function tryParseJson(value: string): ConsentCookieShape | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as ConsentCookieShape) : null;
  } catch {
    return null;
  }
}
