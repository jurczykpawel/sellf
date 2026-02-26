/**
 * Server-side tracking utilities
 *
 * Supports two destinations (both can be active simultaneously):
 * 1. GTM Server-Side container (primary) — forwards to FB, TikTok, etc. via GTM tags
 * 2. Facebook CAPI (fallback) — direct Graph API integration
 *
 * Only conversion events (Purchase, Lead) are sent without client-side consent
 * under legitimate interest legal basis (GDPR Art. 6(1)(f)).
 *
 * @see tracking_logs table for persistent event logging
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { FB_GRAPH_API_VERSION } from './types';
import type { FBEventName, EcommerceItem } from './types';

// ===== SHARED HELPERS =====

/**
 * SHA256 hash for user data matching (Facebook, GTM SS)
 */
export function sha256(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value.toLowerCase().trim())
    .digest('hex');
}

const SERVER_SIDE_ALLOWED_EVENTS: FBEventName[] = ['Purchase', 'Lead'];

/**
 * Determine which server-side destinations are configured and ready to receive events.
 */
export function resolveDestinations(config: {
  fb_capi_enabled?: boolean | null;
  facebook_pixel_id?: string | null;
  facebook_capi_token?: string | null;
  gtm_ss_enabled?: boolean | null;
  gtm_server_container_url?: string | null;
} | null): { fbCAPI: boolean; gtmSS: boolean } {
  return {
    fbCAPI: !!(config?.fb_capi_enabled && config?.facebook_pixel_id && config?.facebook_capi_token),
    gtmSS: !!(config?.gtm_ss_enabled && config?.gtm_server_container_url),
  };
}

// ===== TYPES =====

export interface ServerTrackingData {
  eventName: FBEventName;
  eventId?: string;
  eventSourceUrl: string;
  value: number;
  currency: string;
  items: EcommerceItem[];
  orderId?: string;
  userEmail?: string;
  clientIp?: string;
  userAgent?: string;
}

interface TrackingResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  eventsReceived?: number;
  error?: string;
}

export interface DestinationResult {
  destination: 'gtm_ss' | 'fb_capi';
  success: boolean;
  httpStatus?: number;
  eventsReceived?: number;
  error?: string;
}

export interface ServerEventPayload {
  event_name: string;
  event_time: number;
  event_id: string;
  event_source_url: string;
  action_source: 'website';
  user_data: Record<string, unknown>;
  custom_data: Record<string, unknown>;
}

export function generateServerEventId(): string {
  return crypto.randomUUID();
}

// ===== TRACKING LOG =====

interface TrackingLogData {
  eventName: string;
  eventId: string;
  source: 'server' | 'client_proxy';
  status: 'success' | 'failed' | 'skipped';
  destination?: string;
  orderId?: string;
  productId?: string;
  customerEmail?: string;
  value?: number;
  currency?: string;
  eventSourceUrl?: string;
  httpStatus?: number;
  eventsReceived?: number;
  errorMessage?: string;
  skipReason?: string;
  durationMs?: number;
}

/**
 * Persist a tracking event to the tracking_logs table.
 * Creates its own service client if none provided.
 * Fire-and-forget — never throws.
 */
export async function logTrackingEvent(
  log: TrackingLogData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: { from: (table: string) => any }
): Promise<void> {
  try {
    const supabase = supabaseClient || createServiceClient();
    if (!supabase) return;

    await supabase.from('tracking_logs').insert({
      event_name: log.eventName,
      event_id: log.eventId,
      source: log.source,
      status: log.status,
      destination: log.destination || null,
      order_id: log.orderId || null,
      product_id: log.productId || null,
      customer_email: log.customerEmail || null,
      value: log.value ?? null,
      currency: log.currency || null,
      event_source_url: log.eventSourceUrl || null,
      http_status: log.httpStatus ?? null,
      events_received: log.eventsReceived ?? null,
      error_message: log.errorMessage || null,
      skip_reason: log.skipReason || null,
      duration_ms: log.durationMs ?? null,
    });
  } catch {
    // Never fail the main flow because of logging
  }
}

/**
 * Create a service-role Supabase client for server-side operations.
 * Returns null if env vars are missing.
 */
function createServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ===== EVENT PAYLOAD BUILDER =====

/**
 * Build destination-agnostic event payload from tracking data.
 * Shared by both GTM SS and FB CAPI destinations.
 */
