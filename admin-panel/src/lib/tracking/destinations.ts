/**
 * Server-side tracking destinations.
 *
 * Each destination owns its own wire format and HTTP transport. The dispatcher
 * (lib/tracking/dispatcher.ts) selects configured destinations, resolves a
 * decision via consent-mode, and asks each one to send the same abstract
 * TrackingEvent — destination decides how the decision shapes its payload.
 *
 * Adding a new destination (TikTok Events API, Pinterest Conversions API,
 * etc.) is one new const in this file plus an entry in ALL_DESTINATIONS.
 *
 * @see lib/tracking/consent-mode.ts — decision policy
 * @see lib/tracking/dispatcher.ts — orchestration + audit
 */

import 'server-only';
import { fetch as undiciFetch } from 'undici';
import { assertSafeOutboundUrl } from '@/lib/security/outbound-url';
import { getSsrfSafeAgent, readBoundedText } from '@/lib/security/safe-fetch';
import type { TrackingDecision } from './consent-mode';
import type { FBEventName, EcommerceItem } from './types';
import { FB_GRAPH_API_VERSION } from './types';

const HTTP_TIMEOUT_MS = 5_000;
const MAX_ERROR_BODY_CHARS = 2_000;

/** Destination-agnostic event shape. Each adapter projects this into its own wire format. */
export interface TrackingEvent {
  eventName: FBEventName;
  eventId: string;
  eventTime: number;
  eventSourceUrl: string;
  value: number;
  currency: string;
  contentIds: string[];
  contentName?: string;
  orderId?: string;
  items?: EcommerceItem[];
  userData: {
    emailHashed?: string;
    clientIp?: string;
    userAgent?: string;
    fbc?: string;
    fbp?: string;
  };
}

/** Subset of integrations_config read by destinations. */
export interface DestinationConfig {
  facebook_pixel_id?: string | null;
  facebook_capi_token?: string | null;
  facebook_test_event_code?: string | null;
  fb_capi_enabled?: boolean | null;
  gtm_server_container_url?: string | null;
  gtm_ss_enabled?: boolean | null;
}

export type DestinationName = 'fb_capi' | 'gtm_ss';

export interface DestinationResult {
  destination: DestinationName;
  success: boolean;
  httpStatus?: number;
  eventsReceived?: number;
  error?: string;
}

export interface TrackingDestination {
  readonly name: DestinationName;
  isConfigured(config: DestinationConfig): boolean;
  send(
    event: TrackingEvent,
    decision: TrackingDecision,
    config: DestinationConfig
  ): Promise<DestinationResult>;
}

// ---- shared helpers -------------------------------------------------------

function omitCookies(userData: TrackingEvent['userData']): TrackingEvent['userData'] {
  // LDU and reject-paths forbid ad-targeting cookies.
  const rest = { ...userData };
  delete rest.fbc;
  delete rest.fbp;
  return rest;
}

function buildCapiUserData(event: TrackingEvent, allowCookies: boolean) {
  const ud = allowCookies ? event.userData : omitCookies(event.userData);
  const out: Record<string, unknown> = {};
  if (ud.clientIp) out.client_ip_address = ud.clientIp;
  if (ud.userAgent) out.client_user_agent = ud.userAgent;
  if (ud.emailHashed) out.em = [ud.emailHashed];
  if (ud.fbc) out.fbc = ud.fbc;
  if (ud.fbp) out.fbp = ud.fbp;
  return out;
}

async function postJson(url: string, body: unknown, headers: HeadersInit = {}) {
  // assertSafeOutboundUrl resolves DNS once as a pre-flight check, but the
  // actual connection below does its own, separate resolution, so the
  // resolved address could differ between the two lookups. Route the
  // request itself through getSsrfSafeAgent() (same one webhook dispatch
  // uses) so the address is re-checked at connect time, not just up front.
  await assertSafeOutboundUrl(url);
  return undiciFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    dispatcher: getSsrfSafeAgent(),
  });
}

