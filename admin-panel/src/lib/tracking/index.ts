/**
 * Tracking Module
 *
 * Provides unified tracking for GTM, Facebook Pixel, and server-side destinations
 * (GTM SS + Facebook CAPI) with automatic deduplication via shared event IDs.
 *
 * Client-side: Use trackEvent() for browser tracking (respects cookieconsent)
 * Server-side: Use trackServerSideConversion() for GTM SS + FB CAPI
 */

// Client-side tracking (requires browser context)
export { trackEvent, generateEventId, hasFacebookConsent, hasGTMConsent } from './client';

// Server-side tracking (for API routes, webhooks, etc.)
export {
  sha256,
  resolveDestinations,
  trackServerSideConversion,
  generateServerEventId,
  logTrackingEvent,
} from './server';

export { dispatchTrackingEvent } from './dispatcher';
export type { DispatchContext, DispatchResult } from './dispatcher';

export {
  fbCapiDestination,
  gtmSsDestination,
  ALL_DESTINATIONS,
} from './destinations';
export type {
  TrackingEvent,
  DestinationConfig,
  TrackingDestination,
} from './destinations';

export {
  resolveTrackingDecision,
  CONVERSION_TRACKING_MODES,
  DEFAULT_CONVERSION_TRACKING_MODE,
} from './consent-mode';
export type { ConversionTrackingMode, TrackingDecision } from './consent-mode';

export { generatePurchaseEventId } from './types';

export type {
  GA4EventName,
  FBEventName,
  EcommerceItem,
  TrackingEventData,
  TrackingConfig,
  TrackingConfigFromDB,
  FBCAPIRequestPayload,
} from './types';

export type {
  ServerTrackingData,
  DestinationResult,
  ServerEventPayload,
} from './server';
