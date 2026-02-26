import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limiting';
import {
  sha256,
  resolveDestinations,
  logTrackingEvent,
  sendToGtmSS,
  sendToFacebookCAPI,
} from '@/lib/tracking';
import type { ServerEventPayload, DestinationResult } from '@/lib/tracking';

/**
 * Events that can be sent without explicit cookie consent
 * Based on legitimate interest legal basis (GDPR Art. 6(1)(f))
 */
const CONSENT_EXEMPT_EVENTS = ['Purchase', 'Lead'];

/** Max length for free-form string fields to prevent storage exhaustion */
const MAX_STRING_LEN = 500;
const MAX_URL_LEN = 2000;

function canSendWithoutConsent(
  eventName: string,
  hasConsent: boolean,
  sendConversionsWithoutConsent: boolean
): boolean {
  if (hasConsent) return true;
  if (!sendConversionsWithoutConsent) return false;
  return CONSENT_EXEMPT_EVENTS.includes(eventName);
}

/** Sanitize a string field: enforce type, trim, and limit length */
function sanitizeString(val: unknown, maxLen = MAX_STRING_LEN): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed ? trimmed.slice(0, maxLen) : undefined;
}

/** Validate URL: only allow http(s) schemes to prevent javascript:/data: injection */
function sanitizeUrl(val: unknown): string {
  const str = sanitizeString(val, MAX_URL_LEN);
  if (!str) return '';
  return /^https?:\/\//i.test(str) ? str : '';
}

/** Validate a numeric value: must be finite and non-negative */
function sanitizeValue(val: unknown): number | undefined {
  if (typeof val !== 'number' || !isFinite(val) || val < 0) return undefined;
  return val;
}