// ---- Facebook Conversions API ---------------------------------------------

export const fbCapiDestination: TrackingDestination = {
  name: 'fb_capi',

  isConfigured(config) {
    return !!(config.fb_capi_enabled && config.facebook_pixel_id && config.facebook_capi_token);
  },

  async send(event, decision, config) {
    try {
      const allowCookies = decision.action === 'send_full';
      const eventEnvelope: Record<string, unknown> = {
        event_name: event.eventName,
        event_time: event.eventTime,
        event_id: event.eventId,
        event_source_url: event.eventSourceUrl,
        action_source: 'website',
        user_data: buildCapiUserData(event, allowCookies),
        custom_data: {
          currency: event.currency,
          value: event.value,
          content_ids: event.contentIds,
          content_name: event.contentName,
          content_type: 'product',
          ...(event.orderId && { order_id: event.orderId }),
        },
      };

      if (decision.action === 'send_ldu') {
        eventEnvelope.data_processing_options = ['LDU'];
        eventEnvelope.data_processing_options_country = 0;
        eventEnvelope.data_processing_options_state = 0;
      }

      const payload: Record<string, unknown> = { data: [eventEnvelope] };
      if (config.facebook_test_event_code) {
        payload.test_event_code = config.facebook_test_event_code;
      }

      const url = `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${config.facebook_pixel_id}/events`;
      const response = await postJson(url, payload, {
        Authorization: `Bearer ${config.facebook_capi_token}`,
      });

      let body: Record<string, unknown>;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        return {
          destination: 'fb_capi',
          success: false,
          httpStatus: response.status,
          error: `Facebook API returned non-JSON response (HTTP ${response.status})`,
        };
      }

      if (!response.ok) {
        const fbError = body.error as Record<string, unknown> | undefined;
        const message = typeof fbError?.message === 'string' ? fbError.message : null;
        return {
          destination: 'fb_capi',
          success: false,
          httpStatus: response.status,
          error: message || 'Facebook API request failed',
        };
      }

      return {
        destination: 'fb_capi',
        success: true,
        httpStatus: 200,
        eventsReceived:
          typeof body.events_received === 'number' ? body.events_received : undefined,
      };
    } catch (error) {
      return {
        destination: 'fb_capi',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send event to Facebook',
      };
    }
  },
};

// ---- GTM Server-Side ------------------------------------------------------

function consentStateFor(decision: TrackingDecision) {
  if (decision.action === 'send_full') {
    return {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    };
  }
  // send_ldu: ads off, analytics on (aggregate reporting).
  return {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  };
}

export const gtmSsDestination: TrackingDestination = {
  name: 'gtm_ss',

  isConfigured(config) {
    return !!(config.gtm_ss_enabled && config.gtm_server_container_url);
  },

  async send(event, decision, config) {
    try {
      const allowCookies = decision.action === 'send_full';
      const payload: Record<string, unknown> = {
        event_name: event.eventName,
        event_time: event.eventTime,
        event_id: event.eventId,
        event_source_url: event.eventSourceUrl,
        action_source: 'website',
        user_data: buildCapiUserData(event, allowCookies),
        custom_data: {
          currency: event.currency,
          value: event.value,
          content_ids: event.contentIds,
          content_name: event.contentName,
          content_type: 'product',
          ...(event.orderId && { order_id: event.orderId }),
        },
        consent_state: consentStateFor(decision),
      };

      if (decision.action === 'send_ldu') {
        payload.data_processing_options = ['LDU'];
        payload.data_processing_options_country = 0;
        payload.data_processing_options_state = 0;
      }

      const url = `${config.gtm_server_container_url!.replace(/\/$/, '')}/mp/collect`;
      const response = await postJson(url, payload);

      if (!response.ok) {
        const text = await readBoundedText(response, MAX_ERROR_BODY_CHARS).catch(() => '');
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
  },
};

export const ALL_DESTINATIONS: readonly TrackingDestination[] = [
  gtmSsDestination,
  fbCapiDestination,
];
