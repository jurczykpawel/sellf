/**
 * Server-side tracking facade.
 *
 * Thin wrapper around the dispatcher for legacy callers (Stripe webhook).
 * New code should call dispatchTrackingEvent directly.
 *
 * Also owns:
 *   - sha256 hashing for user_data matching
 *   - resolveDestinations (back-compat helper still used by route guards)
 *   - logTrackingEvent — the only writer to the tracking_logs audit table
 *
 * @see lib/tracking/dispatcher.ts — orchestration
 * @see lib/tracking/destinations.ts — adapters
 * @see lib/tracking/consent-mode.ts — decision policy
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import type { FBEventName, EcommerceItem } from './types';
import type { ConversionTrackingMode } from './consent-mode';
import type { DestinationConfig, TrackingEvent } from './destinations';

// ===== SHARED HELPERS =====

export function sha256(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value.toLowerCase().trim())
    .digest('hex');
}

export function resolveDestinations(config: DestinationConfig | null): {
  fbCAPI: boolean;
  gtmSS: boolean;
} {
  return {
    fbCAPI: !!(config?.fb_capi_enabled && config?.facebook_pixel_id && config?.facebook_capi_token),
    gtmSS: !!(config?.gtm_ss_enabled && config?.gtm_server_container_url),
  };
}

// ===== TYPES =====

const SERVER_SIDE_ALLOWED_EVENTS: FBEventName[] = ['Purchase', 'Lead'];

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

export type { DestinationResult } from './destinations';

/** Legacy alias retained so the existing payload-builder shape stays exported. */
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

// ===== AUDIT LOG =====

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
 * Fire-and-forget — never throws.
 */
export async function logTrackingEvent(
  log: TrackingLogData,
  supabaseClient?: {
    from: (table: string) => { insert: (data: Record<string, unknown>) => PromiseLike<unknown> };
  }
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

function createServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ===== LEGACY FACADE =====

interface IntegrationsConfigRow extends DestinationConfig {
  conversion_tracking_mode?: string | null;
  facebook_test_event_code?: string | null;
}

function toTrackingEvent(data: ServerTrackingData, eventId: string): TrackingEvent {
  return {
    eventName: data.eventName,
    eventId,
    eventTime: Math.floor(Date.now() / 1000),
    eventSourceUrl: data.eventSourceUrl,
    value: data.value,
    currency: data.currency,
    contentIds: data.items.map((i) => i.item_id),
    contentName: data.items[0]?.item_name,
    orderId: data.orderId,
    items: data.items,
    userData: {
      emailHashed: data.userEmail ? sha256(data.userEmail) : undefined,
      clientIp: data.clientIp,
      userAgent: data.userAgent,
    },
  };
}

/**
 * Send a conversion event from a context that has no client-side consent
 * signal (e.g. a Stripe webhook). Behaviour is driven entirely by the
 * configured conversion_tracking_mode in the database.
 *
 * For browser-initiated paths use dispatchTrackingEvent directly with the
 * real consent state — the proxy route does so.
 */
export async function trackServerSideConversion(
  data: ServerTrackingData
): Promise<TrackingResult> {
  const { dispatchTrackingEvent } = await import('./dispatcher');
  const eventId = data.eventId || generateServerEventId();

  if (!SERVER_SIDE_ALLOWED_EVENTS.includes(data.eventName)) {
    await logTrackingEvent({
      eventName: data.eventName,
      eventId,
      source: 'server',
      status: 'skipped',
      skipReason: 'event_not_allowed_server_side',
      orderId: data.orderId,
      customerEmail: data.userEmail,
      value: data.value,
      currency: data.currency,
    });
    return { success: false, skipped: true, reason: 'event_not_allowed_server_side' };
  }

  const supabase = createServiceClient();
  if (!supabase) {
    console.error('[Tracking Server] Missing Supabase configuration');
    return { success: false, error: 'Server configuration error' };
  }

  const { data: config, error: configError } = await supabase
    .from('integrations_config')
    .select(
      'facebook_pixel_id, facebook_capi_token, facebook_test_event_code, fb_capi_enabled, conversion_tracking_mode, gtm_ss_enabled, gtm_server_container_url'
    )
    .single<IntegrationsConfigRow>();

  if (configError) {
    console.error('[Tracking Server] Config fetch error:', configError);
    await logTrackingEvent({
      eventName: data.eventName,
      eventId,
      source: 'server',
      status: 'failed',
      errorMessage: configError.message,
      orderId: data.orderId,
      customerEmail: data.userEmail,
      value: data.value,
      currency: data.currency,
    });
    return { success: false, error: 'Failed to fetch configuration' };
  }

  const mode = (config?.conversion_tracking_mode ?? 'strict') as ConversionTrackingMode;
  const event = toTrackingEvent(data, eventId);

  const dispatch = await dispatchTrackingEvent(event, config ?? {}, {
    mode,
    hasConsent: false,
    source: 'server',
    customerEmailForAudit: data.userEmail,
  });

  if (dispatch.skipped) {
    return { success: false, skipped: true, reason: dispatch.skipped.reason };
  }

  const fbResult = dispatch.results.find((r) => r.destination === 'fb_capi');
  if (dispatch.anySuccess) {
    return { success: true, eventsReceived: fbResult?.eventsReceived };
  }

  return {
    success: false,
    error:
      dispatch.results.length === 1
        ? dispatch.results[0].error
        : dispatch.results.map((r) => `${r.destination}: ${r.error}`).join('; '),
  };
}
