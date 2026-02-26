/**
 * Client-side tracking utilities for GTM and Facebook
 */

import type {
  GA4EventName,
  FBEventName,
  TrackingEventData,
  TrackingConfig,
  FBCAPIRequestPayload,
} from './types';

// Event name mapping: GA4 -> Facebook
const GA4_TO_FB: Record<GA4EventName, FBEventName> = {
  view_item: 'ViewContent',
  begin_checkout: 'InitiateCheckout',
  add_payment_info: 'AddPaymentInfo',
  purchase: 'Purchase',
  generate_lead: 'Lead',
};

/**
 * Check if user has given consent for a specific service via Klaro
 *
 * Klaro stores consent in a cookie named 'gateflow_consent' as JSON
 * Format: { "facebook-pixel": true, "google-tag-manager": true, ... }
 */
function getKlaroConsent(serviceName: string): boolean {
  if (typeof document === 'undefined') return false;

  try {
    // Get Klaro consent cookie
    const cookies = document.cookie.split(';');
    const klaroCookie = cookies.find(c => c.trim().startsWith('gateflow_consent='));

    if (!klaroCookie) {
      // No consent cookie = no consent given yet
      return false;
    }

    const cookieValue = klaroCookie.split('=')[1];
    const decoded = decodeURIComponent(cookieValue);
    const consent = JSON.parse(decoded);

    return consent[serviceName] === true;
  } catch {
    // If parsing fails, assume no consent
    return false;
  }
}

/**
 * Check if user has consent for Facebook tracking
 */
export function hasFacebookConsent(): boolean {
  return getKlaroConsent('facebook-pixel');
}

/**
 * Check if user has consent for Google Tag Manager
 */
export function hasGTMConsent(): boolean {
  return getKlaroConsent('google-tag-manager');
}

/**
 * Generate a unique event ID for deduplication between Pixel and CAPI
 */
export function generateEventId(): string {
  // Use crypto.randomUUID() if available (modern browsers + Node 19+)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Push event to GTM dataLayer
 */
function pushToDataLayer(
  eventName: GA4EventName,
  data: TrackingEventData,
  eventId: string
): void {
  if (typeof window === 'undefined' || !window.dataLayer) return;

  // Clear previous ecommerce data to prevent data leakage
  window.dataLayer.push({ ecommerce: null });

  // Push the event
  window.dataLayer.push({
    event: eventName,
    ecommerce: {
      transaction_id: data.transactionId,
      value: data.value,
      currency: data.currency,
      items: data.items,
    },
    event_id: eventId,
  });
}

/**
 * Track Facebook Pixel event (client-side)
 */
function trackFBPixel(
  eventName: FBEventName,
  data: TrackingEventData,
  eventId: string
): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;

  window.fbq(
    'track',
    eventName,
    {
      content_ids: data.items.map((i) => i.item_id),
      content_type: 'product',
      value: data.value,
      currency: data.currency,
    },
    { eventID: eventId }
  );
}

/**
 * Send event to Facebook CAPI (server-side)
 *
 * Always sends the request - the server decides whether to forward to Facebook
 * based on consent status and send_conversions_without_consent setting.
 */
async function sendToCAPI(
  eventName: FBEventName,
  data: TrackingEventData,
  eventId: string,
  hasConsent: boolean
): Promise<void> {
  if (typeof window === 'undefined') return;

  const payload: FBCAPIRequestPayload = {
    event_name: eventName,
    event_id: eventId,
    event_source_url: window.location.href,
    value: data.value,
    currency: data.currency,
    content_ids: data.items.map((i) => i.item_id),
    content_name: data.items[0]?.item_name,
    order_id: data.transactionId,
    user_email: data.userEmail,
    has_consent: hasConsent,
  };

  try {
    await fetch('/api/tracking/fb-capi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // Silently fail - tracking should not break the app
    console.error('[Tracking] FB CAPI error:', error);
  }
}

/**
 * Main tracking function - sends event to all configured destinations
 *
 * Respects user consent for client-side tracking (GTM, Pixel).
 * Server-side CAPI is always called - the server decides whether to forward
 * based on consent and send_conversions_without_consent configuration.
 *
 * @param eventName - GA4 event name (e.g., 'purchase', 'begin_checkout')
 * @param data - Event data (value, currency, items, etc.)
 * @param config - Tracking configuration (which trackers are enabled)
 * @returns Promise that resolves when all tracking calls are complete
 */
export async function trackEvent(
  eventName: GA4EventName,
  data: TrackingEventData,
  config: TrackingConfig,
  eventIdOverride?: string
): Promise<void> {
  // Use provided event ID (for dedup with server-side) or generate a new one
  const eventId = eventIdOverride || generateEventId();

  // Get Facebook event name equivalent
  const fbEventName = GA4_TO_FB[eventName];

  // Check consent status for each service
  const gtmConsent = hasGTMConsent();
  const fbConsent = hasFacebookConsent();

  // 1. Push to GTM dataLayer - only if user consented
  if (config.gtmEnabled && gtmConsent) {
    pushToDataLayer(eventName, data, eventId);
  }

  // 2. Track Facebook Pixel (client-side) - only if user consented
  if (config.fbPixelEnabled && fbConsent) {
    trackFBPixel(fbEventName, data, eventId);
  }

  // 3. Send to Facebook CAPI (server-side)
  // Always send request - server decides based on consent + config
  // This allows server-side conversions without consent when configured
  if (config.fbCAPIEnabled) {
    await sendToCAPI(fbEventName, data, eventId, fbConsent);
  }
}
