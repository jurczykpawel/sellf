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
import { isAllowedOrigin } from '@/lib/security/origin-match';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';
import { CAPI_TOKEN_SELECT, withResolvedCapiToken } from '@/lib/integrations/capi-token';
import type { CapiTokenColumns } from '@/lib/integrations/capi-token';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';

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

/**
 * A Purchase event only leaves the server when its order id matches a
 * completed transaction we actually recorded. `order_id` in the request
 * body is client-supplied (see sendToCAPI in lib/tracking/client.ts, which
 * sends the Stripe checkout session id or payment intent id as-is), so it
 * is checked against payment_transactions rather than trusted outright.
 */
async function hasCompletedTransactionForOrder(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string
): Promise<boolean> {
  const { data: bySession } = await supabase
    .from('payment_transactions')
    .select('id')
    .eq('session_id', orderId)
    .eq('status', 'completed')
    .maybeSingle();
  if (bySession) return true;

  const { data: byIntent } = await supabase
    .from('payment_transactions')
    .select('id')
    .eq('stripe_payment_intent_id', orderId)
    .eq('status', 'completed')
    .maybeSingle();
  return !!byIntent;
}

interface FbCapiConfigRow extends CapiTokenColumns {
  facebook_pixel_id: string | null;
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

    // Origin must match the configured site, same as /api/consent — this is
    // a same-site browser proxy, not a public webhook receiver.
    const origin = request.headers.get('origin');
    const siteUrl = getCanonicalOriginOrNull();
    if (!siteUrl || !isAllowedOrigin(origin, [siteUrl])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await readJsonBody<Record<string, unknown>>(request);

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
    const contentName = sanitizeString(body.content_name, 200);
    const eventSourceUrl = sanitizeUrl(body.event_source_url);
    // A caller that never sends the flag (or sends a non-boolean) is treated as
    // not consented, same as an explicit `false`. The configured
    // conversion_tracking_mode (strict/limited/permissive) — not this default —
    // decides what happens next for events without consent.
    const bodyConsent = body.has_consent === true;
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

    // Identity comes only from the session — a caller can claim to be
    // anyone in the request body, so it's never used to attribute an event.
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    const userEmail = user?.email;

    const supabase = createAdminClient();

    if (eventName === 'Purchase') {
      const verified = orderId ? await hasCompletedTransactionForOrder(supabase, orderId) : false;
      if (!verified) {
        logTrackingEvent({
          eventName,
          eventId,
          source: 'client_proxy',
          status: 'skipped',
          skipReason: 'unmatched_order',
          orderId,
          customerEmail: userEmail,
          value,
          currency,
        }).catch((err) => {
          console.warn('[fb-capi] Non-critical error:', err);
        });

        return NextResponse.json({
          success: false,
          skipped: true,
          reason: 'unmatched_order',
          message: 'Event skipped: unmatched_order',
        });
      }
    }

    const { data: storedConfig, error: configError } = await supabase
      .from('integrations_config')
      .select(
        `facebook_pixel_id, ${CAPI_TOKEN_SELECT}, facebook_test_event_code, fb_capi_enabled, conversion_tracking_mode, gtm_ss_enabled, gtm_server_container_url`
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

    if (!storedConfig) {
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

    // Decrypts the CAPI token (and upgrades a legacy plaintext one in place).
    const config = await withResolvedCapiToken(storedConfig, supabase);

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
    if (error instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
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