/**
 * Server-side tracking proxy endpoint
 *
 * Receives events from the frontend and forwards them to configured destinations:
 * 1. GTM Server-Side container (primary)
 * 2. Facebook CAPI via Graph API (fallback)
 *
 * Supports two modes:
 * - With consent: Full tracking with cookies (_fbc, _fbp)
 * - Without consent: Only conversion events (Purchase, Lead) with hashed data
 *
 * @see https://developers.facebook.com/docs/marketing-api/conversions-api
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 30 requests per minute per IP
    const rateLimitOk = await checkRateLimit('fb_capi', 30, 1);
    if (!rateLimitOk) {
      logTrackingEvent({
        eventName: 'unknown',
        eventId: 'rate_limited',
        source: 'client_proxy',
        status: 'failed',
        errorMessage: 'Rate limited',
      }).catch(() => {});

      return NextResponse.json(
        { error: 'Too many tracking requests. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();

    // Sanitize all client-provided fields (type checking + length limits)
    const eventName = sanitizeString(body.event_name, 100);
    const eventId = sanitizeString(body.event_id, 200);

    if (!eventName || !eventId) {
      logTrackingEvent({
        eventName: eventName || 'unknown',
        eventId: eventId || 'missing',
        source: 'client_proxy',
        status: 'failed',
        errorMessage: 'Missing required fields: event_name, event_id',
      }).catch(() => {});

      return NextResponse.json(
        { error: 'Missing required fields: event_name, event_id' },
        { status: 400 }
      );
    }

    const value = sanitizeValue(body.value);
    const currency = sanitizeString(body.currency, 10);
    const orderId = sanitizeString(body.order_id, 200);
    const userEmail = sanitizeString(body.user_email, 320);
    const contentName = sanitizeString(body.content_name, 200);
    const eventSourceUrl = sanitizeUrl(body.event_source_url);
    const hasConsent = typeof body.has_consent === 'boolean' ? body.has_consent : true;
    const contentIds = Array.isArray(body.content_ids)
      ? body.content_ids
          .filter((id: unknown): id is string => typeof id === 'string')
          .slice(0, 50)
          .map((id: string) => id.slice(0, 200))
      : [];

    // Get config from database
    const supabase = await createClient();
    const { data: config, error: configError } = await supabase
      .from('integrations_config')
      .select(
        'facebook_pixel_id, facebook_capi_token, facebook_test_event_code, fb_capi_enabled, send_conversions_without_consent, gtm_ss_enabled, gtm_server_container_url'
      )
      .single();

    if (configError) {
      console.error('[Tracking Proxy] Config fetch error:', configError);
      logTrackingEvent({
        eventName,
        eventId,
        source: 'client_proxy',
        status: 'failed',
        errorMessage: `Config fetch: ${configError.message}`,
        orderId,
        customerEmail: userEmail,
        value,
        currency,
      }).catch(() => {});

      return NextResponse.json(
        { error: 'Failed to fetch configuration' },
        { status: 500 }
      );
    }

    // Determine which destinations are configured
    const destinations = resolveDestinations(config);

    if (!destinations.fbCAPI && !destinations.gtmSS) {
      logTrackingEvent({
        eventName,
        eventId,
        source: 'client_proxy',
        status: 'skipped',
        skipReason: 'no_destination_configured',
        orderId,
        customerEmail: userEmail,
        value,
        currency,
      }).catch(() => {});

      return NextResponse.json(
        { error: 'No tracking destination configured' },
        { status: 400 }
      );
    }

    // Check consent
    const sendConversionsWithoutConsent = config.send_conversions_without_consent ?? false;

    if (!canSendWithoutConsent(eventName, hasConsent, sendConversionsWithoutConsent)) {
      logTrackingEvent({
        eventName,
        eventId,
        source: 'client_proxy',
        status: 'skipped',
        skipReason: 'no_consent',
        orderId,
        customerEmail: userEmail,
        value,
        currency,
      }).catch(() => {});

      return NextResponse.json({
        success: false,
        skipped: true,
        reason: 'no_consent',
        message: 'Event skipped: user has not given consent and event type requires consent',
      });
    }

    // Extract client info from headers
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '';
    const userAgent = request.headers.get('user-agent') || '';

    // Build user_data with hashing
    const userData: Record<string, unknown> = {
      client_ip_address: clientIp,
      client_user_agent: userAgent,
    };

    if (userEmail) {
      userData.em = [sha256(userEmail)];
    }

    // Add Facebook cookies only with consent (legitimate interest doesn't allow cookie data)
    if (hasConsent) {
      const fbc = request.cookies.get('_fbc')?.value;
      const fbp = request.cookies.get('_fbp')?.value;
      if (fbc) userData.fbc = fbc;
      if (fbp) userData.fbp = fbp;
    }

    // Build shared event payload
    const eventPayload: ServerEventPayload = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      event_source_url: eventSourceUrl,
      action_source: 'website',
      user_data: userData,
      custom_data: {
        currency,
        value,
        content_ids: contentIds,
        content_name: contentName,
        content_type: 'product',
        ...(orderId && { order_id: orderId }),
      },
    };

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
        eventName,
        eventId,
        source: 'client_proxy',
        status: result.success ? 'success' : 'failed',
        destination: result.destination,
        httpStatus: result.httpStatus,
        eventsReceived: result.eventsReceived,
        errorMessage: result.error,
        durationMs,
        orderId,
        customerEmail: userEmail,
        value,
        currency,
        eventSourceUrl,
      }).catch(() => {});

      if (!result.success) {
        console.error(`[Tracking Proxy] ${result.destination} error:`, result.error);
      }
    }

    // At least one destination succeeded → success
    const anySuccess = results.some((r) => r.success);
    const fbResult = results.find((r) => r.destination === 'fb_capi');

    if (anySuccess) {
      return NextResponse.json({
        success: true,
        events_received: fbResult?.eventsReceived,
      });
    }

    // All destinations failed
    console.error('[Tracking Proxy] All destinations failed:', results);
    return NextResponse.json(
      {
        error: 'All tracking destinations failed',
        details: 'Request to external API(s) failed',
      },
      { status: 500 }
    );
  } catch (error) {
    console.error('[Tracking Proxy] Unexpected error:', error);
    logTrackingEvent({
      eventName: 'unknown',
      eventId: 'error',
      source: 'client_proxy',
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    }).catch(() => {});

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
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
