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