export function buildServerEventPayload(
  data: ServerTrackingData,
  eventId: string
): ServerEventPayload {
  const userData: Record<string, unknown> = {};

  if (data.clientIp) {
    userData.client_ip_address = data.clientIp;
  }
  if (data.userAgent) {
    userData.client_user_agent = data.userAgent;
  }
  if (data.userEmail) {
    userData.em = [sha256(data.userEmail)];
  }

  return {
    event_name: data.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    event_source_url: data.eventSourceUrl,
    action_source: 'website',
    user_data: userData,
    custom_data: {
      currency: data.currency,
      value: data.value,
      content_ids: data.items.map((i) => i.item_id),
      content_name: data.items[0]?.item_name,
      content_type: 'product',
      ...(data.orderId && { order_id: data.orderId }),
    },
  };
}

// ===== DESTINATIONS =====

/**
 * Send event to GTM Server-Side container.
 * Posts JSON to {containerUrl}/mp/collect — requires a Custom Client tag in GTM SS.
 */
export async function sendToGtmSS(
  containerUrl: string,
  payload: ServerEventPayload
): Promise<DestinationResult> {
  try {
    const url = `${containerUrl.replace(/\/$/, '')}/mp/collect`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        destination: 'gtm_ss',
        success: false,
        httpStatus: response.status,
        error: text || `GTM SS returned ${response.status}`,
      };
    }

    return {
      destination: 'gtm_ss',
      success: true,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      destination: 'gtm_ss',
      success: false,
      error: error instanceof Error ? error.message : 'GTM SS request failed',
    };
  }
}

/**
 * Send event to Facebook CAPI via Graph API.
 */
