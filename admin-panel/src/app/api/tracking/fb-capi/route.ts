import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';
import { getClientIp } from '@/lib/security/client-ip';
import {
  sha256,
  logTrackingEvent,
  dispatchTrackingEvent,
  type ConversionTrackingMode,
  type TrackingEvent,
} from '@/lib/tracking';
import { readMarketingConsentFromCookieValue } from '@/lib/tracking/consent-mode';
import { isValidFbEventName } from '@/lib/tracking/types';
import { CONSENT_COOKIE_NAME } from '@/lib/constants';

/** Max length for free-form string fields to prevent storage exhaustion */
const MAX_STRING_LEN = 500;
const MAX_URL_LEN = 2000;

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

interface FbCapiConfigRow {
  facebook_pixel_id: string | null;
  facebook_capi_token: string | null;
  facebook_test_event_code: string | null;
  fb_capi_enabled: boolean | null;
  conversion_tracking_mode: string | null;
  gtm_ss_enabled: boolean | null;
  gtm_server_container_url: string | null;
}

/**
 * Server-side tracking proxy endpoint.
 *
 * Browser callers send an event here with `has_consent` reflecting the
 * cookieconsent state; the dispatcher decides what to do based on the
 * configured conversion_tracking_mode.
 *
 * @see lib/tracking/dispatcher.ts
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
      }).catch((err) => {
        console.warn('[fb-capi] Non-critical error:', err);
      });

      return NextResponse.json(
        { error: 'Too many tracking requests. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();

    const eventName = sanitizeString(body.event_name, 100);
    const eventId = sanitizeString(body.event_id, 200);

    if (!eventName || !eventId) {
      logTrackingEvent({
        eventName: eventName || 'unknown',
        eventId: eventId || 'missing',
        source: 'client_proxy',
        status: 'failed',
        errorMessage: 'Missing required fields: event_name, event_id',
      }).catch((err) => {
        console.warn('[fb-capi] Non-critical error:', err);
      });

      return NextResponse.json(
        { error: 'Missing required fields: event_name, event_id' },
        { status: 400 }
      );
    }

    if (!isValidFbEventName(eventName)) {
      logTrackingEvent({
        eventName,
        eventId,
        source: 'client_proxy',
        status: 'failed',
        errorMessage: 'Unsupported event_name',
      }).catch((err) => {
        console.warn('[fb-capi] Non-critical error:', err);
      });

      return NextResponse.json(
        { error: 'Unsupported event_name' },
        { status: 400 }
      );
    }

    const value = sanitizeValue(body.value);
    const currency = sanitizeString(body.currency, 10);
    const orderId = sanitizeString(body.order_id, 200);
    const bodyEmail = sanitizeString(body.user_email, 320);
    const contentName = sanitizeString(body.content_name, 200);
    const eventSourceUrl = sanitizeUrl(body.event_source_url);
    const bodyConsent = typeof body.has_consent === 'boolean' ? body.has_consent : true;
    // Server-side override: when the visitor has a consent cookie, trust it
    // over whatever the body claims. Body is only the fallback for callers
    // that never had a cookie (legacy tests, SSR pages).
    const cookieConsent = readMarketingConsentFromCookieValue(
      request.cookies.get(CONSENT_COOKIE_NAME)?.value
    );
    const hasConsent = cookieConsent !== null ? cookieConsent : bodyConsent;
    const contentIds = Array.isArray(body.content_ids)
      ? body.content_ids
          .filter((id: unknown): id is string => typeof id === 'string')
          .slice(0, 50)
          .map((id: string) => id.slice(0, 200))
      : [];

    // Trust the session email over body for authenticated callers.
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    const userEmail = user?.email ?? bodyEmail;

    const supabase = createAdminClient();

    const { data: config, error: configError } = await supabase
      .from('integrations_config')
      .select(
        'facebook_pixel_id, facebook_capi_token, facebook_test_event_code, fb_capi_enabled, conversion_tracking_mode, gtm_ss_enabled, gtm_server_container_url'
      )
      .maybeSingle<FbCapiConfigRow>();

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
      }).catch((err) => {
        console.warn('[fb-capi] Non-critical error:', err);
      });

      return NextResponse.json({ error: 'Failed to fetch configuration' }, { status: 500 });
    }

    if (!config) {
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
      }).catch((err) => {
        console.warn('[fb-capi] Non-critical error:', err);
      });

      return NextResponse.json({ error: 'No tracking destination configured' }, { status: 400 });
    }

    const clientIp = getClientIp(request);
    const userAgent = request.headers.get('user-agent') || '';

    const trackingEvent: TrackingEvent = {
      eventName: eventName as TrackingEvent['eventName'],
      eventId,
      eventTime: Math.floor(Date.now() / 1000),
      eventSourceUrl,
      value: value ?? 0,
      currency: currency ?? '',
      contentIds,
      contentName,
      orderId,
      userData: {
        emailHashed: userEmail ? sha256(userEmail) : undefined,
        clientIp,
        userAgent,
        fbc: hasConsent ? request.cookies.get('_fbc')?.value : undefined,
        fbp: hasConsent ? request.cookies.get('_fbp')?.value : undefined,
      },
    };

    const mode = (config.conversion_tracking_mode ?? 'strict') as ConversionTrackingMode;

    const dispatch = await dispatchTrackingEvent(trackingEvent, config, {
      mode,
      hasConsent,
      source: 'client_proxy',
      customerEmailForAudit: userEmail,
    });

    if (dispatch.skipped) {
      if (dispatch.skipped.reason === 'no_destination_configured') {
        return NextResponse.json(
          { error: 'No tracking destination configured' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: false,
        skipped: true,
        reason: dispatch.skipped.reason,
        message: `Event skipped: ${dispatch.skipped.reason}`,
      });
    }

    const fbResult = dispatch.results.find((r) => r.destination === 'fb_capi');

    if (dispatch.anySuccess) {
      return NextResponse.json({
        success: true,
        events_received: fbResult?.eventsReceived,
      });
    }

    console.error('[Tracking Proxy] All destinations failed:', dispatch.results);
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
    }).catch((err) => {
      console.warn('[fb-capi] Non-critical error:', err);
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
