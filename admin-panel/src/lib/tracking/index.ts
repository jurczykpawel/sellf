/**
 * Tracking Module
 *
 * Provides unified tracking for GTM, Facebook Pixel, and server-side destinations
 * (GTM SS + Facebook CAPI) with automatic deduplication via shared event IDs.
 *
 * Client-side: Use trackEvent() for browser tracking (respects Klaro consent)
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
  buildServerEventPayload,
  sendToGtmSS,
  sendToFacebookCAPI,
} from './server';

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