export async function sendToFacebookCAPI(
  pixelId: string,
  token: string,
  payload: ServerEventPayload,
  testEventCode?: string | null
): Promise<DestinationResult> {
  try {
    const fbPayload = {
      data: [payload],
      ...(testEventCode && { test_event_code: testEventCode }),
    };

    const response = await fetch(
      `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${pixelId}/events?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fbPayload),
      }
    );

    // Parse response — handle non-JSON responses gracefully
    let result: Record<string, unknown>;
    try {
      result = await response.json();
    } catch {
      return {
        destination: 'fb_capi',
        success: false,
        httpStatus: response.status,
        error: `Facebook API returned non-JSON response (HTTP ${response.status})`,
      };
    }

    if (!response.ok) {
      const fbError = result.error as Record<string, unknown> | undefined;
      return {
        destination: 'fb_capi',
        success: false,
        httpStatus: response.status,
        error: (typeof fbError?.message === 'string' ? fbError.message : null) || 'Facebook API request failed',
      };
    }

    return {
      destination: 'fb_capi',
      success: true,
      httpStatus: 200,
      eventsReceived: typeof result.events_received === 'number' ? result.events_received : undefined,
    };
  } catch (error) {
    return {
      destination: 'fb_capi',
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send event to Facebook',
    };
  }
}

/** Wrap a destination send with timing measurement */
async function timedSend(
  fn: () => Promise<DestinationResult>
): Promise<{ result: DestinationResult; durationMs: number }> {
  const startTime = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - startTime };
}

// ===== MAIN TRACKING FUNCTION =====

/**
 * Send a conversion event to configured server-side destinations.
 *
 * Destinations (both can be active simultaneously):
 * 1. GTM Server-Side container (primary) — forwards to FB, TikTok, etc.
 * 2. Facebook CAPI (fallback) — direct Graph API
 *
 * Features:
 * - Sends to all configured destinations in parallel
 * - Respects send_conversions_without_consent setting from DB
 * - Only allows conversion events (Purchase, Lead) without consent
 * - Hashes user email for matching
 * - Logs every attempt to tracking_logs table
 */
export async function trackServerSideConversion(
  data: ServerTrackingData
): Promise<TrackingResult> {
  const eventId = data.eventId || generateServerEventId();

  // Only allow conversion events from server-side
  if (!SERVER_SIDE_ALLOWED_EVENTS.includes(data.eventName)) {
    logTrackingEvent({
      eventName: data.eventName,
      eventId,
      source: 'server',
      status: 'skipped',
      skipReason: 'event_not_allowed_server_side',
      orderId: data.orderId,
      customerEmail: data.userEmail,
      value: data.value,
      currency: data.currency,
    }).catch(() => {});

    return {
      success: false,
      skipped: true,
      reason: 'event_not_allowed_server_side',
    };
  }

  // Get configuration from database
  const supabase = createServiceClient();

  if (!supabase) {
    console.error('[Tracking Server] Missing Supabase configuration');
    return {
      success: false,
      error: 'Server configuration error',
    };
  }

  const { data: config, error: configError } = await supabase
    .from('integrations_config')
    .select(
      'facebook_pixel_id, facebook_capi_token, facebook_test_event_code, fb_capi_enabled, send_conversions_without_consent, gtm_ss_enabled, gtm_server_container_url'
    )
    .single();

  if (configError) {
    console.error('[Tracking Server] Config fetch error:', configError);
    logTrackingEvent({
      eventName: data.eventName,
      eventId,
      source: 'server',
      status: 'failed',
      errorMessage: configError.message,
      orderId: data.orderId,
      customerEmail: data.userEmail,
      value: data.value,
      currency: data.currency,
    }, supabase).catch(() => {});

    return {
      success: false,
      error: 'Failed to fetch configuration',
    };
  }

  // Determine which destinations are configured
  const destinations = resolveDestinations(config);

  if (!destinations.fbCAPI && !destinations.gtmSS) {
    logTrackingEvent({
      eventName: data.eventName,
      eventId,
      source: 'server',
      status: 'skipped',
      skipReason: 'no_destination_configured',
      orderId: data.orderId,
      customerEmail: data.userEmail,
      value: data.value,
      currency: data.currency,
    }, supabase).catch(() => {});

    return {
      success: false,
      skipped: true,
      reason: 'no_destination_configured',
    };
  }

  // Check if server-side conversions without consent are allowed
  if (!config.send_conversions_without_consent) {
    logTrackingEvent({
      eventName: data.eventName,
      eventId,
      source: 'server',
      status: 'skipped',
      skipReason: 'server_side_conversions_disabled',
      orderId: data.orderId,
      customerEmail: data.userEmail,
      value: data.value,
      currency: data.currency,
    }, supabase).catch(() => {});

    return {
      success: false,
      skipped: true,
      reason: 'server_side_conversions_disabled',
    };
  }

  // Build shared event payload
  const eventPayload = buildServerEventPayload(data, eventId);

  // Send to all configured destinations in parallel
  const sends: Promise<{ result: DestinationResult; durationMs: number }>[] = [];

  if (destinations.gtmSS) {
    sends.push(timedSend(() => sendToGtmSS(config.gtm_server_container_url!, eventPayload)));
  }
  if (destinations.fbCAPI) {
    sends.push(timedSend(() => sendToFacebookCAPI(
      config.facebook_pixel_id!,
      config.facebook_capi_token!,
      eventPayload,
      config.facebook_test_event_code
    )));
  }

  const timedResults = await Promise.all(sends);
  const results: DestinationResult[] = [];

  for (const { result, durationMs } of timedResults) {
    results.push(result);

    logTrackingEvent({
      eventName: data.eventName,
      eventId,
      source: 'server',
      status: result.success ? 'success' : 'failed',
      destination: result.destination,
      httpStatus: result.httpStatus,
      eventsReceived: result.eventsReceived,
      errorMessage: result.error,
      durationMs,
      orderId: data.orderId,
      productId: data.items[0]?.item_id,
      customerEmail: data.userEmail,
      value: data.value,
      currency: data.currency,
      eventSourceUrl: data.eventSourceUrl,
    }, supabase).catch(() => {});

    if (result.success) {
      console.log(`[Tracking Server] ${data.eventName} sent to ${result.destination}:`, {
        eventId,
        value: data.value,
        currency: data.currency,
        ...(result.eventsReceived !== undefined && { eventsReceived: result.eventsReceived }),
      });
    } else {
      console.error(`[Tracking Server] ${result.destination} error:`, result.error);
    }
  }

  // At least one destination succeeded → success
  const anySuccess = results.some((r) => r.success);
  const fbResult = results.find((r) => r.destination === 'fb_capi');

  if (anySuccess) {
    return {
      success: true,
      eventsReceived: fbResult?.eventsReceived,
    };
  }

  // All destinations failed
  return {
    success: false,
    error: results.length === 1
      ? results[0].error
      : results.map((r) => `${r.destination}: ${r.error}`).join('; '),
  };
}
